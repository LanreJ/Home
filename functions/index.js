/**
 * Import function triggers from their respective submodules:
 *
 * const { onCall } = require("firebase-functions/v2/https");
 * const { onDocumentWritten } = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const OpenAI = require("openai");
const express = require("express");
const cors = require("cors");

// Initialize services
admin.initializeApp();
const app = express();
app.use(cors({ origin: true }));

// Initialize clients
const secrets = new SecretManagerServiceClient({
    keyFilename: './key-file.json',
    projectId: 'taxstats-document-ai'
});

const docaiClient = new DocumentProcessorServiceClient({
    keyFilename: './key-file.json'
});

async function getSecret(name) {
    try {
        const [version] = await secrets.accessSecretVersion({
            name: `projects/taxstats-document-ai/secrets/${name}/versions/latest`
        });
        return version.payload.data.toString();
    } catch (error) {
        logger.error(`Error fetching secret ${name}:`, error);
        throw new Error('Configuration error');
    }
}

// Initialize OpenAI
let openaiClient = null;
async function getOpenAIClient() {
    if (!openaiClient) {
        try {
            const apiKey = await getSecretValue('OPENAI_API_KEY');
            openaiClient = new OpenAI({ apiKey });
        } catch (error) {
            logger.error('OpenAI initialization error:', error);
            throw new Error('Failed to initialize OpenAI client');
        }
    }
    return openaiClient;
}

// Document AI setup
const processorName = `projects/taxstats-document-ai/locations/eu/processors/${process.env.PROCESSOR_ID}`;

// Enhanced auth middleware
const authenticateRequest = async (req, res, next) => {
    try {
        // Log headers for debugging
        logger.debug('Auth headers:', req.headers);
        
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            logger.error('Missing/invalid auth header');
            return res.status(401).json({
                error: 'Unauthorized',
                details: 'Missing or invalid authorization header'
            });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        if (!decodedToken.uid) {
            logger.error('Invalid token - no UID');
            return res.status(401).json({
                error: 'Unauthorized',
                details: 'Invalid token'
            });
        }

        req.user = decodedToken;
        next();
    } catch (error) {
        logger.error('Auth error:', error);
        res.status(401).json({
            error: 'Unauthorized',
            message: error.message,
            details: 'Authentication failed'
        });
    }
};

// File upload endpoint
app.post('/upload', authenticateRequest, async (req, res) => {
    try {
        const { filename, contentType, data } = req.body;
        const bucket = admin.storage().bucket();
        const file = bucket.file(`uploads/${req.user.uid}/${filename}`);
        
        await file.save(Buffer.from(data, 'base64'), {
            contentType,
            metadata: { uploadedBy: req.user.uid }
        });

        // Process with Document AI
        const [result] = await docaiClient.processDocument({
            name: processorName,
            document: {
                content: data,
                mimeType: contentType
            }
        });

        // Store processed results
        await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .add({
                filename,
                processed: result.document,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ 
            success: true, 
            docId: result.document.name 
        });
    } catch (error) {
        logger.error('Upload error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Enhanced chat endpoint with document context
app.post('/chat', authenticateRequest, async (req, res) => {
    try {
        const openai = await getOpenAIClient();
        const { message, history } = req.body;

        // Get user's processed documents
        const docs = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .orderBy('timestamp', 'desc')
            .limit(5)
            .get();

        const docContext = docs.docs
            .map(doc => doc.data().processed)
            .join('\n\n');

        const completion = await openai.chat.completions.create({
            model: "gpt-4",
            messages: [
                {
                    role: "system",
                    content: `You are a UK tax expert AI assistant. Use this document context: ${docContext}`
                },
                ...history || [],
                { role: "user", content: message }
            ]
        });

        res.json({
            success: true,
            reply: completion.choices[0].message.content,
            context: completion.choices[0].message
        });
    } catch (error) {
        logger.error('Chat error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add document processing endpoint
app.post('/processDocument', authenticateRequest, async (req, res) => {
    try {
        const { content, mimeType } = req.body;
        
        const [result] = await docaiClient.processDocument({
            name: processorName,
            document: {
                content,
                mimeType
            }
        });

        // Store results in Firestore
        await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .add({
                processed: result.document,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ success: true, result: result.document });
    } catch (error) {
        logger.error('Document processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// New document processing endpoint
app.post('/process-documents', authenticateRequest, async (req, res) => {
    try {
        const { files } = req;
        const processor = new DocumentProcessor(process.env.PROCESSOR_ID);
        const formGenerator = new FormGenerator('2023-24');
        
        for (const file of files) {
            const processedDoc = await processor.processDocument(file);
            await formGenerator.mapToForms(processedDoc);
        }

        const reviewer = new FormReview(formGenerator);
        const preview = reviewer.generatePreview();

        res.json({ success: true, preview });
    } catch (error) {
        console.error('Processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export the Express app as a v2 function
exports.api = onRequest({
    region: "europe-west2",
    memory: "256MiB",
    maxInstances: 10,
    secrets: ["OPENAI_API_KEY", "PROCESSOR_ID"]
}, app);
