export class SA100Processor {
    async process(document) {
        const entities = {};
        
        entities.personalDetails = this.extractPersonalDetails(document);
        entities.income = this.extractIncomeDetails(document);
        entities.deductions = this.extractDeductions(document);
        
        return {
            type: 'SA100',
            entities,
            metadata: {
                confidence: document.textStyles[0]?.confidence || 0,
                processed: new Date().toISOString()
            }
        };
    }

    extractPersonalDetails(document) {
        return {
            name: this.extractByLabel(document, 'Your name'),
            utr: this.extractByLabel(document, 'UTR'),
            nino: this.extractByLabel(document, 'NINO')
        };
    }

    extractIncomeDetails(document) {
        return {
            employment: this.extractAmount(document, 'Employment income'),
            selfEmployment: this.extractAmount(document, 'Self employment'),
            property: this.extractAmount(document, 'Property income'),
            dividends: this.extractAmount(document, 'Dividends')
        };
    }
}