import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { logger } from 'firebase-functions';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
const admin = require('firebase-admin');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const credPath = resolve(__dirname, '../../service-account.json');
const serviceAccount = require(credPath);

// Ensure Firebase Admin is initialized only once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

export class SecretsService {
    constructor() {
        this.cache = new Map();
        this.initialized = false;
    }

    async init() {
        try {
            // Fix path resolution for ES modules
            const credPath = resolve(__dirname, '../../service-account.json');
            const credentials = JSON.parse(await readFile(credPath, 'utf8'));
            
            this.client = new SecretManagerServiceClient({
                credentials,
                projectId: process.env.PROJECT_ID || 'taxstats-document-ai'
            });
            
            this.initialized = true;
            logger.info('SecretsService initialized');
            return true;
        } catch (error) {
            logger.error('SecretsService initialization failed:', error);
            return false;
        }
    }

    async ensureInitialized() {
        if (!this.initialized) {
            await this.init();
        }
        return this.initialized;
    }

    async getSecret(name, fallback = null) {
        if (!await this.ensureInitialized()) {
            return fallback;
        }

        const cached = this.cache.get(name);
        if (cached?.value && Date.now() - cached.timestamp < 3600000) {
            return cached.value;
        }

        try {
            const [version] = await this.client.accessSecretVersion({
                name: `projects/${this.client.projectId}/secrets/${name}/versions/latest`
            });

            const value = version.payload.data.toString();
            this.cache.set(name, { value, timestamp: Date.now() });
            return value;
        } catch (error) {
            logger.error(`Secret access failed: ${name}`, error);
            return fallback;
        }
    }

    async getIntegrationSecrets() {
        const [hmrc, plaid, stripe, openai] = await Promise.all([
            this.getSecret('HMRC_CLIENT_SECRET'),
            this.getSecret('PLAID_SECRET'),
            this.getSecret('STRIPE_SECRET_KEY'),
            this.getSecret('OPENAI_API_KEY')
        ]);

        return { hmrc, plaid, stripe, openai };
    }

    clearCache() {
        this.cache.clear();
        logger.info('Secret cache cleared');
    }
}

export const secretsService = new SecretsService();

const getSecret = async (secretName) => {
  try {
    const secretRef = db.collection('secrets').doc(secretName);
    const doc = await secretRef.get();
    if (!doc.exists) {
      throw new Error(`Secret ${secretName} does not exist.`);
    }
    return doc.data().value;
  } catch (error) {
    console.error(`Error retrieving secret ${secretName}:`, error);
    throw error;
  }
};

module.exports = {
  getSecret,
  db,
  bucket,
};