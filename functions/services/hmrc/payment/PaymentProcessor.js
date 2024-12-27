class PaymentProcessor {
    constructor(hmrcService) {
        this.hmrcService = hmrcService;
        this.endpoints = {
            makePayment: '/self-assessment/accounts/{utr}/payments',
            repayment: '/self-assessment/accounts/{utr}/repayments',
            paymentPlans: '/self-assessment/accounts/{utr}/payment-plans'
        };
    }

    async initiatePayment(utr, paymentDetails) {
        const payload = {
            amount: paymentDetails.amount,
            paymentMethod: paymentDetails.method,
            paymentDate: new Date(),
            reference: `PAY-${utr}-${Date.now()}`
        };

        return await this.hmrcService.post(
            this.endpoints.makePayment.replace('{utr}', utr),
            payload
        );
    }

    async requestRepayment(utr, bankDetails) {
        return await this.hmrcService.post(
            this.endpoints.repayment.replace('{utr}', utr),
            {
                bankAccount: {
                    name: bankDetails.accountName,
                    sortCode: bankDetails.sortCode,
                    accountNumber: bankDetails.accountNumber
                },
                amount: bankDetails.amount
            }
        );
    }

    async setupPaymentPlan(utr, planDetails) {
        return await this.hmrcService.post(
            this.endpoints.paymentPlans.replace('{utr}', utr),
            {
                totalAmount: planDetails.totalAmount,
                installments: planDetails.numberOfInstallments,
                startDate: planDetails.startDate,
                frequency: planDetails.frequency
            }
        );
    }
}

module.exports = PaymentProcessor;