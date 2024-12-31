import { getFirestore } from 'firebase-admin/firestore';
import { PDFDocument } from 'pdf-lib';
import { HMRCService } from './HMRCService.js';

export class TaxFormManager {
    constructor(db, hmrcService, aiAssistant) {
        this.db = db;
        this.hmrcService = hmrcService;
        this.aiAssistant = aiAssistant;
        this.formTemplate = 'SA100';
    }

    async initialize(userId) {
        this.userId = userId;
        this.userFormRef = this.db.collection('taxReturns').doc(userId);
        await this.loadExistingForm();
    }

    async loadExistingForm() {
        const doc = await this.userFormRef.get();
        this.currentForm = doc.exists ? doc.data() : this.createNewForm();
        return this.currentForm;
    }

    async updateField(fieldName, value) {
        try {
            const validation = await this.aiAssistant.validateField(fieldName, value, this.currentForm);
            if (!validation.isValid) {
                throw new Error(validation.message);
            }

            await this.userFormRef.update({
                [`fields.${fieldName}`]: value,
                updatedAt: new Date()
            });

            await this.recalculateTotals();
            return { success: true, validation };
        } catch (error) {
            console.error(`Field update failed: ${fieldName}`, error);
            throw error;
        }
    }

    async generatePDF() {
        try {
            const template = await PDFDocument.load(this.getTemplate());
            const form = template.getForm();
            
            Object.entries(this.currentForm.fields).forEach(([field, value]) => {
                const formField = form.getTextField(field);
                if (formField) formField.setText(value.toString());
            });

            const pdfBytes = await template.save();
            await this.savePDF(pdfBytes);
            
            return { success: true, pdfUrl: await this.getPDFUrl() };
        } catch (error) {
            console.error('PDF generation failed:', error);
            throw error;
        }
    }

    async submitToHMRC() {
        try {
            const submission = await this.hmrcService.submitReturn(this.currentForm);
            await this.userFormRef.update({
                status: 'SUBMITTED',
                submissionId: submission.id,
                submittedAt: new Date()
            });
            return submission;
        } catch (error) {
            console.error('HMRC submission failed:', error);
            throw error;
        }
    }

    private createNewForm() {
        return {
            taxYear: new Date().getFullYear() - 1,
            status: 'DRAFT',
            fields: {},
            calculations: {
                totalIncome: 0,
                totalExpenses: 0,
                taxDue: 0
            },
            createdAt: new Date()
        };
    }

    private async recalculateTotals() {
        const calculations = {
            totalIncome: this.calculateTotalIncome(),
            totalExpenses: this.calculateTotalExpenses(),
            taxDue: await this.calculateTaxDue()
        };

        await this.userFormRef.update({ calculations });
        return calculations;
    }
}