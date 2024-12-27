class UKTaxReturn {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.sections = {
            sa100: {
                personalDetails: {},
                taxableIncome: {},
                allowances: {},
                declarations: {}
            },
            sa103: {
                businessDetails: {},
                income: [],
                expenses: [],
                capitalAllowances: []
            },
            sa105: {
                propertyDetails: [],
                income: [],
                expenses: []
            }
        };
        this.calculations = null;
    }

    addIncome(category, amount, details) {
        switch(category) {
            case 'self-employment':
                this.sections.sa103.income.push({ amount, ...details });
                break;
            case 'property':
                this.sections.sa105.income.push({ amount, ...details });
                break;
            case 'other':
                this.sections.otherIncome.push({ amount, ...details });
                break;
        }
    }

    addExpense(category, amount, details) {
        this.sections.expenses.push({
            category,
            amount,
            details,
            dateIncurred: new Date()
        });
    }

    validate() {
        const errors = [];
        // Basic validation
        if (!this.sections.sa100.personalDetails.name) {
            errors.push('Name is required');
        }
        if (!this.sections.sa100.personalDetails.nino) {
            errors.push('National Insurance number is required');
        }
        return errors;
    }

    calculate() {
        const calculator = new UKTaxCalculator(this.taxYear);
        const totalIncome = this.calculateTotalIncome();
        const totalExpenses = this.calculateTotalExpenses();
        const taxableProfit = Math.max(0, totalIncome - totalExpenses);
        
        this.calculations = {
            totalIncome,
            totalExpenses,
            taxableProfit,
            incomeTax: calculator.calculateIncomeTax(taxableProfit),
            nationalInsurance: calculator.calculateNIC(taxableProfit)
        };
        
        return this.calculations;
    }

    calculateTotalIncome() {
        return {
            selfEmployment: this.sections.sa103.income.reduce((sum, item) => sum + item.amount, 0),
            property: this.sections.sa105.income.reduce((sum, item) => sum + item.amount, 0)
        };
    }

    calculateTotalExpenses() {
        return {
            selfEmployment: this.sections.sa103.expenses.reduce((sum, item) => sum + item.amount, 0),
            property: this.sections.sa105.expenses.reduce((sum, item) => sum + item.amount, 0)
        };
    }

    generateReturn() {
        const calculations = this.calculate();
        return {
            sa100: this._generateSA100(calculations),
            sa103: this._generateSA103(),
            sa105: this._generateSA105()
        };
    }

    _generateSA100(calculations) {
        return {
            box1: this.sections.sa100.personalDetails,
            box2: calculations.totalIncome,
            box3: calculations.totalExpenses,
            box4: calculations.taxableProfit,
            box5: calculations.incomeTax,
            box6: calculations.nationalInsurance
        };
    }

    validateReturn() {
        const errors = [];
        if (!this.sections.sa100.personalDetails.nino) errors.push('NINO required');
        if (!this.sections.sa100.declarations.signature) errors.push('Signature required');
        return errors;
    }
}