const HMRCService = require('./HMRCService');
const SubmissionTracker = require('./SubmissionTracker');
const HMRCError = require('./HMRCErrors');
const { v4: uuidv4 } = require('uuid');

class HMRCSubmissionController {
    constructor() {
        this.hmrcService = new HMRCService();
        this.tracker = new SubmissionTracker();
        this.retryManager = new RetryManager(3);
        this.statusPoller = new StatusPoller(this.hmrcService, this.tracker);
    }

    async submit(formData, utr) {
        const correlationId = uuidv4();
        const submissionRecord = await this.tracker.trackSubmission({
            correlationId,
            utr,
            formData: { id: formData.id, taxYear: formData.taxYear }
        });

        try {
            const result = await this.retryManager.retry(
                () => this.hmrcService.submitReturn(utr, formData)
            );

            await this.tracker.updateStatus(submissionRecord, 'SUBMITTED', {
                hmrcSubmissionId: result.submissionId,
                submittedAt: new Date()
            });

            // Begin status polling
            await this.statusPoller.startPolling(result.submissionId);
            
            return {
                submissionId: submissionRecord,
                correlationId,
                status: 'SUBMITTED',
                timestamp: new Date()
            };

        } catch (error) {
            await this.handleSubmissionError(submissionRecord, error);
            throw new HMRCError(
                'Submission failed',
                error.code || 'SUBMISSION_ERROR',
                correlationId
            );
        }
    }

    async checkSubmissionStatus(submissionId) {
        const status = await this.tracker.getSubmissionStatus(submissionId);
        if (!status) {
            throw new HMRCError('Submission not found', 'NOT_FOUND');
        }
        return status;
    }

    async handleSubmissionError(submissionId, error) {
        const errorDetails = {
            code: error.code || 'UNKNOWN_ERROR',
            message: error.message,
            timestamp: new Date(),
            retryable: this.isRetryableError(error)
        };

        await this.tracker.updateStatus(submissionId, 'FAILED', errorDetails);
        await this.logError(submissionId, errorDetails);
    }

    async validateSubmission(formData) {
        const validationErrors = [];
        
        if (!formData.utr) validationErrors.push('UTR is required');
        if (!formData.taxYear) validationErrors.push('Tax year is required');
        if (!formData.declaration) validationErrors.push('Declaration is required');

        return validationErrors;
    }

    async logError(submissionId, errorDetails) {
        await this.tracker.addAuditLog(submissionId, {
            type: 'ERROR',
            details: errorDetails,
            timestamp: new Date()
        });
    }

    async retrySubmission(submissionId) {
        const submission = await this.tracker.getSubmissionStatus(submissionId);
        if (!submission.errorDetails?.retryable) {
            throw new Error('Submission is not retryable');
        }

        await this.tracker.updateStatus(submissionId, 'RETRY_PENDING');
        return this.submit(submission.formData, submission.utr);
    }

    isRetryableError(error) {
        return ['TIMEOUT', 'RATE_LIMIT', 'SERVER_ERROR'].includes(error.code);
    }
}

module.exports = HMRCSubmissionController;