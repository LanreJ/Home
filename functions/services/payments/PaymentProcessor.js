const { v4: uuidv4 } = require('uuid');

class PaymentProcessor {
    constructor(db) {
        this.db = db;
        this.paymentStatuses = {
            PENDING: 'pending',
            PROCESSING: 'processing',
            COMPLETED: 'completed',
            FAILED: 'failed'
        };
        this.paymentMethods = {
            DIRECT_DEBIT: 'direct_debit',
            BANK_TRANSFER: 'bank_transfer',
            CARD_PAYMENT: 'card_payment'
        };
    }

    async validatePaymentDetails(details) {
        const { amount, reference, method } = details;
        const errors = [];

        if (!amount || amount <= 0) errors.push('Invalid amount');
        if (!reference) errors.push('Missing reference');
        if (!this.paymentMethods[method]) errors.push('Invalid payment method');
        if (!this.validatePaymentReference(reference)) {
            errors.push('Invalid payment reference format');
        }
        if (!this.validatePaymentAmount(amount, method)) {
            errors.push('Amount exceeds payment method limit');
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: this.generatePaymentWarnings(details)
        };
    }

    validatePaymentReference(reference) {
        return /^(TAX|POA)-\d{6}-[A-Z0-9]{8}$/.test(reference);
    }

    validatePaymentAmount(amount, method) {
        const limits = {
            [this.paymentMethods.CARD_PAYMENT]: 10000,
            [this.paymentMethods.BANK_TRANSFER]: 1000000,
            [this.paymentMethods.DIRECT_DEBIT]: 50000
        };
        return amount <= limits[method];
    }

    generatePaymentWarnings(details) {
        const warnings = [];
        const dueDate = new Date(details.dueDate);
        const today = new Date();
        
        if ((dueDate - today) / (1000 * 60 * 60 * 24) < 7) {
            warnings.push('Payment due within 7 days');
        }
        if (details.amount > 10000) {
            warnings.push('Large payment - additional verification may be required');
        }
        return warnings;
    }

    async createTransaction(details) {
        const transaction = {
            id: uuidv4(),
            ...details,
            status: this.paymentStatuses.PENDING,
            createdAt: new Date(),
            metadata: {
                environment: process.env.NODE_ENV,
                version: process.env.APP_VERSION
            }
        };
        await this.db.collection('transactions').doc(transaction.id).set(transaction);
        return transaction;
    }

    async updateTransactionStatus(transactionId, status, details = {}) {
        await this.db.collection('transactions').doc(transactionId).update({
            status,
            ...details,
            updatedAt: new Date()
        });
    }

    async processPayment(paymentDetails) {
        const validation = await this.validatePayment(paymentDetails);
        if (!validation.isValid) {
            throw new Error(`Payment validation failed: ${validation.errors.join(', ')}`);
        }

        const transaction = await this.createTransaction(paymentDetails);
        const handler = this.getPaymentHandler(paymentDetails.method);

        try {
            await this.updateStatus(transaction.id, this.paymentStatuses.PROCESSING);
            const result = await handler.process(transaction);
            await this.updateStatus(transaction.id, this.paymentStatuses.COMPLETED);
            return this.generateReceipt(transaction, result);
        } catch (error) {
            await this.handlePaymentError(transaction.id, error);
            throw error;
        }
    }

    getPaymentHandler(method) {
        const handlers = {
            [this.paymentMethods.DIRECT_DEBIT]: new DirectDebitHandler(),
            [this.paymentMethods.BANK_TRANSFER]: new BankTransferHandler(),
            [this.paymentMethods.CARD_PAYMENT]: new CardPaymentHandler()
        };
        return handlers[method];
    }
}

module.exports = PaymentProcessor;