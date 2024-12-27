class FormValidator {
    constructor() {
        this.rules = {
            sa100: {
                personalDetails: {
                    name: { required: true, type: 'string' },
                    nino: { required: true, pattern: /^[A-Z]{2}[0-9]{6}[A-Z]$/ },
                    utr: { required: true, pattern: /^[0-9]{10}$/ }
                },
                income: {
                    selfEmployment: { type: 'number', min: 0 },
                    property: { type: 'number', min: 0 }
                }
            },
            sa103: {
                businessDetails: {
                    name: { required: true },
                    startDate: { required: true, type: 'date' }
                },
                income: {
                    turnover: { required: true, type: 'number', min: 0 }
                }
            }
        };
    }

    validateForm(formType, data) {
        const errors = [];
        const rules = this.rules[formType];

        for (const [section, fields] of Object.entries(rules)) {
            for (const [field, rule] of Object.entries(fields)) {
                const value = data[section]?.[field];
                const fieldErrors = this.validateField(value, rule);
                if (fieldErrors.length > 0) {
                    errors.push({ section, field, errors: fieldErrors });
                }
            }
        }

        return errors;
    }

    validateField(value, rule) {
        const errors = [];
        
        if (rule.required && !value) {
            errors.push('Field is required');
        }

        if (rule.pattern && !rule.pattern.test(value)) {
            errors.push('Invalid format');
        }

        if (rule.type === 'number') {
            if (isNaN(value)) {
                errors.push('Must be a number');
            } else if (rule.min !== undefined && value < rule.min) {
                errors.push(`Must be at least ${rule.min}`);
            }
        }

        return errors;
    }
}

module.exports = FormValidator;