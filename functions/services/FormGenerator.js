class FormGenerator {
    constructor(taxYear) {
        this.sa100 = new SA100Form(taxYear);
        this.sa103 = new SA103Form(taxYear);
        this.documents = [];
        this.entityMappings = {
            'invoice': { form: 'sa103', section: 'income', box: '3.29' },
            'receipt': { form: 'sa103', section: 'expenses' },
            'bank_statement': { form: 'sa103', section: 'income' }
        };
    }

    async populateFromDocuments(processedDocs) {
        for (const doc of processedDocs) {
            await this.mapToForms(doc);
        }
        
        return {
            sa100: this.sa100.generateForm(),
            sa103: this.sa103.generateForm()
        };
    }

    async mapToForms(processedDoc) {
        const { entities, text } = processedDoc;
        
        for (const entity of entities) {
            const mapping = this.entityMappings[entity.type];
            if (!mapping) continue;

            if (mapping.form === 'sa103') {
                await this.mapToSA103(entity);
            }
        }
    }

    async mapToSA103(entity) {
        switch(entity.category) {
            case 'income':
                this.sa103.setData('3.29', {
                    amount: entity.amount,
                    date: entity.date,
                    description: entity.description
                });
                break;
            case 'expense':
                const expenseBox = this.categorizeExpense(entity);
                this.sa103.setData(expenseBox, {
                    amount: entity.amount,
                    date: entity.date,
                    category: entity.category
                });
                break;
        }
    }

    categorizeExpense(entity) {
        const expenseTypes = {
            'travel': '3.34',
            'office': '3.37',
            'premises': '3.35',
            'staff': '3.33',
            'other': '3.41'
        };
        return expenseTypes[entity.subtype] || '3.41';
    }

    validateForms() {
        const errors = [
            ...this.sa100.validate(),
            ...this.sa103.validate()
        ];
        return errors;
    }

    generatePreview() {
        return {
            forms: {
                sa100: this.sa100.generateForm(),
                sa103: this.sa103.generateForm()
            },
            validation: this.validateForms(),
            calculations: this.calculateTotals()
        };
    }

    calculateTotals() {
        const sa103Data = this.sa103.calculateNetProfit();
        this.sa100.setData('2.6', sa103Data.netProfit);
        return {
            income: sa103Data.income,
            expenses: sa103Data.expenses,
            netProfit: sa103Data.netProfit
        };
    }
}

module.exports = FormGenerator;