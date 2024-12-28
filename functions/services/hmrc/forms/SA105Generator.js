const { validatePropertyIncome } = require('../validation/FormValidator');

class SA105Generator {
    constructor(hmrcMapper) {
        this.hmrcMapper = hmrcMapper;
        this.formBoxes = {
            INCOME: ['3.1', '3.2', '3.3'],
            EXPENSES: ['3.15', '3.16', '3.17', '3.18', '3.19'],
            CAPITAL: ['3.20', '3.21']
        };
    }

    async generateForm(userId, taxYear) {
        const mappedData = await this.hmrcMapper.mapTransactionsToHMRC(userId, taxYear);
        const validation = await validatePropertyIncome(mappedData);

        if (!validation.isValid) {
            throw new Error(`SA105 validation failed: ${validation.errors.join(', ')}`);
        }

        return {
            formData: this.formatFormData(mappedData),
            summary: this.generateSummary(mappedData),
            validation: validation
        };
    }

    formatFormData(mappedData) {
        return {
            formType: 'SA105',
            taxYear: mappedData.taxYear,
            income: this.formatIncome(mappedData.income),
            expenses: this.formatExpenses(mappedData.expenses),
            declarations: {
                isComplete: true,
                timestamp: new Date()
            }
        };
    }

    formatIncome(income) {
        return {
            rentReceived: income['3.1'] || 0,
            premiums: income['3.2'] || 0,
            otherIncome: income['3.3'] || 0,
            totalIncome: Object.values(income).reduce((sum, val) => sum + val, 0)
        };
    }

    formatExpenses(expenses) {
        return {
            repairs: expenses['3.15'] || 0,
            insurance: expenses['3.16'] || 0,
            loanInterest: expenses['3.17'] || 0,
            utilities: expenses['3.18'] || 0,
            professionalFees: expenses['3.19'] || 0,
            totalExpenses: Object.values(expenses).reduce((sum, val) => sum + val, 0)
        };
    }

    generateSummary(mappedData) {
        const income = this.calculateTotalIncome(mappedData.income);
        const expenses = this.calculateTotalExpenses(mappedData.expenses);
        
        return {
            propertyIncome: {
                totalRents: mappedData.income['3.1'] || 0,
                otherIncome: (mappedData.income['3.2'] || 0) + (mappedData.income['3.3'] || 0),
                totalIncome: income
            },
            propertyExpenses: {
                repairs: mappedData.expenses['3.15'] || 0,
                finance: mappedData.expenses['3.17'] || 0,
                other: this.calculateOtherExpenses(mappedData.expenses),
                totalExpenses: expenses
            },
            profitOrLoss: income - expenses,
            taxYear: mappedData.taxYear,
            metadata: {
                generatedAt: new Date(),
                source: 'bank-transactions',
                version: '2023-24'
            }
        };
    }

    calculateOtherExpenses(expenses) {
        const otherExpenseBoxes = ['3.16', '3.18', '3.19'];
        return otherExpenseBoxes.reduce((sum, box) => sum + (expenses[box] || 0), 0);
    }

    calculateTotalIncome(income) {
        return this.formBoxes.INCOME.reduce((sum, box) => sum + (income[box] || 0), 0);
    }

    calculateTotalExpenses(expenses) {
        return this.formBoxes.EXPENSES.reduce((sum, box) => sum + (expenses[box] || 0), 0);
    }
}

module.exports = SA105Generator;