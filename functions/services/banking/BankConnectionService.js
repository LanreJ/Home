const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

class BankConnectionService {
    constructor() {
        this.secretManager = new SecretManagerServiceClient();
        this.plaidClient = null;
        this.taxCategories = {
            RENTAL_INCOME: ['rent', 'rental payment', 'tenant payment'],
            MORTGAGE: ['mortgage payment', 'mortgage interest'],
            PROPERTY_EXPENSE: ['repairs', 'maintenance', 'insurance'],
            UTILITIES: ['gas', 'electric', 'water', 'council tax']
        };
    }

    async initialize() {
        const [clientId, secret] = await Promise.all([
            this.getSecret('PLAID_CLIENT_ID'),
            this.getSecret('PLAID_SECRET')
        ]);

        const config = new Configuration({
            basePath: PlaidEnvironments.sandbox,
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': clientId,
                    'PLAID-SECRET': secret,
                }
            }
        });

        this.plaidClient = new PlaidApi(config);
    }

    async createLinkToken(userId) {
        return await this.plaidClient.linkTokenCreate({
            user: { client_user_id: userId },
            client_name: 'TaxStats',
            products: ['transactions'],
            country_codes: ['GB'],
            language: 'en'
        });
    }

    async exchangePublicToken(publicToken) {
        const response = await this.plaidClient.itemPublicTokenExchange({
            public_token: publicToken
        });
        return response.data.access_token;
    }

    async fetchTransactions(accessToken, startDate, endDate) {
        const response = await this.plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate
        });

        return this.categorizeTransactions(response.data.transactions);
    }

    categorizeTransactions(transactions) {
        return transactions.map(transaction => ({
            ...transaction,
            taxCategory: this.determineCategory(transaction),
            confidence: this.calculateConfidence(transaction)
        }));
    }
}

module.exports = BankConnectionService;