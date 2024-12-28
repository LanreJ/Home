const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

class HMRCSubmissionService {
    constructor() {
        this.baseUrl = process.env.HMRC_API_URL;
        this.secrets = new SecretManagerServiceClient();
        this.endpoints = {
            auth: '/oauth/token',
            submit: '/self-assessment/individual/{utr}/return',
            status: '/self-assessment/individual/{utr}/status'
        };
    }

    async submitReturn(formData, utr) {
        try {
            const token = await this.getAuthToken();
            const endpoint = this.endpoints.submit.replace('{utr}', utr);
            
            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                this.formatSubmissionData(formData),
                this.getRequestConfig(token)
            );

            const submissionRecord = await this.createSubmissionRecord({
                id: response.data.id,
                correlationId: response.headers['x-correlation-id'],
                status: 'SUBMITTED',
                formData,
                utr
            });

            await this.startStatusTracking(submissionRecord.id);
            return submissionRecord;

        } catch (error) {
            const enhancedError = await this.handleError(error, { utr, formData });
            throw enhancedError;
        }
    }

    async getAuthToken() {
        const [clientId, clientSecret] = await Promise.all([
            this.secrets.getSecret('HMRC_CLIENT_ID'),
            this.secrets.getSecret('HMRC_CLIENT_SECRET')
        ]);

        const response = await axios.post(`${this.baseUrl}${this.endpoints.auth}`, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        });

        return response.data.access_token;
    }

    getRequestConfig(token) {
        return {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.hmrc.2.0+json'
            }
        };
    }

    async handleSubmissionError(error, utr) {
        const errorDetails = {
            code: error.response?.status || 500,
            message: error.response?.data?.message || error.message,
            timestamp: new Date(),
            retryable: this.isRetryableError(error)
        };

        await this.logError(errorDetails);
        return new HMRCError(errorDetails.message, errorDetails.code);
    }

    async trackSubmissionStatus(submissionId, utr) {
        const token = await this.getAuthToken();
        const endpoint = this.endpoints.status
            .replace('{utr}', utr)
            .replace('{submissionId}', submissionId);

        try {
            const response = await axios.get(
                `${this.baseUrl}${endpoint}`,
                this.getRequestConfig(token)
            );

            const status = response.data.status;
            await this.updateSubmissionStatus(submissionId, status);
            await this.createStatusHistory(submissionId, status);

            if (this.isTerminalStatus(status)) {
                await this.handleTerminalStatus(submissionId, status);
            }

            return {
                status,
                lastUpdated: new Date(),
                details: response.data
            };

        } catch (error) {
            await this.handleStatusError(error, submissionId);
            throw error;
        }
    }

    async updateSubmissionStatus(submissionId, status) {
        await this.db.collection('submissions')
            .doc(submissionId)
            .update({
                status,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    isRetryableError(error) {
        const retryableCodes = [408, 429, 500, 502, 503, 504];
        return retryableCodes.includes(error.response?.status);
    }

    async handleStatusError(error, submissionId) {
        const errorDetails = {
            submissionId,
            code: error.response?.status || 500,
            message: error.response?.data?.message || error.message,
            timestamp: new Date()
        };

        await this.logError(errorDetails);

        if (this.isRetryableError(error)) {
            await this.scheduleRetry(submissionId);
        } else {
            await this.markAsFailed(submissionId, errorDetails);
        }
    }

    async scheduleRetry(submissionId) {
        const submission = await this.getSubmission(submissionId);
        const attempts = submission.attempts || 0;

        if (attempts >= this.maxRetries) {
            return this.markAsFailed(submissionId, {
                code: 'MAX_RETRIES_EXCEEDED',
                message: 'Maximum retry attempts reached'
            });
        }

        await this.db.collection('retry_queue').add({
            submissionId,
            attempts: attempts + 1,
            nextRetry: this.calculateNextRetry(attempts),
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        await this.updateSubmissionStatus(submissionId, 'PENDING_RETRY');
    }

    async markAsFailed(submissionId, details) {
        await Promise.all([
            this.updateSubmissionStatus(submissionId, 'FAILED'),
            this.notifyAdmin({
                type: 'SUBMISSION_FAILED',
                submissionId,
                details
            }),
            this.createAuditLog(submissionId, 'FAILURE', details)
        ]);
    }

    calculateNextRetry(attempts) {
        const baseDelay = 5 * 60 * 1000; // 5 minutes
        const maxDelay = 4 * 60 * 60 * 1000; // 4 hours
        const delay = Math.min(baseDelay * Math.pow(2, attempts), maxDelay);
        return new Date(Date.now() + delay);
    }

    async logError(errorDetails) {
        await this.db.collection('submission_errors').add({
            ...errorDetails,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    async saveSubmission(record) {
        return await this.db.collection('hmrc_submissions').doc(record.id).set({
            ...record,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    formatSubmissionData(formData) {
        return {
            periodStart: formData.taxYear.start,
            periodEnd: formData.taxYear.end,
            forms: {
                sa105: formData.sa105Data
            },
            declaration: {
                accepted: true,
                timestamp: new Date()
            }
        };
    }

    async createSubmissionRecord(data) {
        const record = {
            ...data,
            timestamp: new Date(),
            environment: process.env.NODE_ENV,
            attempts: 1
        };

        await this.db.collection('hmrc_submissions')
            .doc(data.id)
            .set(record);

        return record;
    }

    async startStatusTracking(submissionId) {
        return await this.db.collection('submission_tracking').add({
            submissionId,
            status: 'PENDING',
            nextCheck: new Date(Date.now() + 5 * 60000),
            createdAt: new Date()
        });
    }

    async retrySubmission(submissionId, maxRetries = 3) {
        const submission = await this.db.collection('submissions')
            .doc(submissionId)
            .get();

        if (submission.data().attempts >= maxRetries) {
            throw new Error('Max retry attempts exceeded');
        }

        await this.updateSubmissionStatus(submissionId, 'RETRYING');
        return this.submitReturn(submission.data().formData, submission.data().utr);
    }

    async pollSubmissionStatus(submissionId) {
        const submission = await this.db.collection('submissions')
            .doc(submissionId)
            .get();

        const status = await this.checkHMRCStatus(
            submission.data().correlationId,
            submission.data().utr
        );

        await this.updateSubmissionStatus(submissionId, status);
        await this.logAuditTrail(submissionId, 'STATUS_CHECK', status);

        return status;
    }

    async logAuditTrail(submissionId, action, details) {
        await this.db.collection('audit_trail').add({
            submissionId,
            action,
            details,
            timestamp: admin.firestore.FieldValue.serverTimestamp(),
            userId: this.getCurrentUser(),
            environment: process.env.NODE_ENV
        });
    }

    getCurrentUser() {
        // Get from auth context
        return process.env.FIREBASE_AUTH_UID || 'system';
    }

    isTerminalStatus(status) {
        return ['ACCEPTED', 'REJECTED', 'FAILED'].includes(status);
    }

    async createStatusHistory(submissionId, status) {
        await this.db.collection('submission_history').add({
            submissionId,
            status,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
        });
    }

    async handleTerminalStatus(submissionId, status) {
        const notification = {
            type: status === 'ACCEPTED' ? 'SUCCESS' : 'ERROR',
            message: `Submission ${status.toLowerCase()}`,
            submissionId
        };
        
        await this.notifyUser(notification);
    }
}

module.exports = HMRCSubmissionService;