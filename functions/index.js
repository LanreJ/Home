import { onRequest } from "firebase-functions/v2/https";
import { logger } from "firebase-functions/logger";
import admin from "firebase-admin";
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai/v1';
import express from "express";
import cors from "cors";
import Stripe from 'stripe';
import bodyParser from "body-parser";

// Initialize Firebase Admin
if (!admin.apps.length) {
    admin.initializeApp();
}

// Express App Setup
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Initialize Cloud Clients
const secrets = new SecretManagerServiceClient();
const docaiClient = new DocumentProcessorServiceClient();

// Helper: Fetch Secret from Secret Manager
async function getSecret(secretName) {
    try {
        const [version] = await secrets.accessSecretVersion({
            name: `projects/${process.env.GCLOUD_PROJECT}/secrets/${secretName}/versions/latest`
        });
        return version.payload.data.toString();
    } catch (error) {
        logger.error(`Error accessing secret ${secretName}:`, error);
        throw new Error(`Failed to access secret: ${secretName}`);
    }
}

// Initialize Stripe
let stripeClient;
(async () => {
    const stripeSecretKey = await getSecret('STRIPE_SECRET_KEY');
    stripeClient = Stripe(stripeSecretKey);
})();

// OpenAI Integration
const OpenAI = require("openai");
let openaiClient;
(async () => {
    const openaiApiKey = await getSecret('OPENAI_API_KEY');
    openaiClient = new OpenAI({ apiKey: openaiApiKey });
})();

// Document Processor Setup
const processorName = `projects/${process.env.GCLOUD_PROJECT}/locations/us/processors/${process.env.PROCESSOR_ID}`;

// Middleware for Authentication and Rate Limiting
const authenticateRequest = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) throw new Error('Unauthorized');
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = { uid: decodedToken.uid };
        next();
    } catch (error) {
        res.status(401).json({ error: 'Unauthorized', details: error.message });
    }
};

// File Upload API
app.post('/api/upload', authenticateRequest, async (req, res) => {
    try {
        const file = req.files?.file;
        if (!file) throw new Error('No file uploaded');

        const userId = req.user.uid;
        const filename = `uploads/${userId}/${Date.now()}-${file.name}`;

        const fileRef = admin.storage().bucket().file(filename);
        await fileRef.save(file.data);

        res.json({ success: true, filename });
    } catch (error) {
        logger.error('Upload error:', error);
        res.status(500).json({ error: 'File upload failed', details: error.message });
    }
});

// Document Processing API
app.post('/api/process-document', authenticateRequest, async (req, res) => {
    try {
        const { fileUrl } = req.body;
        const [result] = await docaiClient.processDocument({
            name: processorName,
            document: { uri: fileUrl, mimeType: 'application/pdf' },
        });

        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .add({
                processedData: result.document,
                originalUrl: fileUrl,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

        res.json({ success: true, documentId: docRef.id, result: result.document });
    } catch (error) {
        logger.error('Document processing error:', error);
        res.status(500).json({ error: 'Document processing failed', details: error.message });
    }
});

// Chat API with OpenAI
app.post('/api/chat', authenticateRequest, async (req, res) => {
    try {
        const { message, documentId } = req.body;

        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .doc(documentId)
            .get();

        if (!docRef.exists) throw new Error('Document not found');

        const context = docRef.data().processedData;
        const completion = await openaiClient.chat.completions.create({
            model: "gpt-4",
            messages: [
                { role: "system", content: "You are a tax assistant." },
                { role: "user", content: `Document Context: ${JSON.stringify(context)} User Query: ${message}` },
            ],
        });

        res.json({ success: true, response: completion.choices[0].message.content });
    } catch (error) {
        logger.error('Chat error:', error);
        res.status(500).json({ error: 'Chat processing failed', details: error.message });
    }
});

// Stripe Webhook for Subscription Management
app.post('/stripe/webhook', bodyParser.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const sig = req.headers['stripe-signature'];
        const event = stripeClient.webhooks.constructEvent(req.body, sig, await getSecret('STRIPE_WEBHOOK_SECRET'));
        
        if (event.type === 'invoice.payment_succeeded') {
            const customer = event.data.object.customer;
            await admin.firestore().collection('subscriptions').doc(customer).set({ active: true });
        }
        
        res.status(200).json({ received: true });
    } catch (error) {
        logger.error('Stripe webhook error:', error);
        res.status(400).send(`Webhook Error: ${error.message}`);
    }
});

// Export functions
export const processDocument = onRequest(async (req, res) => {
    // ...existing code...
});

export const generateTaxReturn = onRequest(async (req, res) => {
    // ...existing code...
});

