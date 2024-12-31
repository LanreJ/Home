import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import Stripe from 'stripe';
import { OpenAI } from 'openai';
import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { secretsService } from './services/SecretsService.js';
import { TaxReturnService } from './services/TaxReturnService.js';
import { BankFeedService } from './services/BankFeedService.js';
import { HMRCService } from './services/HMRCService.js';
import rateLimit from 'express-rate-limit';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Service registry
const services = {
    db: null,
    docai: null,
    stripe: null,
    openai: null,
    taxReturn: null,
    bankFeed: null,
    hmrc: null
};

// Initialize services
async function initializeServices() {
    try {
        const credentials = JSON.parse(
            await readFile(resolve(__dirname, './service-account.json'), 'utf8')
        );
        
        initializeApp({ credential: admin.credential.cert(credentials) });
        services.db = getFirestore();
        
        const secrets = await secretsService.getIntegrationSecrets();
        services.docai = new DocumentProcessorServiceClient();
        services.stripe = new Stripe(secrets.stripe);
        services.openai = new OpenAI({ apiKey: secrets.openai });
        
        services.taxReturn = new TaxReturnService(services.db, services.openai);
        services.bankFeed = new BankFeedService(secrets.plaid);
        services.hmrc = new HMRCService(secrets.hmrc);
        
        return true;
    } catch (error) {
        console.error('Service initialization failed:', error);
        return false;
    }
}

// Express setup
const app = express();
app.use(cors({ origin: true }));
app.use(bodyParser.json());
app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100
}));

// Health check endpoint
app.get('/_health', (req, res) => {
    const health = Object.entries(services).reduce((acc, [key, service]) => {
        acc[key] = !!service;
        return acc;
    }, {});
    res.json(health);
});

// Premium access middleware
const requirePremium = async (req, res, next) => {
    try {
        const userId = req.user?.uid;
        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        
        const userDoc = await services.db.collection('users').doc(userId).get();
        if (!userDoc.exists || !userDoc.data().isPremium) {
            return res.status(403).json({ error: 'Premium subscription required' });
        }
        next();
    } catch (error) {
        console.error('Premium check failed:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

// Initialize on startup
await initializeServices();

// Handle shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down');
    process.exit(0);
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// Export functions with configuration
export const api = onRequest({ 
    region: 'europe-west2',
    minInstances: 1,
    timeoutSeconds: 60,
}, app);

export const processDocument = onRequest({
    region: 'europe-west2',
    invoker: 'public',
    timeoutSeconds: 120,
}, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    await requirePremium(req, res, async () => {
        // Document processing implementation
        const result = await services.taxReturn.processDocument(req.body);
        res.json(result);
    });
});

export const generateTaxReturn = onRequest({
    region: 'europe-west2',
    invoker: 'public',
    timeoutSeconds: 180,
}, async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
        await requirePremium(req, res, async () => {
            const { documents, bankData, userInputs } = req.body;
            
            // Process documents
            const processedDocs = await services.taxReturn.processDocuments(documents);
            
            // Get bank transactions
            const bankTransactions = await services.bankFeed.getTransactions(bankData);
            
            // Generate tax return with AI assistance
            const taxReturn = await services.taxReturn.generateReturn({
                documents: processedDocs,
                bankData: bankTransactions,
                userInputs
            });

            // Submit to HMRC if requested
            if (req.body.submit) {
                const submission = await services.hmrc.submitReturn(taxReturn);
                await services.taxReturn.updateSubmissionStatus(taxReturn.id, submission);
            }

            // Generate PDF summary
            const pdfUrl = await services.taxReturn.generatePDF(taxReturn);

            // Save final status
            await services.db.collection('taxReturns').doc(taxReturn.id).update({
                status: 'COMPLETED',
                pdfUrl,
                updatedAt: new Date()
            });

            res.json({
                taxReturn,
                calculations: taxReturn.calculations,
                submission: taxReturn.submission,
                pdfUrl,
                status: 'COMPLETED'
            });
        });
    } catch (error) {
        console.error('Tax return generation failed:', error);
        res.status(500).json({ 
            error: 'Tax return generation failed',
            details: error.message
        });
    }
});

