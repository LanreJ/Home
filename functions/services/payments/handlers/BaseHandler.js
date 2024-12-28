class PaymentHandler {
    constructor() {
        this.requiredFields = ['amount', 'reference', 'description'];
    }

    async validate(payment) {
        const errors = [];
        this.requiredFields.forEach(field => {
            if (!payment[field]) errors.push(`Missing required field: ${field}`);
        });
        return {
            isValid: errors.length === 0,
            errors
        };
    }

    async process(payment) {
        throw new Error('Process method must be implemented by subclass');
    }
}

module.exports = PaymentHandler;