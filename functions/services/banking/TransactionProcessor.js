const admin = require('firebase-admin');

class TransactionProcessor {
    constructor() {
        this.db = admin.firestore();
        this.categories = {
            income: {
                rental: ['rent payment', 'tenant rent'],
                other: ['dividend', 'interest']
            },
            expenses: {
                property: ['repairs', 'maintenance'],
                financial: ['mortgage', 'insurance'],
                utilities: ['gas', 'electric', 'water'],
                professional: ['letting agent', 'accountant']
            }
        };
    }

    async processTransactions(transactions, userId) {
        const categorized = this.categorizeTransactions(transactions);
        await this.storeTransactions(categorized, userId);
        return this.generateSummary(categorized);
    }

    categorizeTransactions(transactions) {
        return transactions.map(transaction => ({
            ...transaction,
            category: this.detectCategory(transaction),
            taxYear: this.determineTaxYear(transaction.date),
            confidence: this.calculateConfidence(transaction)
        }));
    }

    detectCategory(transaction) {
        const description = transaction.description.toLowerCase();
        
        for (const [type, categories] of Object.entries(this.categories)) {
            for (const [category, keywords] of Object.entries(categories)) {
                if (keywords.some(keyword => description.includes(keyword))) {
                    return { type, category };
                }
            }
        }
        
        return { type: 'uncategorized', category: 'unknown' };
    }

    async storeTransactions(transactions, userId) {
        const batch = this.db.batch();
        
        transactions.forEach(transaction => {
            const ref = this.db.collection('transactions')
                .doc(`${userId}_${transaction.id}`);
            batch.set(ref, {
                ...transaction,
                userId,
                processedAt: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();
    }
}

module.exports = TransactionProcessor;