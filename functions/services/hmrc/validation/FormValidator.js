class FormValidator {
    constructor() {
        this.rules = {
            income: {
                '3.1': { required: true, min: 0, type: 'number' },
                '3.2': { required: false, min: 0, type: 'number' },
                '3.3': { required: false, min: 0, type: 'number' }
            },
            expenses: {
                '3.15': { max: (income) => income * 0.5, type: 'number' },
                '3.16': { max: (income) => income * 0.1, type: 'number' },
                '3.17': { max: (income) => income * 0.75, type: 'number' },
                '3.18': { max: (income) => income * 0.2, type: 'number' },
                '3.19': { max: (income) => income * 0.15, type: 'number' }
            }
        };
    }

    async validatePropertyIncome(formData) {
        const errors = [];
        const totalIncome = this.calculateTotalIncome(formData.income);

        // Validate income
        for (const [box, value] of Object.entries(formData.income)) {
            const rule = this.rules.income[box];
            if (!this.validateField(value, rule)) {
                errors.push(`Invalid value for income box ${box}`);
            }
        }

        // Validate expenses
        for (const [box, value] of Object.entries(formData.expenses)) {
            const rule = this.rules.expenses[box];
            if (!this.validateExpenseField(value, rule, totalIncome)) {
                errors.push(`Invalid value for expense box ${box}`);
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings: this.generateWarnings(formData)
        };
    }

    validateField(value, rule) {
        if (rule.required && !value) return false;
        if (rule.min !== undefined && value < rule.min) return false;
        if (rule.type === 'number' && typeof value !== 'number') return false;
        return true;
    }
}

module.exports = FormValidator;