const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const admin = require('firebase-admin');

class HMRCService {
    constructor() {
        // Initialize Firebase Admin if not already initialized
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.applicationDefault(),
                projectId: process.env.PROJECT_ID
            });
        }

        this.baseUrl = process.env.HMRC_API_URL || 'https://test-api.service.hmrc.gov.uk';
        this.secrets = new SecretManagerServiceClient();
        this.endpoints = {
            auth: '/oauth/token',
            submit: '/self-assessment/individual/{utr}/return',
            status: '/self-assessment/individual/{utr}/status/{submissionId}'
        };
        this.retryAttempts = 3;
        this.retryDelay = 1000;
    }

    async getSecret(secretName) {
        const name = `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`;
        try {
            const [version] = await this.secrets.accessSecretVersion({ name });
            return version.payload.data.toString();
        } catch (error) {
            console.error(`Failed to access secret ${secretName}:`, error);
            throw new Error('Failed to access secret configuration');
        }
    }

    async getCredentials() {
        const [clientId, clientSecret] = await Promise.all([
            this.getSecret('HMRC_CLIENT_ID'),
            this.getSecret('HMRC_CLIENT_SECRET')
        ]);
        return { clientId, clientSecret };
    }

    async authenticate() {
        const { clientId, clientSecret } = await this.getCredentials();
        const response = await axios.post(`${this.baseUrl}${this.endpoints.auth}`, {
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret
        });
        return response.data.access_token;
    }

    async submitReturn(returnData) {
        try {
            await this.validateReturn(returnData);
            const token = await this.authenticate();
            const formattedData = this.formatForHMRC(returnData);
            
            const response = await this.submitWithRetry(returnData.utr, formattedData, token);
            
            const result = {
                success: true,
                submissionId: response.data.id,
                status: response.data.status,
                timestamp: new Date().toISOString()
            };

            await this.logSubmission(returnData.id, result);
            return result;

        } catch (error) {
            await this.logError(error);
            throw this.handleError(error);
        }
    }

    async submitWithRetry(utr, data, token, attempt = 1) {
        try {
            return await axios.post(
                `${this.baseUrl}${this.endpoints.submit.replace('{utr}', utr)}`,
                data,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
        } catch (error) {
            if (attempt < this.retryAttempts && this.shouldRetry(error)) {
                await new Promise(resolve => setTimeout(resolve, this.retryDelay * attempt));
                return this.submitWithRetry(utr, data, token, attempt + 1);
            }
            throw error;
        }
    }

    async checkStatus(submissionId, utr) {
        try {
            const token = await this.authenticate();
            const endpoint = this.endpoints.status
                .replace('{utr}', utr)
                .replace('{submissionId}', submissionId);

            const response = await axios.get(`${this.baseUrl}${endpoint}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });

            await this.updateSubmissionStatus(submissionId, {
                status: response.data.status,
                details: response.data,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return response.data;

        } catch (error) {
            await this.logError(error);
            throw this.handleError(error);
        }
    }

    async validateReturn(returnData) {
        const required = ['utr', 'taxYear', 'income', 'expenses'];
        const missing = required.filter(field => !returnData[field]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required fields: ${missing.join(', ')}`);
        }
    }

    formatForHMRC(returnData) {
        return {
            taxYear: returnData.taxYear,
            returnType: 'SA100',
            data: {
                income: returnData.income,
                expenses: returnData.expenses,
                declarations: {
                    accurate: true,
                    complete: true
                }
            }
        };
    }

    async logSubmission(returnId, response) {
        await admin.firestore()
            .collection('hmrc_submissions')
            .add({
                returnId,
                response,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                status: response.status
            });
    }

    async updateSubmissionStatus(submissionId, status) {
        await admin.firestore()
            .collection('hmrc_submissions')
            .doc(submissionId)
            .update({
                status,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async logError(error) {
        await admin.firestore()
            .collection('errors')
            .add({
                service: 'HMRC',
                error: error.message,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    handleError(error) {
        if (error.response) {
            return new Error(`HMRC API Error: ${error.response.data.message}`);
        }
        return error;
    }

    async verifyCredentials() {
        try {
            const credentials = await this.getCredentials();
            return {
                success: true,
                hasClientId: !!credentials.clientId,
                hasClientSecret: !!credentials.clientSecret
            };
        } catch (error) {
            throw new Error(`Failed to verify credentials: ${error.message}`);
        }
    }
}

module.exports = HMRCService;