const FormValidator = require('../utils/validation');
const { v4: uuidv4 } = require('uuid');

class ReviewService {
    constructor(formData) {
        this.formData = formData;
        this.validator = new FormValidator();
        this.submissionId = uuidv4();
        this.status = 'DRAFT';
    }

    async validateSubmission() {
        const validationResults = {
            sa100: this.validator.validateForm('sa100', this.formData.sa100),
            sa103: this.validator.validateForm('sa103', this.formData.sa103),
            timestamp: new Date(),
            submissionId: this.submissionId
        };

        this.status = this.isValid(validationResults) ? 'READY' : 'INCOMPLETE';
        return validationResults;
    }

    isValid(results) {
        return !Object.values(results).some(form => 
            Array.isArray(form) && form.length > 0
        );
    }

    async prepareSubmission() {
        const validation = await this.validateSubmission();
        if (this.status !== 'READY') {
            throw new Error('Form validation failed');
        }

        return {
            id: this.submissionId,
            forms: this.formData,
            validation,
            status: this.status,
            timestamp: new Date(),
            signature: null
        };
    }

    async signSubmission(signature) {
        if (this.status !== 'READY') {
            throw new Error('Cannot sign invalid submission');
        }

        this.formData.signature = {
            timestamp: new Date(),
            signatory: signature.name,
            declaration: true
        };

        this.status = 'SIGNED';
        return this.formData;
    }
}

module.exports = ReviewService;