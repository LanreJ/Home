import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

class PlaidClient {
    constructor() {
        const configuration = new Configuration({
            basePath: PlaidEnvironments.sandbox,
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
                    'PLAID-SECRET': process.env.PLAID_SANDBOX_API_KEY,
                },
            },
        });

        this.client = new PlaidApi(configuration);
    }

    async createLinkToken(userId) {
        const request = {
            user: { client_user_id: userId },
            client_name: 'Tax Return Helper',
            products: ['transactions'],
            country_codes: ['GB'],
            language: 'en'
        };

        const response = await this.client.linkTokenCreate(request);
        return response.data;
    }

    async getTransactions(accessToken, startDate, endDate) {
        const request = {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate
        };

        const response = await this.client.transactionsGet(request);
        return this.processTransactions(response.data);
    }

    async exchangePublicToken(publicToken) {
        const response = await this.client.itemPublicTokenExchange({
            public_token: publicToken
        });
        return response.data.access_token;
    }

    async fetchTransactions(accessToken, startDate, endDate) {
        const request = {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate,
            options: {
                include_personal_finance_category: true,
                include_original_description: true
            }
        };

        let transactions = [];
        let hasMore = true;
        let cursor = null;

        while (hasMore) {
            const response = await this.client.transactionsSync({
                ...request,
                cursor
            });
            
            transactions = [...transactions, ...response.data.added];
            hasMore = response.data.has_more;
            cursor = response.data.next_cursor;
        }

        return this.processTransactions(transactions);
    }

    processTransactions(transactions) {
        return {
            income: this.categorizeIncome(transactions),
            expenses: this.categorizeExpenses(transactions),
            summary: this.generateTransactionSummary(transactions),
            metadata: {
                transactionCount: transactions.length,
                dateRange: this.getTransactionDateRange(transactions)
            }
        };
    }

    processTransactions(data) {
        return {
            income: this.categorizeIncome(data.transactions),
            expenses: this.categorizeExpenses(data.transactions),
            metadata: {
                accountIds: data.accounts.map(acc => acc.account_id),
                dateRange: {
                    start: data.start_date,
                    end: data.end_date
                }
            }
        };
    }

    categorizeIncome(transactions) {
        const incomeCategories = {
            salary: ['salary', 'payroll'],
            selfEmployment: ['freelance', 'contractor', 'consulting'],
            property: ['rent', 'rental income'],
            investments: ['dividend', 'interest', 'investment']
        };

        return transactions.reduce((acc, transaction) => {
            if (transaction.amount < 0) {
                const amount = Math.abs(transaction.amount);
                const category = this.determineIncomeCategory(
                    transaction.category, 
                    incomeCategories
                );
                
                if (category) {
                    acc[category] = (acc[category] || 0) + amount;
                }
            }
            return acc;
        }, {});
    }

    categorizeExpenses(transactions) {
        const expenseCategories = {
            propertyExpenses: ['mortgage', 'repairs', 'maintenance'],
            tradingExpenses: ['office', 'equipment', 'supplies'],
            allowableExpenses: ['insurance', 'utilities', 'professional']
        };

        return transactions.reduce((acc, transaction) => {
            if (transaction.amount > 0) {
                const category = this.determineExpenseCategory(
                    transaction.category, 
                    expenseCategories
                );
                
                if (category) {
                    acc[category] = (acc[category] || 0) + transaction.amount;
                }
            }
            return acc;
        }, {});
    }

    determineIncomeCategory(transactionCategory, categories) {
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => 
                transactionCategory.some(cat => 
                    cat.toLowerCase().includes(keyword)
                ))) {
                return category;
            }
        }
        return null;
    }
}

export { PlaidClient };