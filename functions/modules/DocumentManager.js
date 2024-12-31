import { getStorage } from 'firebase-admin/storage';
import { getFirestore } from 'firebase-admin/firestore';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

export class DocumentManager {
    constructor(storage, db, docaiClient) {
        this.storage = storage;
        this.db = db;
        this.docaiClient = docaiClient;
        this.bucket = this.storage.bucket();
        this.allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
        this.maxSize = 10 * 1024 * 1024; // 10MB
    }

    async initialize(userId) {
        this.userId = userId;
        this.userDocsRef = this.db.collection('users').doc(userId).collection('documents');
    }

    async uploadAndProcess(file) {
        try {
            await this.validateFile(file);
            const fileName = this.generateFileName(file);
            const path = `users/${this.userId}/documents/${fileName}`;
            
            // Upload to storage
            await this.bucket.upload(file.path, {
                destination: path,
                metadata: { contentType: file.mimetype }
            });

            // Process with Document AI
            const result = await this.processWithDocAI(file);

            // Store metadata
            const docRef = await this.userDocsRef.add({
                fileName,
                path,
                type: file.mimetype,
                status: 'PROCESSED',
                metadata: result.metadata,
                extracted_data: result.extracted_data,
                confidence: result.confidence,
                createdAt: new Date()
            });

            return {
                id: docRef.id,
                path,
                metadata: result.metadata
            };

        } catch (error) {
            console.error('Document processing failed:', error);
            throw new Error('Failed to process document');
        }
    }

    private async validateFile(file) {
        if (!file || !file.mimetype) throw new Error('Invalid file');
        if (!this.allowedTypes.includes(file.mimetype)) {
            throw new Error('Unsupported file type');
        }
        if (file.size > this.maxSize) {
            throw new Error('File too large');
        }
    }

    private async processWithDocAI(file) {
        const content = await this.readFileContent(file);
        const request = {
            name: this.docaiClient.processorPath,
            document: {
                content,
                mimeType: file.mimetype
            }
        };

        const [result] = await this.docaiClient.processDocument(request);
        return this.parseDocAIResult(result);
    }

    private parseDocAIResult(result) {
        return {
            metadata: result.document.metadata,
            extracted_data: result.document.text,
            confidence: result.document.textStyles?.[0]?.confidence || 0
        };
    }

    private generateFileName(file) {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(7);
        const extension = file.originalname.split('.').pop();
        return `${timestamp}-${random}.${extension}`;
    }
}