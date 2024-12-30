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
if (!admin.apps.length) {
    admin.initializeApp();
}
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

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

// OpenAI Setup and Configuration
class OpenAIService {
    constructor() {
        this.client = null;
        this.retryCount = 3;
        this.retryDelay = 1000;
    }

    async initialize() {
        if (!this.client) {
            const apiKey = await getSecretValue('OPENAI_API_KEY');
            this.client = new OpenAI({ 
                apiKey,
                maxRetries: this.retryCount,
                timeout: 30000
            });
        }
        return this.client;
    }

    async createChatCompletion(messages, options = {}) {
        try {
            const client = await this.initialize();
            const completion = await client.chat.completions.create({
                model: options.model || "gpt-4",
                messages,
                temperature: options.temperature || 0.7,
                max_tokens: options.maxTokens || 500,
                presence_penalty: options.presencePenalty || 0,
                frequency_penalty: options.frequencyPenalty || 0
            });

            return {
                response: completion.choices[0].message.content,
                usage: completion.usage,
                model: completion.model
            };
        } catch (error) {
            logger.error('OpenAI chat completion error:', error);
            throw new Error('Failed to generate chat completion');
        }
    }

    async withRetry(operation) {
        let lastError;
        for (let i = 0; i < this.retryCount; i++) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                if (!this.isRetryable(error)) throw error;
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * Math.pow(2, i)));
            }
        }
        throw lastError;
    }

    isRetryable(error) {
        return error.status === 429 || error.status >= 500;
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
const processorName = `projects/${process.env.PROJECT_ID}/locations/us/processors/${process.env.PROCESSOR_ID}`;

// Auth middleware with rate limiting and role checking
const authenticateRequest = async (req, res, next) => {
    try {
        // Check rate limiting
        const rateLimitResult = await checkAuthRateLimit(req.ip);
        if (!rateLimitResult.allowed) {
            throw new Error(`Rate limit exceeded. Try again in ${rateLimitResult.timeRemaining}s`);
        }

        // Verify auth header
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new Error('Missing or invalid authorization header');
        }

        // Verify token
        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        
        if (!decodedToken.uid) {
            throw new Error('Invalid token - no UID');
        }

        // Check user roles
        const userRecord = await admin.auth().getUser(decodedToken.uid);
        const userClaims = userRecord.customClaims || {};
        
        req.user = {
            ...decodedToken,
            roles: userClaims.roles || [],
            permissions: userClaims.permissions || []
        };

        // Log successful auth
        await logAuthAttempt(req.user.uid, true);

        // Set security headers
        res.set({
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'X-XSS-Protection': '1; mode=block'
        });

        next();
    } catch (error) {
        // Log failed attempt
        await logAuthAttempt(req.headers?.['x-forwarded-for'] || req.ip, false);
        
        logger.error('Auth error:', error);
        res.status(401).json({
            error: 'Unauthorized',
            details: error.message
        });
    }
};

// Rate limiting middleware
const rateLimit = async (req, res, next) => {
    try {
        const rateLimitCheck = await checkRateLimit(req.user.uid);
        if (!rateLimitCheck.allowed) {
            throw new Error(`Rate limit exceeded. Reset at ${new Date(rateLimitCheck.resetTime)}`);
        }
        next();
    } catch (error) {
        res.status(429).json({ error: error.message });
    }
};

// File upload endpoint
app.post('/api/upload', authenticateRequest, async (req, res) => {
    try {
        const file = req.files?.file;
        if (!file) throw new Error('No file uploaded');
        
        const userId = req.user.uid;
        const result = await handleFileUpload(file, userId);
        
        res.json(result);
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'File upload failed' });
    }
});

// Enhanced chat endpoint with document context
app.post('/api/chat', authenticateRequest, rateLimit, async (req, res) => {
    try {
        const { message, documentId } = req.body;
        
        // Get user's document context
        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .doc(documentId)
            .get();

        if (!docRef.exists) {
            throw new Error('Document not found');
        }

        // Process chat with document context
        const response = await processChat(message, docRef.data());

        // Log chat interaction
        await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('chat_history')
            .add({
                message,
                response,
                documentId,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata: {
                    model: "gpt-4",
                    tokens: response.usage?.total_tokens || 0,
                    documentContext: docRef.id
                }
            });

        // Format response for client
        res.json({
            success: true,
            response,
            metadata: {
                timestamp: new Date().toISOString(),
                documentId: docRef.id,
                tokens: response.usage?.total_tokens || 0
            }
        });
    } catch (error) {
        logger.error('Chat processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Chat history endpoint
app.get('/api/chat-history', authenticateRequest, async (req, res) => {
    try {
        const { documentId, limit = 10, lastTimestamp } = req.query;
        let query = admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('chat_history')
            .orderBy('timestamp', 'desc')
            .limit(parseInt(limit));

        if (documentId) {
            query = query.where('documentId', '==', documentId);
        }
        if (lastTimestamp) {
            query = query.startAfter(new Date(lastTimestamp));
        }

        const history = await query.get();
        res.json({
            success: true,
            history: history.docs.map(doc => ({
                id: doc.id,
                ...doc.data(),
                timestamp: doc.data().timestamp?.toDate()
            }))
        });
    } catch (error) {
        logger.error('Chat history error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Document processing status endpoint
app.get('/api/document-status/:documentId', authenticateRequest, async (req, res) => {
    try {
        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .doc(req.params.documentId)
            .get();

        if (!docRef.exists) {
            throw new Error('Document not found');
        }

        res.json({
            success: true,
            status: docRef.data()
        });
    } catch (error) {
        logger.error('Document status error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Process chat message with document context
async function processChat(message, docData) {
    // Rate limiting check
    const rateLimitCheck = await checkRateLimit(req.user.uid);
    if (!rateLimitCheck.allowed) {
        throw new Error('Rate limit exceeded. Please wait before sending another message.');
    }

    // Process chat with document context
    const response = await openai.createChatCompletion({
        model: "gpt-4",
        messages: [
            { 
                role: "system", 
                content: "You are a tax assistant helping with document analysis. Use the provided document context to answer questions accurately. If information is not in the context, say so." 
            },
            {
                role: "user",
                content: `Document Context: ${JSON.stringify(docData.processed)}
                         User Question: ${message}`
            }
        ],
        temperature: 0.7,
        max_tokens: 500,
        frequency_penalty: 0.5
    });

    // Format and store the response
    const chatResponse = response.data.choices[0].message.content;
    await storeChatHistory(req.user.uid, {
        message,
        response: chatResponse,
        documentId: docData.id,
        metadata: {
            model: "gpt-4",
            tokens: response.data.usage.total_tokens,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        }
    });

    return chatResponse;
}

async function storeChatHistory(userId, chatData) {
    return admin.firestore()
        .collection('users')
        .doc(userId)
        .collection('chat_history')
        .add(chatData);
}

// Rate limiting helper
async function checkRateLimit(userId, type = 'chat') {
    const limits = {
        chat: { max: 10, window: 60000 },
        document: { max: 5, window: 300000 }
    };
    
    const { max, window } = limits[type];
    const now = Date.now();
    
    const rateRef = admin.firestore()
        .collection('rate_limits')
        .doc(`${userId}_${type}`);

    const doc = await rateRef.get();
    
    if (!doc.exists) {
        await rateRef.set({ count: 1, window: now });
        return { allowed: true };
    }

    const data = doc.data();
    if (now - data.window > window) {
        await rateRef.set({ count: 1, window: now });
        return { allowed: true };
    }

    if (data.count >= max) {
        return { 
            allowed: false, 
            resetTime: data.window + window,
            timeRemaining: Math.ceil((data.window + window - now) / 1000)
        };
    }

    await rateRef.update({
        count: admin.firestore.FieldValue.increment(1)
    });
    
    return { 
        allowed: true,
        remaining: max - (data.count + 1)
    };
}

async function cleanupRateLimits() {
    const ONE_DAY = 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ONE_DAY;
    
    const snapshot = await admin.firestore()
        .collection('rate_limits')
        .where('window', '<', cutoff)
        .get();

    const batch = admin.firestore().batch();
    snapshot.docs.forEach(doc => {
        batch.delete(doc.ref);
    });

    return batch.commit();
}

// Add document processing endpoint
app.post('/processDocument', authenticateRequest, async (req, res) => {
    try {
        const rateLimitCheck = await checkRateLimit(req.user.uid, 'document');
        if (!rateLimitCheck.allowed) {
            throw new Error(`Rate limit exceeded. Reset at ${new Date(rateLimitCheck.resetTime)}`);
        }

        const { content, mimeType } = req.body;
        const [result] = await docaiClient.processDocument({
            name: processorName,
            document: { content, mimeType }
        });

        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .add({
                processed: result.document,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: 'COMPLETED'
            });

        res.json({ 
            success: true, 
            documentId: docRef.id,
            result: result.document 
        });
    } catch (error) {
        logger.error('Document processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

import { TaxReturnService } from './services/TaxReturnService';

// Remove duplicate classes and use service
app.post('/process-documents', authenticateRequest, async (req, res) => {
    try {
        const taxReturnService = new TaxReturnService('2023-24');
        const result = await taxReturnService.processDocuments(req.files);
        res.json(result);
    } catch (error) {
        logger.error('Processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

// PDF processing endpoint
app.post('/api/process-pdf', authenticateRequest, async (req, res) => {
    try {
        const { fileUrl } = req.body;
        
        const [result] = await docaiClient.processPDF({
            name: processorName,
            document: {
                uri: fileUrl,
                mimeType: 'application/pdf'
            }
        });

        // Store processed results
        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('documents')
            .add({
                processed: result.document,
                originalUrl: fileUrl,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

        res.json({ 
            success: true, 
            documentId: docRef.id,
            result: result.document 
        });
    } catch (error) {
        logger.error('PDF processing error:', error);
        res.status(500).json({ error: error.message });
    }
});

exports.plaidWebhook = functions.https.onRequest(async (req, res) => {
    try {
        // Validate webhook request
        if (req.method !== 'POST') {
            res.status(405).send('Method Not Allowed');
            return;
        }

        // Initialize bank service
        const bankService = new BankConnectionService();
        await bankService.initialize();

        // Process webhook
        const result = await bankService.handleWebhook(req.body);

        res.status(200).json({
            success: true,
            ...result
        });

    } catch (error) {
        console.error('Plaid webhook error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Export the Express app as a v2 function
exports.api = onRequest({
    region: "europe-west2",
    memory: "256MiB",
    maxInstances: 10,
    secrets: ["OPENAI_API_KEY", "PROCESSOR_ID"]
}, app);

async function handleFileUpload(file, userId) {
    // Validate file
    const validationResult = await validateFile(file);
    if (!validationResult.isValid) {
        throw new Error(validationResult.error);
    }

    // Generate unique filename
    const timestamp = Date.now();
    const filename = `${timestamp}-${file.name}`;
    const filePath = `uploads/${userId}/${filename}`;

    try {
        // Upload to Firebase Storage
        const fileRef = ref(storage, filePath);
        await uploadBytes(fileRef, file.data);
        const downloadURL = await getDownloadURL(fileRef);

        // Create document record
        const docRef = await admin.firestore()
            .collection('users')
            .doc(userId)
            .collection('documents')
            .add({
                filename: file.name,
                path: filePath,
                url: downloadURL,
                type: file.mimetype,
                size: file.size,
                uploadTime: admin.firestore.FieldValue.serverTimestamp(),
                status: 'UPLOADED',
                processingStatus: 'PENDING'
            });

        // Trigger document processing
        await processUploadedDocument(docRef.id, userId);

        return {
            success: true,
            documentId: docRef.id,
            filename: file.name,
            url: downloadURL
        };
    } catch (error) {
        logger.error('Upload error:', error);
        throw new Error('File upload failed');
    }
}

async function validateFile(file) {
    const MAX_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

    if (!file) return { isValid: false, error: 'No file provided' };
    if (!ALLOWED_TYPES.includes(file.mimetype)) {
        return { isValid: false, error: 'Invalid file type' };
    }
    if (file.size > MAX_SIZE) {
        return { isValid: false, error: 'File too large' };
    }

    return { isValid: true };
}

async function processUploadedDocument(docId, userId) {
    try {
        // Get document reference
        const docRef = admin.firestore()
            .collection('users')
            .doc(userId)
            .collection('documents')
            .doc(docId);

        // Update status to processing
        await docRef.update({
            processingStatus: 'PROCESSING',
            processingStartTime: admin.firestore.FieldValue.serverTimestamp()
        });

        // Get document data
        const doc = await docRef.get();
        const data = doc.data();

        // Process with Document AI
        const [result] = await docaiClient.processDocument({
            name: processorName,
            document: {
                uri: data.url,
                mimeType: data.type
            }
        });

        // Store processing results
        await docRef.update({
            processingStatus: 'COMPLETED',
            processedData: result.document,
            processingEndTime: admin.firestore.FieldValue.serverTimestamp(),
            metadata: {
                pageCount: result.document.pages?.length || 0,
                confidence: result.document.confidence || 0
            }
        });

        return {
            success: true,
            docId,
            status: 'COMPLETED'
        };

    } catch (error) {
        // Log error and update status
        logger.error('Processing error:', error);
        await docRef.update({
            processingStatus: 'FAILED',
            error: error.message,
            processingEndTime: admin.firestore.FieldValue.serverTimestamp()
        });
        throw error;
    }
}

app.post('/process-documents', authenticateRequest, async (req, res) => {
    try {
        const taxReturnService = new TaxReturnService(req.user.uid, '2023-24');
        const result = await taxReturnService.processDocuments(req.files);

        // Save to Firestore
        const docRef = await admin.firestore()
            .collection('users')
            .doc(req.user.uid)
            .collection('tax-returns')
            .add({
                documents: result.documents,
                parsedData: result.data,
                status: result.status,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata: {
                    taxYear: '2023-24',
                    processedBy: 'Google Document AI',
                    version: '1.0'
                }
            });

        res.json({ 
            success: true, 
            returnId: docRef.id,
            status: result.status,
            nextSteps: result.nextSteps
        });
    } catch (error) {
        logger.error('Tax return processing error:', error);
        res.status(500).json({ 
            error: error.message,
            code: error.code || 'PROCESSING_ERROR'
        });
    }
});
