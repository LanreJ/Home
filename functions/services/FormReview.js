class FormReview {
    constructor(formGenerator) {
        this.formGenerator = formGenerator;
        this.requiredFields = {
            sa100: ['1.1', '1.2', '1.3'],
            sa103: ['3.2', '3.29']
        };
    }

    generatePreview() {
        const forms = this.formGenerator.generatePreview();
        const missingFields = this.checkRequiredFields(forms);
        const calculations = this.formGenerator.calculateTotals();

        return {
            preview: forms,
            missing: missingFields,
            calculations: {
                totalIncome: calculations.income,
                totalExpenses: calculations.expenses,
                netProfit: calculations.netProfit,
                taxDue: this.calculateTaxLiability(calculations.netProfit)
            },
            status: missingFields.length === 0 ? 'COMPLETE' : 'INCOMPLETE'
        };
    }

    checkRequiredFields(forms) {
        const missing = [];
        Object.entries(this.requiredFields).forEach(([formType, fields]) => {
            fields.forEach(field => {
                if (!forms[formType].data[field]) {
                    missing.push({ form: formType, field });
                }
            });
        });
        return missing;
    }
}

module.exports = FormReview;