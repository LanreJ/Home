const admin = require('firebase-admin');
const OpenAIService = require('./OpenAIService');
const DocumentProcessor = require('./DocumentProcessor');
const FormGenerator = require('./FormGenerator');
const TaxCalculator = require('./TaxCalculator');

class TaxReturnService {
    constructor(userId, taxYear) {
        this.userId = userId;
        this.taxYear = taxYear;
        this.openAI = new OpenAIService();
        this.docProcessor = new DocumentProcessor();
        this.formGenerator = new FormGenerator();
        this.taxCalculator = new TaxCalculator();
    }

    async processReturn(files) {
        try {
            await this.updateProgress('PROCESSING', 0);
            await this.validateSubscription(this.userId);

            // Store and process documents
            const storedFiles = await Promise.all(
                files.map(file => this.storeDocument(file))
            );
            const docResults = await this.docProcessor.processDocuments(storedFiles);
            await this.updateProgress('PROCESSING', 30);

            // Get AI analysis and bank data
            const [aiAnalysis, bankData] = await Promise.all([
                this.openAI.analyzeTaxData(docResults),
                this.plaidClient.getTransactions(this.userId, this.taxYear)
            ]);
            await this.updateProgress('PROCESSING', 50);

            // Process bank transactions
            const categorizedTransactions = await this.processBankData(bankData);
            await this.updateProgress('PROCESSING', 70);

            // Generate forms
            const forms = await this.formGenerator.generateForms({
                documents: docResults,
                aiAnalysis,
                bankData: categorizedTransactions,
                taxYear: this.taxYear
            });
            await this.updateProgress('PROCESSING', 85);

            // Calculate tax
            const taxCalculation = await this.taxCalculator.calculateLiability({
                forms,
                bankData: categorizedTransactions,
                taxYear: this.taxYear
            });

            const returnData = {
                userId: this.userId,
                taxYear: this.taxYear,
                documents: this.sanitizeDocuments(docResults),
                forms,
                calculations: taxCalculation,
                aiSuggestions: aiAnalysis.suggestions,
                bankData: this.sanitizeBankData(categorizedTransactions),
                status: 'DRAFT',
                metadata: {
                    processedAt: admin.firestore.FieldValue.serverTimestamp(),
                    version: '1.0'
                }
            };

            await this.storeTaxReturn(returnData);
            await this.updateProgress('COMPLETED', 100);
            
            return returnData;

        } catch (error) {
            await this.logError(error);
            throw new Error(`Tax return processing failed: ${error.message}`);
        }
    }

    async validateSubscription(userId) {
        const subscription = await admin.firestore()
            .collection('subscriptions')
            .doc(userId)
            .get();
        
        if (!subscription.exists || !subscription.data().active) {
            throw new Error('Active subscription required');
        }
    }

    async storeDocument(file) {
        try {
            // Validate file
            await this.validateDocument(file);
            
            // Generate secure filename with type prefix
            const docType = await this.detectDocumentType(file);
            const filename = `${docType}-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
            const path = `users/${this.userId}/documents/${this.taxYear}/${filename}`;
            
            // Scan and process file
            await this.scanFile(file.buffer);
            const aiResult = await this.processWithDocumentAI(file);
            
            // Store in Firebase with enhanced metadata
            const bucket = admin.storage().bucket();
            await bucket.file(path).save(file.buffer, {
                metadata: {
                    contentType: file.mimetype,
                    metadata: {
                        originalName: file.originalname,
                        uploadedAt: new Date().toISOString(),
                        userId: this.userId,
                        taxYear: this.taxYear,
                        fileSize: file.size,
                        documentType: docType,
                        hashSum: crypto.createHash('sha256').update(file.buffer).digest('hex'),
                        aiProcessed: true,
                        aiConfidence: aiResult.confidence,
                        classification: aiResult.classification,
                        extractedData: JSON.stringify(aiResult.extractedData)
                    }
                },
                encryptionKey: this.getEncryptionKey(this.userId)
            });
            
            // Log document upload with enhanced tracking
            await this.logDocumentUpload(path, file, aiResult);
            
            return {
                path,
                metadata: {
                    contentType: file.mimetype,
                    uploadedAt: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'PROCESSED',
                    aiStatus: aiResult.status,
                    ready: true
                },
                extractedData: aiResult.extractedData
            };
        } catch (error) {
            await this.logError(error);
            throw new Error(`Document storage failed: ${error.message}`);
        }
    }

    async updateProgress(status, percentage) {
        await admin.firestore()
            .collection('users')
            .doc(this.userId)
            .collection('tax-returns')
            .doc(this.taxYear)
            .update({
                processingStatus: status,
                progress: percentage,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async storeTaxReturn(returnData) {
        await admin.firestore()
            .collection('users')
            .doc(this.userId)
            .collection('tax-returns')
            .doc(this.taxYear)
            .set(returnData, { merge: true });
    }

    async logError(error) {
        await admin.firestore()
            .collection('errors')
            .add({
                userId: this.userId,
                taxYear: this.taxYear,
                error: error.message,
                stack: error.stack,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async submitToHMRC(returnData) {
        try {
            // Validate return data
            await this.validateReturnForSubmission(returnData);
            
            // Submit to HMRC
            const hmrcResponse = await this.hmrcClient.submitReturn({
                utr: returnData.utr,
                taxYear: this.taxYear,
                formData: this.formatForHMRC(returnData.forms),
                attachments: this.prepareAttachments(returnData.documents)
            });

            // Update status in Firestore
            await this.updateSubmissionStatus(returnData.id, {
                hmrcSubmissionId: hmrcResponse.submissionId,
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'SUBMITTED',
                hmrcStatus: hmrcResponse.status
            });

            // Generate submission receipt
            const receipt = await this.generateSubmissionReceipt({
                ...returnData,
                hmrcResponse,
                submissionId: hmrcResponse.submissionId
            });

            return {
                success: true,
                submissionId: hmrcResponse.submissionId,
                status: hmrcResponse.status,
                receipt
            };

        } catch (error) {
            await this.logError(error);
            throw new Error(`HMRC submission failed: ${error.message}`);
        }
    }

    private async validateReturnForSubmission(returnData) {
        if (!returnData.status === 'APPROVED') {
            throw new Error('Return must be approved before submission');
        }
        
        const validation = await this.validateFinalReturn(returnData);
        if (!validation.isValid) {
            throw new Error(`Invalid return: ${validation.errors.join(', ')}`);
        }
    }

    async generatePDF(returnData) {
        try {
            // Validate return data
            if (!returnData.status === 'APPROVED') {
                throw new Error('Cannot generate PDF for unapproved return');
            }

            // Generate PDF with watermark and metadata
            const pdfBuffer = await this.pdfGenerator.createTaxReturn({
                ...returnData,
                watermark: this.generateWatermark(returnData),
                validationHash: this.calculateValidationHash(returnData)
            });

            const path = `users/${this.userId}/tax-returns/${this.taxYear}/return.pdf`;

            // Store with enhanced security metadata
            await admin.storage().bucket().file(path).save(pdfBuffer, {
                metadata: {
                    contentType: 'application/pdf',
                    metadata: {
                        returnId: returnData.id,
                        taxYear: this.taxYear,
                        userId: this.userId,
                        generatedAt: new Date().toISOString(),
                        hashSum: crypto.createHash('sha256').update(pdfBuffer).digest('hex'),
                        approved: true,
                        version: '1.0',
                        encryptionStatus: 'AES256',
                        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
                    }
                }
            });

            // Generate secure signed URL
            const [downloadUrl] = await admin.storage()
                .bucket()
                .file(path)
                .getSignedUrl({
                    action: 'read',
                    expires: Date.now() + 24 * 60 * 60 * 1000,
                    version: 'v4',
                    virtualHostedStyle: true
                });

            // Track PDF status
            await this.updateReturnMetadata(returnData.id, {
                pdfGenerated: true,
                pdfPath: path,
                pdfGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
                pdfStatus: 'READY',
                downloadExpiry: new Date(Date.now() + 24 * 60 * 60 * 1000)
            });

            return { 
                downloadUrl,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
            };
        } catch (error) {
            await this.logError(error);
            throw new Error(`PDF generation failed: ${error.message}`);
        }
    }

    async reviewAndApprove(returnId, changes) {
        const returnRef = admin.firestore()
            .collection('users')
            .doc(this.userId)
            .collection('tax-returns')
            .doc(returnId);

        await admin.firestore().runTransaction(async (transaction) => {
            const returnDoc = await transaction.get(returnRef);
            if (!returnDoc.exists) {
                throw new Error('Tax return not found');
            }

            const returnData = returnDoc.data();
            const updatedReturnData = {
                ...returnData,
                ...changes,
                status: 'APPROVED',
                metadata: {
                    ...returnData.metadata,
                    approvedAt: admin.firestore.FieldValue.serverTimestamp()
                }
            };

            transaction.update(returnRef, updatedReturnData);
        });
    }
}

module.exports = TaxReturnService;