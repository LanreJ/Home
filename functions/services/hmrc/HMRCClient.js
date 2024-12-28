import axios from 'axios';

class HMRCClient {
    constructor(config) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.applicationId = config.applicationId;
        this.baseUrl = 'https://test-api.service.hmrc.gov.uk';
        this.authToken = null;
    }

    async authenticate() {
        const response = await axios.post(
            `${this.baseUrl}/oauth/token`,
            {
                grant_type: 'client_credentials',
                client_id: this.clientId,
                client_secret: this.clientSecret
            }
        );
        this.authToken = response.data.access_token;
        return this.authToken;
    }

    async submitTaxReturn(taxReturn) {
        if (!this.authToken) {
            await this.authenticate();
        }

        return axios.post(
            `${this.baseUrl}/self-assessment/individual/${taxReturn.utr}/return`,
            taxReturn,
            {
                headers: {
                    Authorization: `Bearer ${this.authToken}`,
                    'X-Application-Id': this.applicationId
                }
            }
        );
    }
}

export { HMRCClient };