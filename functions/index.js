import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import { OpenAI } from 'openai';
import { SecretsService } from './services/SecretsService.js';
import { readFile } from 'fs/promises';
import { resolve } from 'path';

// Initialize Express app
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Initialize Firebase Admin
const serviceAccountPath = resolve(process.cwd(), 'functions/service-account.json');
const serviceAccount = JSON.parse(await readFile(serviceAccountPath, 'utf8'));

initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const db = getFirestore();

// Health check endpoint
app.get('/_health', (req, res) => {
  res.status(200).send('OK');
});

// Initialize Secret Manager
const secretManager = new SecretManagerServiceClient();

// Helper to get secrets with fallback
async function getSecret(secretName, fallback = null) {
    try {
        const [version] = await secretManager.accessSecretVersion({
            name: `projects/taxstats-document-ai/secrets/${secretName}/versions/latest`
        });
        return version.payload.data.toString();
    } catch (error) {
        console.error(`Error accessing secret ${secretName}:`, error);
        return fallback;
    }
}

// Premium access middleware
const requirePremium = async (req, res, next) => {
    try {
        const userId = req.user.uid;
        const userDoc = await db.collection('users').doc(userId).get();
        if (!userDoc.exists || !userDoc.data().isPremium) {
            return res.status(403).json({ error: 'Premium subscription required' });
        }
        next();
    } catch (error) {
        console.error('Premium check failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Initialize services
let stripe;
let openai;
let docaiClient;
let processorName;

// Initialize all services
async function initializeServices() {
    try {
        // Initialize Document AI
        const projectId = process.env.PROJECT_ID || 'taxstats-document-ai';
        const processorId = await secretsService.getSecret('PROCESSOR_ID', '937da5fa78490a0b');
        processorName = `projects/${projectId}/locations/europe-west2/processors/${processorId}`;
        docaiClient = new DocumentProcessorServiceClient();

        // Initialize API clients
        const { stripe: stripeKey, openai: openaiKey } = await secretsService.getIntegrationSecrets();
        
        if (stripeKey) stripe = new Stripe(stripeKey);
        if (openaiKey) openai = new OpenAI({ apiKey: openaiKey });

        return true;
    } catch (error) {
        console.error('Service initialization failed:', error);
        return false;
    }
}

// Initialize on startup
await initializeServices();

// API Routes with premium checks
app.post('/process-document', requirePremium, async (req, res) => {
    try {
        // Document processing logic
    } catch (error) {
        console.error('Document processing failed:', error);
        res.status(500).json({ error: 'Processing failed' });
    }
});

app.post('/generate-tax-return', requirePremium, async (req, res) => {
    try {
        // Tax return generation logic
    } catch (error) {
        console.error('Tax return generation failed:', error);
        res.status(500).json({ error: 'Generation failed' });
    }
});

// Start server explicitly for Cloud Run
const PORT = process.env.PORT || 8080;
if (process.env.K_SERVICE) {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

// Handle shutdown gracefully
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down');
  process.exit(0);
});

// Export functions with region and invoker config
export const api = onRequest({ 
    region: 'europe-west2',
    minInstances: 1,
    timeoutSeconds: 60,
}, app);

export const processDocument = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    if (!req.user?.isPremium) {
        return res.status(403).json({ error: 'Premium required' });
    }
    // Document processing implementation
});

export const generateTaxReturn = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    if (!req.user?.isPremium) {
        return res.status(403).json({ error: 'Premium required' });
    }
    // Tax return generation implementation
});

