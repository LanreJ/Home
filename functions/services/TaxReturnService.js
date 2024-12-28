import { FormProcessor } from './forms/FormProcessor';
import { DocumentProcessor } from './DocumentProcessor';
import { admin } from '../config/firebase';

class TaxReturnService {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.formProcessor = new FormProcessor(taxYear);
        this.documentProcessor = new DocumentProcessor(process.env.PROCESSOR_ID);
    }

    async processReturn(files, userId) {
        const docs = await this.documentProcessor.process(files);
        const data = await this.extractTaxData(docs);
        return this.formProcessor.generateTaxReturn(data);
    }

    async processDocuments(files) {
        const processingResults = new Map();
        const errors = [];

        try {
            // Process each document
            for (const file of files) {
                try {
                    const result = await this.documentProcessor.process(file);
                    processingResults.set(file.name, result);
                } catch (error) {
                    errors.push({ file: file.name, error: error.message });
                }
            }

            // Generate tax forms from processed documents
            const formData = await this.formGenerator.generateForms(processingResults);

            // Store results
            const returnRef = await this.storeReturnData(formData, processingResults);

            // Track status
            await this.updateStatus(returnRef.id, {
                status: 'PROCESSING_COMPLETE',
                documentCount: files.length,
                processedCount: processingResults.size,
                errorCount: errors.length
            });

            // Validate forms
            const validationResults = await this.validateForms(formData);
            if (!validationResults.isValid) {
                await this.updateStatus(returnRef.id, {
                    status: 'NEEDS_REVIEW',
                    validationErrors: validationResults.errors
                });
            }

            return {
                success: true,
                returnId: returnRef.id,
                status: validationResults.isValid ? 'READY' : 'NEEDS_REVIEW',
                processedDocuments: processingResults.size,
                errors: errors.length > 0 ? errors : null,
                validation: validationResults
            };

        } catch (error) {
            logger.error('Tax return processing failed:', error);
            throw new Error(`Processing failed: ${error.message}`);
        }
    }

    async storeReturnData(formData, processingResults) {
        return admin.firestore()
            .collection('tax_returns')
            .add({
                taxYear: this.taxYear,
                status: 'DRAFT',
                forms: Object.fromEntries(formData),
                processedDocuments: Array.from(processingResults.keys()),
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                metadata: {
                    version: '1.0',
                    documentCount: processingResults.size
                }
            });
    }

    async validateForms(formData) {
        const errors = [];
        const warnings = [];

        for (const [formType, data] of formData.entries()) {
            const result = await this.formGenerator.validateForm(formType, data);
            if (result.errors) errors.push(...result.errors);
            if (result.warnings) warnings.push(...result.warnings);
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            timestamp: new Date()
        };
    }

    async submitTaxReturn(returnId) {
        try {
            // Get return data
            const returnRef = admin.firestore().collection('tax_returns').doc(returnId);
            const returnDoc = await returnRef.get();
            
            if (!returnDoc.exists) {
                throw new Error('Tax return not found');
            }

            // Validate before submission
            const validationResult = await this.validateForms(returnDoc.data().forms);
            if (!validationResult.isValid) {
                throw new Error('Tax return validation failed');
            }

            // Submit to HMRC
            const hmrcResponse = await this.submitToHMRC(returnDoc.data());

            // Store submission result
            await returnRef.update({
                status: 'SUBMITTED',
                submissionId: hmrcResponse.submissionId,
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                hmrcResponse: hmrcResponse
            });

            return {
                success: true,
                submissionId: hmrcResponse.submissionId,
                status: 'SUBMITTED',
                timestamp: new Date()
            };

        } catch (error) {
            await this.handleSubmissionError(returnId, error);
            throw error;
        }
    }

    async submitToHMRC(returnData) {
        // HMRC API integration
        // Implementation pending HMRC API credentials
        throw new Error('HMRC submission not yet implemented');
    }

    async handleSubmissionError(returnId, error) {
        await admin.firestore()
            .collection('tax_returns')
            .doc(returnId)
            .update({
                status: 'SUBMISSION_FAILED',
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN_ERROR',
                    timestamp: admin.firestore.FieldValue.serverTimestamp()
                }
            });
    }

    async updateStatus(returnId, statusData) {
        return admin.firestore()
            .collection('tax_returns')
            .doc(returnId)
            .update({
                ...statusData,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async generateAndValidateForms(processingResults) {
        const formTypes = this.determineRequiredForms(processingResults);
        const forms = new Map();

        for (const formType of formTypes) {
            const formData = await this.mapDataToForm(formType, processingResults);
            const validation = await this.validateFormData(formType, formData);
            
            forms.set(formType, {
                data: formData,
                validation: validation,
                status: validation.isValid ? 'READY' : 'NEEDS_REVIEW'
            });
        }

        return forms;
    }

    determineRequiredForms(processingResults) {
        const forms = new Set(['SA100']); // Always include main return
        
        // Check for additional forms based on data
        for (const result of processingResults.values()) {
            if (result.hasPropertyIncome) forms.add('SA105');
            if (result.hasSelfEmployment) forms.add('SA103');
            if (result.hasInvestmentIncome) forms.add('SA104');
        }

        return Array.from(forms);
    }

    async validateFormData(formType, formData) {
        const validationRules = {
            SA100: this.validateSA100,
            SA105: this.validateSA105,
            SA103: this.validateSA103,
            SA104: this.validateSA104
        };

        const validate = validationRules[formType];
        if (!validate) {
            throw new Error(`No validation rules for form: ${formType}`);
        }

        return validate.call(this, formData);
    }

    validateSA100(formData) {
        const required = ['name', 'utr', 'nino', 'address'];
        const errors = [];
        const warnings = [];

        // Check required fields
        for (const field of required) {
            if (!formData[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate UTR format
        if (formData.utr && !/^\d{10}$/.test(formData.utr)) {
            errors.push('Invalid UTR format');
        }

        // Validate NINO format
        if (formData.nino && !/^[A-Z]{2}\d{6}[A-D]$/.test(formData.nino)) {
            errors.push('Invalid NINO format');
        }

        // Business rules
        if (formData.totalIncome > 100000) {
            warnings.push('High income detected - additional verification required');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    validateSA105(formData) {
        const required = ['propertyAddress', 'income', 'expenses'];
        const errors = [];
        const warnings = [];

        // Check required fields
        for (const field of required) {
            if (!formData[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Validate amounts
        if (formData.income && formData.income < 0) {
            errors.push('Income cannot be negative');
        }

        // Business rules
        if (formData.expenses / formData.income > 0.8) {
            warnings.push('High expense ratio detected');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    validateSA103(formData) {
        const required = ['businessName', 'businessIncome', 'expenses', 'tradingPeriodFrom', 'tradingPeriodTo'];
        const errors = [];
        const warnings = [];

        // Required fields
        for (const field of required) {
            if (!formData[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Amount validation
        if (formData.businessIncome < 0) {
            errors.push('Business income cannot be negative');
        }

        // Trading period validation
        if (formData.tradingPeriodFrom && formData.tradingPeriodTo) {
            const periodStart = new Date(formData.tradingPeriodFrom);
            const periodEnd = new Date(formData.tradingPeriodTo);
            
            if (periodEnd < periodStart) {
                errors.push('Trading period end date must be after start date');
            }
        }

        // Business rules
        if (formData.businessIncome > 85000) {
            warnings.push('VAT threshold exceeded - VAT registration may be required');
        }

        if (formData.expenses / formData.businessIncome > 0.9) {
            warnings.push('High expense ratio detected - additional documentation may be required');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    validateSA104(formData) {
        const required = ['investmentType', 'grossIncome', 'taxDeducted'];
        const errors = [];
        const warnings = [];

        // Required fields
        for (const field of required) {
            if (!formData[field]) {
                errors.push(`Missing required field: ${field}`);
            }
        }

        // Investment type validation
        const validInvestmentTypes = ['dividend', 'interest', 'trust', 'foreign'];
        if (!validInvestmentTypes.includes(formData.investmentType)) {
            errors.push('Invalid investment type');
        }

        // Amount validation
        if (formData.grossIncome < 0) {
            errors.push('Investment income cannot be negative');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    async validateAllForms(forms) {
        const totalIncome = this.calculateTotalIncome(forms);
        const crossValidationWarnings = [];

        if (totalIncome > 150000) {
            crossValidationWarnings.push('Additional rate tax band - detailed review required');
        }

        return {
            totalIncome,
            warnings: crossValidationWarnings
        };
    }

    calculateTotalIncome(forms) {
        let total = 0;
        if (forms.has('SA103')) total += forms.get('SA103').data.businessIncome || 0;
        if (forms.has('SA105')) total += forms.get('SA105').data.income || 0;
        if (forms.has('SA104')) total += forms.get('SA104').data.grossIncome || 0;
        return total;
    }
}

export { TaxReturnService };