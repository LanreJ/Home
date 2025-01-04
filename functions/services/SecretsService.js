const admin = require('firebase-admin');
const functions = require('firebase-functions');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { logger } = require('firebase-functions');

// Initialize Firebase Admin only once
if (!admin.apps.length) {
  admin.initializeApp({
    storageBucket: functions.config().app.storage_bucket
  });
}

const db = admin.firestore();
const bucket = admin.storage().bucket();

class SecretsService {
    constructor() {
        this.cache = new Map();
        this.initialized = false;
        this.client = null;
    }

    async init() {
        try {
            // Initialize SecretManagerServiceClient with default credentials
            this.client = new SecretManagerServiceClient();
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

    /**
     * Retrieves a secret from Secret Manager with caching.
     * @param {string} name - The name of the secret.
     * @param {any} fallback - The fallback value if retrieval fails.
     * @returns {Promise<string|null>} The secret value or fallback.
     */
    async getSecret(name, fallback = null) {
        if (!await this.ensureInitialized()) {
            return fallback;
        }

        const cached = this.cache.get(name);
        if (cached?.value && Date.now() - cached.timestamp < 3600000) { // 1 hour cache
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

    /**
     * Retrieves multiple integration secrets concurrently.
     * @returns {Promise<Object>} An object containing all integration secrets.
     */
    async getIntegrationSecrets() {
        const [hmrc, plaid, stripe, openai] = await Promise.all([
            this.getSecret('HMRC_CLIENT_SECRET'),
            this.getSecret('PLAID_SECRET'),
            this.getSecret('STRIPE_SECRET_KEY'),
            this.getSecret('OPENAI_API_KEY')
        ]);

        return { hmrc, plaid, stripe, openai };
    }

    /**
     * Clears the secret cache.
     */
    clearCache() {
        this.cache.clear();
        logger.info('Secret cache cleared');
    }
}

const secretsService = new SecretsService();

/**
 * Retrieves a secret from Firestore.
 * @param {string} secretName - The name of the secret document.
 * @returns {Promise<string>} The secret value.
 * @throws Will throw an error if the secret does not exist or retrieval fails.
 */
const getSecretFromFirestore = async (secretName) => {
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
  getSecret: getSecretFromFirestore,
  db,
  bucket,
  secretsService
};