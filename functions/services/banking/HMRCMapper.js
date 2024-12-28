const admin = require('firebase-admin');

class HMRCMapper {
    constructor() {
        this.db = admin.firestore();
        this.sa105Mappings = {
            income: {
                'rental': '3.1',  // Rents received
                'premiums': '3.2', // Premiums
                'other': '3.3'    // Other property income
            },
            expenses: {
                'repairs': '3.15',      // Repairs and maintenance
                'insurance': '3.16',    // Insurance
                'mortgage': '3.17',     // Loan interest
                'utilities': '3.18',    // Other property costs
                'professional': '3.19'  // Professional fees
            }
        };
    }

    async mapTransactionsToHMRC(userId, taxYear) {
        const transactions = await this.fetchTransactions(userId, taxYear);
        const mappedData = this.categorizeForSA105(transactions);
        return this.generateSA105Data(mappedData);
    }

    async fetchTransactions(userId, taxYear) {
        const snapshot = await this.db
            .collection('transactions')
            .where('userId', '==', userId)
            .where('taxYear', '==', taxYear)
            .get();

        return snapshot.docs.map(doc => doc.data());
    }

    categorizeForSA105(transactions) {
        const categories = {
            income: {},
            expenses: {}
        };

        transactions.forEach(transaction => {
            const { type, category } = transaction.category;
            const amount = Math.abs(transaction.amount);

            if (this.sa105Mappings[type]?.[category]) {
                const boxNumber = this.sa105Mappings[type][category];
                categories[type][boxNumber] = (categories[type][boxNumber] || 0) + amount;
            }
        });

        return categories;
    }

    generateSA105Data(mappedData) {
        return {
            formType: 'SA105',
            taxYear: this.taxYear,
            income: this.calculateTotalIncome(mappedData.income),
            expenses: this.calculateTotalExpenses(mappedData.expenses),
            netProfit: this.calculateNetProfit(mappedData),
            boxMappings: mappedData
        };
    }

    async generateSubmission(userId, taxYear) {
        try {
            const mappedData = await this.mapTransactionsToHMRC(userId, taxYear);
            return {
                sa105Data: this.generateSA105Data(mappedData),
                validation: await this.validateMappedData(mappedData),
                summary: this.generateSubmissionSummary(mappedData)
            };
        } catch (error) {
            throw new Error(`HMRC mapping failed: ${error.message}`);
        }
    }

    validateMappedData(mappedData) {
        const validationRules = {
            income: {
                required: true,
                minimum: 0,
                boxNumbers: ['3.1', '3.2', '3.3']
            },
            expenses: {
                maximum: (income) => income * 0.9, // 90% of income
                boxNumbers: ['3.15', '3.16', '3.17', '3.18', '3.19']
            }
        };

        return this.validateAgainstRules(mappedData, validationRules);
    }

    generateSubmissionSummary(mappedData) {
        const totalIncome = this.calculateTotalIncome(mappedData.income);
        const totalExpenses = this.calculateTotalExpenses(mappedData.expenses);

        return {
            taxYear: this.taxYear,
            propertyIncome: {
                total: totalIncome,
                breakdown: mappedData.income
            },
            propertyExpenses: {
                total: totalExpenses,
                breakdown: mappedData.expenses
            },
            netProfit: totalIncome - totalExpenses,
            submissionReady: this.isReadyForSubmission(mappedData)
        };
    }

    calculateTotalIncome(incomeData) {
        return Object.values(incomeData).reduce((sum, amount) => sum + amount, 0);
    }

    calculateTotalExpenses(expenseData) {
        return Object.values(expenseData).reduce((sum, amount) => sum + amount, 0);
    }
}

module.exports = HMRCMapper;