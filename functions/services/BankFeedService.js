import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';

export class BankFeedService {
    constructor(plaidSecret) {
        const config = new Configuration({
            basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
                    'PLAID-SECRET': plaidSecret,
                }
            }
        });
        
        this.client = new PlaidApi(config);
        this.db = getFirestore();
    }

    async createLinkToken(userId) {
        try {
            const response = await this.client.linkTokenCreate({
                user: { client_user_id: userId },
                client_name: 'TaxStats AI',
                products: ['transactions'],
                country_codes: ['GB'],
                language: 'en'
            });
            return response.data.link_token;
        } catch (error) {
            logger.error('Link token creation failed:', error);
            throw error;
        }
    }

    async getTransactions(userId, accessToken, startDate, endDate) {
        try {
            const response = await this.client.transactionsGet({
                access_token: accessToken,
                start_date: startDate,
                end_date: endDate
            });

            const transactions = this.processTransactions(response.data.transactions);
            await this.storeTransactions(userId, transactions);

            return transactions;
        } catch (error) {
            logger.error('Transaction fetch failed:', error);
            throw error;
        }
    }

    private processTransactions(transactions) {
        return transactions.map(tx => ({
            id: tx.transaction_id,
            date: tx.date,
            amount: tx.amount,
            description: tx.name,
            category: tx.category,
            merchantName: tx.merchant_name,
            paymentChannel: tx.payment_channel
        }));
    }

    private async storeTransactions(userId, transactions) {
        const batch = this.db.batch();
        
        transactions.forEach(tx => {
            const ref = this.db.collection('transactions')
                .doc(userId)
                .collection('items')
                .doc(tx.id);
            batch.set(ref, {
                ...tx,
                updatedAt: new Date()
            });
        });

        await batch.commit();
    }
}