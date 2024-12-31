import axios from 'axios';
import { getFirestore } from 'firebase-admin/firestore';
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const admin = require('firebase-admin');

export class HMRCService {
    constructor(credentials) {
        this.credentials = credentials;
        this.db = getFirestore();
        this.baseUrl = process.env.HMRC_API_URL;
        this.endpoints = {
            token: '/oauth/token',
            submit: '/self-assessment/individual/{utr}/return',
            status: '/self-assessment/status/{id}'
        };
    }

    async submitReturn(taxReturn) {
        const token = await this.getAccessToken();
        const endpoint = this.endpoints.submit.replace('{utr}', taxReturn.utr);
        
        try {
            const response = await axios.post(
                `${this.baseUrl}${endpoint}`,
                this.formatReturn(taxReturn),
                this.getRequestConfig(token)
            );
            
            await this.saveSubmission(taxReturn.id, response.data);
            return response.data;
        } catch (error) {
            throw this.handleError(error);
        }
    }

    async getReturnStatus(submissionId) {
        try {
            const token = await this.getAccessToken();
            const response = await axios.get(
                `${this.baseUrl}/self-assessment/status/${submissionId}`,
                {
                    headers: { 'Authorization': `Bearer ${token}` }
                }
            );
            return response.data;
        } catch (error) {
            console.error('Status check failed:', error);
            throw this.handleError(error);
        }
    }

    private async getAccessToken() {
        const token = await this.retrieveStoredToken();
        if (token && this.isTokenValid(token)) {
            return token.access_token;
        }
        return await this.refreshAccessToken();
    }

    private async refreshAccessToken() {
        const response = await axios.post(
            `${this.baseUrl}${this.endpoints.token}`,
            {
                grant_type: 'client_credentials',
                client_id: this.credentials.clientId,
                client_secret: this.credentials.clientSecret
            }
        );

        await this.saveToken(response.data);
        return response.data.access_token;
    }

    private getRequestConfig(token) {
        return {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        };
    }

    private async saveSubmission(returnId, response) {
        await this.db.collection('submissions')
            .doc(returnId)
            .set({
                status: response.status,
                submissionId: response.id,
                timestamp: new Date(),
                response: response
            });
    }

    private handleError(error) {
        if (error.response) {
            return new Error(`HMRC API error: ${error.response.data.message}`);
        }
        return error;
    }

    // ...existing code...
}

export async function submitHMRCData(data) {
    const hmrcService = new HMRCService(await getHMRCCredentials());
    return await hmrcService.submitReturn(data);
}