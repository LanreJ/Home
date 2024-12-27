const { SecretManagerServiceClient } = require('@google-cloud/secret-manager');

class TaxAccountService {
    constructor(hmrcService) {
        this.hmrcService = hmrcService;
        this.endpoints = {
            account: '/self-assessment/accounts/{utr}',
            payments: '/self-assessment/accounts/{utr}/payments',
            statements: '/self-assessment/accounts/{utr}/statements'
        };
    }

    async getAccountSummary(utr) {
        const accountData = await this.hmrcService.get(
            this.endpoints.account.replace('{utr}', utr)
        );

        return {
            balances: {
                total: accountData.balanceDue,
                overdue: accountData.overdueAmount,
                pending: accountData.pendingPayments
            },
            payments: {
                onAccount: accountData.paymentsOnAccount,
                lastPayment: accountData.lastPaymentDate
            },
            filings: {
                lastFiled: accountData.lastReturnDate,
                missingYears: accountData.outstandingReturns
            },
            nextPayment: {
                dueDate: accountData.nextPaymentDue,
                amount: accountData.nextPaymentAmount
            }
        };
    }

    async getPaymentHistory(utr, options = { limit: 10 }) {
        return await this.hmrcService.get(
            this.endpoints.payments.replace('{utr}', utr),
            { params: options }
        );
    }

    async getAccountStatements(utr, taxYear) {
        return await this.hmrcService.get(
            this.endpoints.statements.replace('{utr}', utr),
            { params: { taxYear } }
        );
    }
}

module.exports = TaxAccountService;