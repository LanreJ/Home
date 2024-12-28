class ErrorHandler {
    constructor(db, notifier) {
        this.db = db;
        this.notifier = notifier;
        this.maxRetries = 3;
        this.retryableErrors = [408, 429, 500, 502, 503, 504];
    }

    async handleError(error, submissionId) {
        const errorRecord = {
            code: error.response?.status || 500,
            message: error.response?.data?.message || error.message,
            timestamp: new Date(),
            retryable: this.isRetryableError(error)
        };

        await this.logError(errorRecord, submissionId);

        if (errorRecord.retryable) {
            return this.handleRetryableError(submissionId);
        }

        return this.handleFatalError(submissionId, errorRecord);
    }

    async handleRetryableError(submissionId) {
        const submission = await this.getSubmission(submissionId);
        
        if (submission.attempts >= this.maxRetries) {
            return this.handleMaxRetriesExceeded(submissionId);
        }

        return this.scheduleRetry(submissionId, submission.attempts + 1);
    }

    async scheduleRetry(submissionId, attempts) {
        const delay = Math.min(
            5 * 60 * 1000 * Math.pow(2, attempts - 1), // Start at 5 mins
            4 * 60 * 60 * 1000 // Max 4 hours
        );

        await this.db.collection('retry_queue').add({
            submissionId,
            attempts,
            scheduledFor: new Date(Date.now() + delay),
            status: 'PENDING'
        });

        await this.updateSubmissionStatus(submissionId, 'RETRY_SCHEDULED');
        await this.createAuditLog(submissionId, 'RETRY_SCHEDULED', { attempts, delay });
    }

    async handleFatalError(submissionId, errorRecord) {
        await Promise.all([
            this.updateSubmissionStatus(submissionId, 'FAILED'),
            this.notifyAdmin(submissionId, errorRecord),
            this.createAuditLog(submissionId, 'FATAL_ERROR', errorRecord)
        ]);

        return {
            status: 'FAILED',
            error: errorRecord,
            submissionId
        };
    }

    async handleMaxRetriesExceeded(submissionId) {
        const errorRecord = {
            code: 'MAX_RETRIES_EXCEEDED',
            message: 'Maximum retry attempts reached',
            timestamp: new Date()
        };

        await this.notifier.send({
            type: 'MAX_RETRIES_REACHED',
            submissionId,
            details: errorRecord
        });

        return this.handleFatalError(submissionId, errorRecord);
    }

    async getSubmission(submissionId) {
        const doc = await this.db.collection('submissions')
            .doc(submissionId)
            .get();
        return doc.data();
    }

    async createAuditLog(submissionId, type, details) {
        return this.db.collection('audit_logs').add({
            submissionId,
            type,
            details,
            timestamp: new Date()
        });
    }

    async logError(errorRecord, submissionId) {
        await this.db.collection('error_logs').add({
            ...errorRecord,
            submissionId,
            createdAt: new Date()
        });
    }

    isRetryableError(error) {
        return this.retryableErrors.includes(error.response?.status);
    }

    async updateSubmissionStatus(submissionId, status, details = {}) {
        await this.db.collection('submissions')
            .doc(submissionId)
            .update({
                status,
                ...details,
                updatedAt: new Date()
            });
    }

    async processRetryQueue() {
        const now = new Date();
        const retryQueue = await this.db.collection('retry_queue')
            .where('scheduledFor', '<=', now)
            .where('status', '==', 'PENDING')
            .get();

        const retryPromises = retryQueue.docs.map(async (doc) => {
            const { submissionId, attempts } = doc.data();
            await this.handleRetryableError(submissionId);
            await doc.ref.update({ status: 'PROCESSED' });
        });

        await Promise.all(retryPromises);
    }
}

module.exports = ErrorHandler;