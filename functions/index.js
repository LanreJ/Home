import { onRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import admin from 'firebase-admin';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import { OpenAI } from 'openai';

// Environment variables
const projectId = process.env.PROJECT_ID || 'taxstats-document-ai';
const processorId = process.env.PROCESSOR_ID;
const processorName = `projects/${projectId}/locations/europe-west2/processors/${processorId}`;

// Initialize Firebase Admin
admin.initializeApp();

// Initialize Document AI
const docaiClient = new DocumentProcessorServiceClient();

// Initialize Express
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Initialize Secret Manager
const secrets = new SecretManagerServiceClient();

// Secret Manager helper
async function getSecret(secretName) {
    try {
        const name = `projects/${projectId}/secrets/${secretName}/versions/latest`;
        const [version] = await secrets.accessSecretVersion({ name });
        return version.payload.data.toString();
    } catch (error) {
        logger.error(`Error accessing secret ${secretName}:`, error);
        throw new Error(`Failed to access secret: ${secretName}`);
    }
}

// Initialize clients
let stripeClient;
let openaiClient;

(async () => {
    try {
        const stripeKey = await getSecret('STRIPE_SECRET_KEY');
        stripeClient = new Stripe(stripeKey);
    } catch (error) {
        logger.error('Stripe initialization failed:', error);
    }
})();

(async () => {
    try {
        const openaiKey = await getSecret('OPENAI_API_KEY');
        openaiClient = new OpenAI({ apiKey: openaiKey });
    } catch (error) {
        logger.error('OpenAI initialization failed:', error);
    }
})();

// Middleware: Authentication
const authenticateRequest = async (req, res, next) => {
    // Your authentication logic
    next();
};

// Define your routes and functions here
// Example:
app.post('/process', authenticateRequest, async (req, res) => {
    // Your processing logic
});

app.post('/generate-tax-return', authenticateRequest, async (req, res) => {
    // Your tax return generation logic
});

// Export Functions
export const api = onRequest({ 
    region: 'europe-west2', 
    invoker: 'public'
}, app);

export const processDocument = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    // Your existing code...
});

export const generateTaxReturn = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    // Your existing code...
});

