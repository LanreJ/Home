class SA103Form {
    constructor(taxYear) {
        this.boxNumbers = {
            businessDetails: {
                name: '3.2',
                description: '3.3',
                startDate: '3.4',
                accountingPeriodFrom: '3.5',
                accountingPeriodTo: '3.6',
                basis: '3.9'
            },
            income: {
                turnover: '3.29',
                otherIncome: '3.30',
                tradingAllowance: '3.31'
            },
            expenses: {
                costOfGoods: '3.32',
                wagesAndStaff: '3.33',
                carAndTravel: '3.34',
                premises: '3.35',
                repairs: '3.36',
                adminAndOffice: '3.37',
                advertising: '3.38',
                interest: '3.39',
                depreciation: '3.40',
                otherExpenses: '3.41'
            },
            capitalAllowances: {
                annualInvestment: '3.50',
                electricVehicle: '3.51',
                otherAllowances: '3.52'
            },
            netProfit: {
                taxableProfit: '3.73',
                losses: '3.74',
                cisDeductions: '3.98'
            }
        };
        this.data = {};
        this.taxYear = taxYear;
    }

    validate() {
        const required = ['3.2', '3.3', '3.5', '3.6', '3.29'];
        const errors = [];
        required.forEach(box => {
            if (!this.data[box]) errors.push(`Box ${box} is required`);
        });
        return errors;
    }

    calculateNetProfit() {
        const income = Object.values(this.data)
            .filter(entry => entry.category === 'income')
            .reduce((sum, entry) => sum + entry.amount, 0);

        const expenses = Object.values(this.data)
            .filter(entry => entry.category === 'expenses')
            .reduce((sum, entry) => sum + entry.amount, 0);

        const capitalAllowances = Object.values(this.data)
            .filter(entry => entry.category === 'capitalAllowances')
            .reduce((sum, entry) => sum + entry.amount, 0);

        return income - expenses + capitalAllowances;
    }

    generateForm() {
        return {
            metadata: {
                formType: 'SA103F',
                taxYear: this.taxYear,
                version: '2023-24'
            },
            formData: this.data,
            calculations: {
                netProfit: this.calculateNetProfit()
            },
            validation: this.validate()
        };
    }
}

module.exports = SA103Form;