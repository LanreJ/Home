const axios = require('axios');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

class HMRCService {
    constructor() {
        this.baseUrl = process.env.HMRC_API_URL || 'https://test-api.service.hmrc.gov.uk';
        this.secrets = new SecretManagerServiceClient();
        this.endpoints = {
            auth: '/oauth/token',
            submit: '/self-assessment/individual/{utr}/return'
        };
    }

    async getCredentials() {
        const clientId = await this.getSecret('HMRC_CLIENT_ID');
        const clientSecret = await this.getSecret('HMRC_CLIENT_SECRET');
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

    async submitReturn(utr, formData) {
        const token = await this.authenticate();
        const endpoint = this.endpoints.submit.replace('{utr}', utr);
        
        try {
            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                this.formatSubmission(formData),
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            
            return {
                correlationId: response.headers['x-correlation-id'],
                submissionId: response.data.submissionId,
                timestamp: new Date(),
                status: response.data.status
            };
        } catch (error) {
            throw this.handleHMRCError(error);
        }
    }

    formatSubmission(formData) {
        return {
            periodStart: formData.sa100.taxYear.start,
            periodEnd: formData.sa100.taxYear.end,
            forms: {
                sa100: formData.sa100,
                sa103: formData.sa103
            }
        };
    }
}

module.exports = HMRCService;