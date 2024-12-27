class SA100Form {
    constructor(taxYear) {
        this.boxNumbers = {
            personalDetails: {
                name: '1.1',
                nino: '1.2',
                utr: '1.3',
                address: '1.4'
            },
            selfEmployment: {
                profit: '2.6',
                losses: '2.7'
            },
            propertyIncome: {
                profit: '3.5',
                losses: '3.6'
            },
            summary: {
                totalIncome: '15.1',
                totalExpenses: '15.2',
                taxableIncome: '15.3',
                incomeTax: '15.4',
                nicDue: '15.5'
            }
        };
        this.data = {};
    }

    validate() {
        const required = ['1.1', '1.2', '1.3'];
        const errors = [];
        required.forEach(box => {
            if (!this.data[box]) errors.push(`Box ${box} is required`);
        });
        return errors;
    }

    setData(boxNumber, value) {
        this.data[boxNumber] = value;
    }

    generateForm() {
        return {
            metadata: {
                formType: 'SA100',
                taxYear: this.taxYear,
                version: '2023-24'
            },
            formData: this.data,
            validation: this.validate()
        };
    }
}

module.exports = SA100Form;