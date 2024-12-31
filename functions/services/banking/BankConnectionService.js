const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');
const admin = require('firebase-admin');

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
        return this;
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

    async fetchTransactions(accessToken, count) {
        const response = await this.plaidClient.transactionsGet({
            access_token: accessToken,
            start_date: this.getStartDate(),
            end_date: new Date().toISOString().split('T')[0],
            options: { count }
        });
        return response.data.transactions;
    }

    async handleWebhook(payload) {
        try {
            await this.validateWebhook(payload);
            const { webhook_type, webhook_code, item_id, new_transactions } = payload;
            
            console.log(`Processing Plaid webhook: ${webhook_type}:${webhook_code}`);
            
            switch(webhook_code) {
                case 'INITIAL_UPDATE':
                case 'DEFAULT_UPDATE':
                case 'HISTORICAL_UPDATE':
                    await this.syncTransactions(item_id, new_transactions);
                    break;
                case 'TRANSACTIONS_REMOVED':
                    await this.removeTransactions(payload.removed_transactions);
                    break;
                default:
                    console.warn(`Unhandled webhook code: ${webhook_code}`);
            }

            await this.updateSyncStatus(item_id, {
                lastSync: admin.firestore.FieldValue.serverTimestamp(),
                status: 'SUCCESS',
                transactionsProcessed: new_transactions
            });

            return {
                success: true,
                webhook_type,
                webhook_code,
                processed_at: new Date().toISOString()
            };

        } catch (error) {
            await this.logError(error);
            throw error;
        }
    }

    async syncTransactions(itemId, count) {
        const accessToken = await this.getAccessToken(itemId);
        const transactions = await this.fetchTransactions(accessToken, count);
        const categorized = this.categorizeTransactions(transactions);
        await this.storeTransactions(itemId, categorized);
        return categorized;
    }

    categorizeTransactions(transactions) {
        return transactions.map(tx => ({
            ...tx,
            taxCategory: this.determineTaxCategory(tx),
            confidence: this.calculateConfidence(tx),
            metadata: {
                processedAt: new Date().toISOString(),
                source: 'PLAID',
                version: '1.0'
            }
        }));
    }

    determineTaxCategory(transaction) {
        for (const [category, keywords] of Object.entries(this.taxCategories)) {
            if (keywords.some(k => transaction.description.toLowerCase().includes(k))) {
                return category;
            }
        }
        return 'UNCATEGORIZED';
    }

    async storeTransactions(itemId, transactions) {
        const batch = admin.firestore().batch();
        transactions.forEach(tx => {
            const ref = admin.firestore()
                .collection('plaid_items')
                .doc(itemId)
                .collection('transactions')
                .doc(tx.transaction_id);
            batch.set(ref, {
                ...tx,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });
        await batch.commit();
    }

    async removeTransactions(transactionIds) {
        const batch = admin.firestore().batch();
        transactionIds.forEach(id => {
            const ref = admin.firestore()
                .collection('plaid_items')
                .doc(this.itemId)
                .collection('transactions')
                .doc(id);
            batch.delete(ref);
        });
        await batch.commit();
    }

    async updateSyncStatus(itemId, status) {
        await admin.firestore()
            .collection('plaid_items')
            .doc(itemId)
            .update({
                ...status,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async logError(error) {
        await admin.firestore()
            .collection('errors')
            .add({
                service: 'BankConnectionService',
                error: error.message,
                stack: error.stack,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async validateWebhook(payload) {
        if (!payload?.webhook_type || !payload?.webhook_code) {
            throw new Error('Invalid webhook payload');
        }
    }

    async getAccessToken(itemId) {
        const doc = await admin.firestore()
            .collection('plaid_items')
            .doc(itemId)
            .get();
        
        if (!doc.exists) {
            throw new Error('Plaid item not found');
        }
        
        return doc.data().access_token;
    }

    async getSecret(secretName) {
        const name = `projects/${process.env.PROJECT_ID}/secrets/${secretName}/versions/latest`;
        const [version] = await this.secretManager.accessSecretVersion({ name });
        return version.payload.data.toString();
    }

    getStartDate() {
        const date = new Date();
        date.setFullYear(date.getFullYear() - 1);
        return date.toISOString().split('T')[0];
    }
}

async function fetchBankFeeds() {
  try {
    // integration logic
  } catch (err) {
    console.error('BankFeed Error:', err);
    // additional error handling
    throw err;
  }
}

module.exports = BankConnectionService;