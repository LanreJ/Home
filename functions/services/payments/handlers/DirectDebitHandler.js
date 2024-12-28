const PaymentHandler = require('./BaseHandler');

class DirectDebitHandler extends PaymentHandler {
    constructor() {
        super();
        this.requiredFields = [...this.requiredFields, 'accountNumber', 'sortCode'];
        this.errorSeverity = {
            CRITICAL: 'CRITICAL',
            HIGH: 'HIGH',
            MEDIUM: 'MEDIUM',
            LOW: 'LOW'
        };

        this.errorTypes = {
            MANDATE_REJECTED: this.errorSeverity.CRITICAL,
            ACCOUNT_CLOSED: this.errorSeverity.CRITICAL,
            INSUFFICIENT_FUNDS: this.errorSeverity.HIGH,
            PAYMENT_REJECTED: this.errorSeverity.HIGH,
            VALIDATION_ERROR: this.errorSeverity.MEDIUM,
            PROCESSING_ERROR: this.errorSeverity.MEDIUM
        };
    }

    async process(payment) {
        const startTime = Date.now();
        const validation = await this.validate(payment);
        if (!validation.isValid) {
            throw new Error(`Invalid direct debit payment: ${validation.errors.join(', ')}`);
        }

        const bankValidation = await this.validateBankDetails(payment);
        if (!bankValidation.isValid) {
            throw new Error(`Invalid bank details: ${bankValidation.errors.join(', ')}`);
        }

        try {
            const mandate = await this.getOrCreateMandate(payment);
            if (!mandate.isActive) {
                throw new Error('Mandate is not active');
            }

            const processedPayment = await this.processDirectDebit(payment, mandate);
            await this.updateTransactionStatus(processedPayment.id, 'COMPLETED');
            await this.logTransaction(processedPayment);

            return {
                status: 'SUCCESS',
                transactionId: processedPayment.id,
                mandateId: mandate.id,
                timestamp: new Date(),
                details: {
                    accountLastFour: this.maskAccountNumber(payment.accountNumber),
                    sortCode: this.maskSortCode(payment.sortCode),
                    amount: payment.amount,
                    reference: payment.reference,
                    processingTime: Date.now() - startTime
                }
            };
        } catch (error) {
            await this.handleProcessingError(payment, error);
            throw new Error(`Payment processing failed: ${error.message}`);
        }
    }

    async validateBankDetails(payment) {
        const errors = [];
        
        if (!this.isValidAccountNumber(payment.accountNumber)) {
            errors.push('Invalid account number format');
        }
        if (!this.isValidSortCode(payment.sortCode)) {
            errors.push('Invalid sort code format');
        }

        const mandateCheck = await this.checkMandate(payment.sortCode, payment.accountNumber);
        if (mandateCheck.exists && mandateCheck.status !== 'ACTIVE') {
            errors.push('Inactive or rejected mandate exists');
        }

        return { 
            isValid: errors.length === 0, 
            errors,
            mandateStatus: mandateCheck.exists ? mandateCheck.status : 'NEW'
        };
    }

    isValidSortCode(sortCode) {
        return /^\d{2}-\d{2}-\d{2}$/.test(sortCode);
    }

    isValidAccountNumber(accountNumber) {
        return /^\d{8}$/.test(accountNumber);
    }

    async checkMandate(sortCode, accountNumber) {
        const mandate = await this.db.collection('mandates')
            .where('sortCode', '==', sortCode)
            .where('accountNumber', '==', accountNumber)
            .limit(1)
            .get();

        return {
            exists: !mandate.empty,
            status: mandate.empty ? null : mandate.docs[0].data().status,
            mandateId: mandate.empty ? null : mandate.docs[0].id
        };
    }

    async validateBankAccount(sortCode, accountNumber) {
        const formatValid = this.validateBankFormat(sortCode, accountNumber);
        if (!formatValid.isValid) {
            return formatValid;
        }

        try {
            const [mandateCheck, bankVerification] = await Promise.all([
                this.checkExistingMandate(sortCode, accountNumber),
                this.verifyBankDetails(sortCode, accountNumber)
            ]);

            if (!bankVerification.isValid) {
                return {
                    isValid: false,
                    errors: bankVerification.errors,
                    mandateStatus: mandateCheck.status
                };
            }

            return {
                isValid: true,
                mandateId: mandateCheck.mandateId,
                mandateStatus: mandateCheck.status,
                verificationDetails: bankVerification.details
            };

        } catch (error) {
            return {
                isValid: false,
                errors: ['Bank account validation failed'],
                errorDetails: error.message
            };
        }
    }

    validateBankFormat(sortCode, accountNumber) {
        const errors = [];
        
        if (!/^\d{2}-\d{2}-\d{2}$/.test(sortCode)) {
            errors.push('Invalid sort code format (XX-XX-XX)');
        }
        
        if (!/^\d{8}$/.test(accountNumber)) {
            errors.push('Invalid account number (8 digits)');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }

    async verifyBankDetails(sortCode, accountNumber) {
        try {
            const response = await this.bankVerificationService.verify({
                sortCode: sortCode.replace(/-/g, ''),
                accountNumber,
                timestamp: new Date()
            });

            return {
                isValid: response.verified,
                details: response.details,
                errors: response.verified ? [] : ['Bank account verification failed']
            };
        } catch (error) {
            throw new Error(`Bank verification failed: ${error.message}`);
        }
    }

    async checkExistingMandate(sortCode, accountNumber) {
        const mandate = await this.db.collection('mandates')
            .where('sortCode', '==', sortCode)
            .where('accountNumber', '==', accountNumber)
            .where('status', '==', 'ACTIVE')
            .limit(1)
            .get();

        return mandate.empty ? 'NEW' : 'EXISTING';
    }

    async processDirectDebit(payment, mandate) {
        const transactionId = uuidv4();
        const transaction = {
            id: transactionId,
            mandateId: mandate.id,
            amount: payment.amount,
            reference: payment.reference,
            status: 'PROCESSING',
            createdAt: new Date()
        };

        await this.db.collection('transactions').doc(transactionId).set(transaction);
        return transaction;
    }

    async createOrUpdateMandate(payment) {
        const mandateData = {
            accountNumber: payment.accountNumber,
            sortCode: payment.sortCode,
            reference: `MND-${uuidv4()}`,
            status: 'ACTIVE',
            createdAt: new Date(),
            lastUsed: new Date()
        };

        return await this.db.collection('mandates').add(mandateData);
    }

    async logTransactionDetails(transaction) {
        await this.db.collection('payment_logs').add({
            ...transaction,
            loggedAt: new Date(),
            type: 'DIRECT_DEBIT'
        });
    }

    async notifyPaymentProcessed(transaction) {
        const notificationData = {
            type: 'PAYMENT_CONFIRMATION',
            recipient: transaction.details.email,
            template: 'direct-debit-confirmation',
            data: {
                transactionId: transaction.transactionId,
                amount: transaction.details.amount,
                accountLastFour: transaction.details.accountLastFour,
                reference: transaction.details.reference,
                date: new Date().toLocaleDateString()
            }
        };

        try {
            await this.sendNotifications(notificationData);
            await this.generateReceipt(transaction);
            
            return {
                status: 'NOTIFICATIONS_SENT',
                timestamp: new Date(),
                notificationId: uuidv4()
            };
        } catch (error) {
            await this.logNotificationError(error, transaction.transactionId);
            throw new Error('Failed to send payment notifications');
        }
    }

    async generateReceipt(transaction) {
        const receiptData = {
            id: uuidv4(),
            transactionId: transaction.transactionId,
            type: 'DIRECT_DEBIT',
            amount: transaction.details.amount,
            date: new Date(),
            status: 'CONFIRMED',
            paymentDetails: {
                method: 'Direct Debit',
                accountLastFour: transaction.details.accountLastFour,
                reference: transaction.details.reference
            }
        };

        await this.db.collection('receipts').doc(receiptData.id).set(receiptData);
        return receiptData;
    }

    async createMandate(payment) {
        const mandateId = uuidv4();
        const mandate = {
            id: mandateId,
            accountNumber: payment.accountNumber,
            sortCode: payment.sortCode,
            status: 'ACTIVE',
            reference: `MND-${mandateId}`,
            createdAt: new Date(),
            lastUsed: null,
            isActive: true
        };

        await this.db.collection('mandates').doc(mandateId).set(mandate);
        return mandate;
    }

    maskAccountNumber(accountNumber) {
        return `****${accountNumber.slice(-4)}`;
    }

    generateConfirmationNumber() {
        return `DD${Date.now().toString(36).toUpperCase()}`;
    }

    async handleProcessingError(payment, error) {
        const errorDetails = {
            paymentId: payment.id,
            errorType: error.name,
            message: error.message,
            timestamp: new Date(),
            paymentDetails: {
                accountLastFour: this.maskAccountNumber(payment.accountNumber),
                sortCode: this.maskSortCode(payment.sortCode),
                amount: payment.amount
            },
            metadata: {
                environment: process.env.NODE_ENV,
                errorCode: error.code || 'UNKNOWN',
                stackTrace: process.env.NODE_ENV === 'development' ? error.stack : null
            }
        };

        await Promise.all([
            this.logErrorDetails(errorDetails),
            this.updateTransactionStatus(payment.id, 'FAILED'),
            this.notifyAdminOfFailure(errorDetails),
            this.generateErrorReport(errorDetails)
        ]);

        return {
            status: 'FAILED',
            error: errorDetails,
            timestamp: new Date(),
            retryable: this.isRetryableError(error)
        };
    }

    async logErrorDetails(errorDetails) {
        await this.db.collection('payment_errors').add({
            ...errorDetails,
            loggedAt: new Date()
        });
    }

    async updateTransactionStatus(transactionId, status) {
        const validStatuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid status: ${status}`);
        }

        await this.db.collection('transactions')
            .doc(transactionId)
            .update({
                status,
                updatedAt: new Date(),
                statusHistory: admin.firestore.FieldValue.arrayUnion({
                    status,
                    timestamp: new Date()
                })
            });
    }

    async notifyAdminOfFailure(errorDetails) {
        const notification = {
            id: uuidv4(),
            type: 'PAYMENT_ERROR',
            severity: this.calculateErrorSeverity(errorDetails),
            details: errorDetails,
            status: 'UNREAD',
            createdAt: new Date(),
            metadata: {
                environment: process.env.NODE_ENV,
                service: 'direct-debit',
                version: process.env.APP_VERSION
            },
            requiredAction: this.getRequiredAction(errorDetails)
        };

        await Promise.all([
            this.db.collection('admin_notifications').doc(notification.id).set(notification),
            this.createAuditLog('ERROR_NOTIFICATION', notification),
            this.updateErrorStatus(errorDetails.transactionId, notification)
        ]);

        return notification;
    }

    calculateErrorSeverity(errorDetails) {
        return this.errorTypes[errorDetails.errorType] || this.errorSeverity.LOW;
    }

    getRequiredAction(errorDetails) {
        const actions = {
            [this.errorSeverity.CRITICAL]: 'IMMEDIATE_ACTION_REQUIRED',
            [this.errorSeverity.HIGH]: 'ACTION_REQUIRED',
            [this.errorSeverity.MEDIUM]: 'REVIEW_REQUIRED',
            [this.errorSeverity.LOW]: 'MONITOR'
        };
        return actions[this.calculateErrorSeverity(errorDetails)];
    }

    async generateErrorReport(errorDetails) {
        const report = {
            id: uuidv4(),
            type: 'PAYMENT_ERROR_REPORT',
            error: {
                code: errorDetails.errorCode,
                message: errorDetails.message,
                type: errorDetails.errorType,
                severity: this.calculateErrorSeverity(errorDetails),
                retryable: this.isRetryableError(errorDetails)
            },
            transaction: {
                id: errorDetails.paymentId,
                details: errorDetails.paymentDetails,
                timestamp: errorDetails.timestamp
            },
            metadata: {
                environment: process.env.NODE_ENV,
                service: 'direct-debit',
                version: process.env.APP_VERSION,
                generatedAt: new Date()
            },
            retryCount: 0,
            status: 'NEW'
        };

        await this.db.collection('error_reports').doc(report.id).set(report);
        return report;
    }

    async getOrCreateMandate(payment) {
        const existingMandate = await this.findMandate(payment);
        return existingMandate || this.createMandate(payment);
    }

    async findMandate(payment) {
        const mandate = await this.db.collection('mandates')
            .where('accountNumber', '==', payment.accountNumber)
            .where('sortCode', '==', payment.sortCode)
            .where('status', '==', 'ACTIVE')
            .limit(1)
            .get();

        return mandate.empty ? null : {
            id: mandate.docs[0].id,
            ...mandate.docs[0].data(),
            isActive: true
        };
    }
}

module.exports = DirectDebitHandler;