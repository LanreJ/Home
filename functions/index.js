require('dotenv').config();

const functions = require('firebase-functions');
const { onRequest } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const Stripe = require('stripe');
const OpenAI = require('openai');

// Environment variables
const projectId = process.env.PROJECT_ID;
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
    try {
        const authHeader = req.headers.authorization || '';
        if (!authHeader.startsWith('Bearer ')) throw new Error('Unauthorized');
        
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = { uid: decodedToken.uid };
        next();
    } catch (error) {
        logger.error('Authentication error:', error);
        res.status(401).json({ error: 'Unauthorized', details: error.message });
    }
};

// File Upload Endpoint
app.post('/api/upload', authenticateRequest, async (req, res) => {
    try {
        if (!req.files || !req.files.file) throw new Error('No file uploaded');
        
        const file = req.files.file;
        const userId = req.user.uid;
        const filename = `uploads/${userId}/${Date.now()}-${file.name}`;

        const fileRef = admin.storage().bucket().file(filename);
        await fileRef.save(file.data);

        res.json({ success: true, filename });
    } catch (error) {
        logger.error('File upload error:', error);
        res.status(500).json({ error: 'File upload failed', details: error.message });
    }
});

// Document Processing Endpoint
app.post('/api/process-document', authenticateRequest, async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) throw new Error('File URL is required');
        
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

// OpenAI Chat Endpoint
app.post('/api/chat', authenticateRequest, async (req, res) => {
    try {
        const { message, documentId } = req.body;
        if (!message || !documentId) throw new Error('Message and Document ID are required');

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
        logger.error('Chat processing error:', error);
        res.status(500).json({ error: 'Chat processing failed', details: error.message });
    }
});

// Stripe Webhook
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

// Export Functions
exports.api = onRequest({ 
    region: 'europe-west2', 
    invoker: 'public'
}, app);

exports.processDocument = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    try {
        const { fileUrl } = req.body;
        if (!fileUrl) throw new Error('File URL is required');
        
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

exports.generateTaxReturn = onRequest({
    region: 'europe-west2',
    invoker: 'public'
}, async (req, res) => {
    try {
        const { message, documentId } = req.body;
        if (!message || !documentId) throw new Error('Message and Document ID are required');

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
        logger.error('Chat processing error:', error);
        res.status(500).json({ error: 'Chat processing failed', details: error.message });
    }
});

