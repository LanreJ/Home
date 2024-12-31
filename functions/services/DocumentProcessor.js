import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import * as crypto from 'crypto';

class DocumentProcessor {
    constructor() {
        this.client = new DocumentProcessorServiceClient();
        this.secretManager = new SecretManagerServiceClient();
        this.algorithm = 'aes-256-gcm';
    }

    async getEncryptionKey() {
        const [version] = await this.secretManager.accessSecretVersion({
            name: 'projects/taxstats-document-ai/secrets/document-encryption-key/versions/latest'
        });
        return version.payload.data;
    }

    async encryptDocument(buffer) {
        const key = await this.getEncryptionKey();
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, key, iv);
        const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        
        return {
            content: encrypted,
            iv: iv,
            authTag: authTag
        };
    }

    async process(files) {
        const results = [];
        for (const file of files) {
            console.log(`Processing file: ${file.originalname}, size: ${file.size}`);
            const result = await this.processDocument(file);
            results.push(result);
        }
        return results;
    }

    async processDocument(file) {
        try {
            // Encrypt file before processing
            const encrypted = await this.encryptDocument(file.buffer);
            
            const [result] = await this.client.processDocument({
                name: this.processorPath,
                document: {
                    content: encrypted.content,
                    mimeType: file.mimetype
                }
            });

            const documentType = this.detectDocumentType(result.document);
            
            // Log processing metadata without sensitive info
            console.log({
                documentType,
                timestamp: new Date().toISOString(),
                processingStatus: 'success',
                fileMetadata: {
                    type: file.mimetype,
                    size: file.size,
                    processorPath: this.processorPath
                }
            });

            return {
                type: documentType,
                result: result.document,
                metadata: {
                    encrypted: true,
                    iv: encrypted.iv.toString('hex'),
                    processedAt: new Date().toISOString()
                }
            };

        } catch (error) {
            console.error('Document processing failed:', {
                error: error.message,
                timestamp: new Date().toISOString(),
                fileType: file.mimetype
            });
            throw error;
        }
    }

    extractEntities(document) {
        const entityMap = {
            INCOME: 'income',
            UTR: 'utr',
            NINO: 'nino',
            PROPERTY_INCOME: 'propertyIncome',
            EXPENSES: 'expenses',
            BANK_INTEREST: 'bankInterest',
            DIVIDENDS: 'dividends'
        };

        const entities = {};
        document.entities.forEach(entity => {
            const key = entityMap[entity.type];
            if (key) {
                entities[key] = this.parseEntityValue(entity);
            }
        });

        return this.validateEntities(entities);
    }

    parseEntityValue(entity) {
        if (entity.type.includes('AMOUNT')) {
            return parseFloat(entity.mentionText.replace(/[£,]/g, '')) || 0;
        }
        return entity.mentionText.trim();
    }

    validateEntities(entities) {
        // Validate UTR format
        if (entities.utr && !/^\d{10}$/.test(entities.utr)) {
            throw new Error('Invalid UTR format');
        }

        // Validate NINO format
        if (entities.nino && !/^[A-Z]{2}\d{6}[A-D]$/.test(entities.nino)) {
            throw new Error('Invalid NINO format');
        }

        return entities;
    }

    parseAmount(text) {
        const amount = parseFloat(text.replace(/[£,]/g, ''));
        return isNaN(amount) ? 0 : amount;
    }

    validateDocument(result) {
        if (!result.document) {
            throw new Error('Invalid document structure');
        }

        if (result.document.error) {
            throw new Error(`Document processing error: ${result.document.error}`);
        }

        return result.document.textStyles[0]?.confidence >= 0.8;
    }

    detectDocumentType(document) {
        const text = document.text.toLowerCase();
        const types = {
            'P60': /p60|end of year certificate/,
            'SA100': /sa100|tax return/,
            'SA105': /sa105|uk property/,
            'BANK_STATEMENT': /bank statement|account statement/,
            'INVOICE': /invoice|bill/,
            'RECEIPT': /receipt|proof of purchase/,
            'PAYSLIP': /payslip|wage slip/
        };

        for (const [type, pattern] of Object.entries(types)) {
            if (pattern.test(text)) return type;
        }

        return 'UNKNOWN';
    }

    async processDocumentByType(document, type) {
        const processors = {
            'P60': this.processP60,
            'SA100': this.processSA100,
            'SA105': this.processSA105,
            'BANK_STATEMENT': this.processBankStatement,
            'INVOICE': this.processInvoice,
            'RECEIPT': this.processReceipt
        };

        const processor = processors[type];
        if (!processor) {
            throw new Error(`No processor available for document type: ${type}`);
        }

        return processor.call(this, document);
    }

    async processP60(document) {
        const entities = {};
        const taxYear = this.extractTaxYear(document);
        
        // Extract income details
        entities.income = this.extractAmountByLabel(document, 'Total pay for year');
        entities.taxPaid = this.extractAmountByLabel(document, 'Total tax for year');
        entities.niContributions = this.extractAmountByLabel(document, 'Employee NI');
        
        return {
            type: 'P60',
            taxYear,
            entities
        };
    }

    async processSA100(document) {
        const processor = new SA100Processor();
        return processor.process(document);
    }

    async processSA105(document) {
        const processor = new SA105Processor();
        return processor.process(document);
    }

    extractByLabel(document, label) {
        const regex = new RegExp(`${label}[:\\s]+(.*?)(?:\\n|$)`);
        const match = document.text.match(regex);
        return match ? match[1].trim() : null;
    }

    extractAmount(document, label) {
        const value = this.extractByLabel(document, label);
        return value ? parseFloat(value.replace(/[£,]/g, '')) : 0;
    }

    async getProcessor(documentType) {
        const processors = {
            P60: () => import('./processors/P60Processor'),
            SA100: () => import('./processors/SA100Processor'),
            SA105: () => import('./processors/SA105Processor'),
            SA103: () => import('./processors/SA103Processor'),
            BankStatement: () => import('./processors/BankStatementProcessor'),
            Receipt: () => import('./processors/ReceiptProcessor'),
            Dividend: () => import('./processors/DividendProcessor')
        };

        const processorModule = processors[documentType];
        if (!processorModule) {
            throw new Error(`No processor found for document type: ${documentType}`);
        }

        const { default: ProcessorClass } = await processorModule();
        const processor = new ProcessorClass();
        
        return {
            processor,
            metadata: {
                type: documentType,
                processorVersion: processor.version,
                aiEnabled: processor.useAI,
                validations: processor.getValidationRules(),
                timestamp: new Date().toISOString()
            }
        };
    }

    async validateDocument(document, type) {
        const { processor, metadata } = await this.getProcessor(type);
        const validation = await processor.validate(document);
        
        return {
            isValid: validation.valid,
            errors: validation.errors || [],
            warnings: validation.warnings || [],
            metadata: {
                ...metadata,
                validatedAt: new Date().toISOString(),
                status: validation.valid ? 'VALID' : 'NEEDS_REVIEW'
            }
        };
    }

    async uploadDocument(docBuffer, metadata) {
        console.log('Starting document upload...');
        // Optionally reuse encryptDocument() or write a new encryption method
        const encryptedDoc = await this.encryptDocument(docBuffer);

        // Perform upload with encryptedDoc
        console.log(`Document metadata: ${JSON.stringify(metadata)}`);
    }
}

export default DocumentProcessor;