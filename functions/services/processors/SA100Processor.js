import { BaseProcessor } from './BaseProcessor';

class SA100Processor extends BaseProcessor {
    async process(document) {
        const entities = await this.extractEntities(document);
        
        return {
            type: 'SA100',
            entities,
            metadata: {
                confidence: document.textStyles[0]?.confidence || 0,
                processed: new Date().toISOString()
            }
        };
    }

    async extractEntities(document) {
        return {
            personalDetails: this.extractPersonalDetails(document),
            income: this.extractIncomeDetails(document),
            deductions: this.extractDeductions(document)
        };
    }

    extractPersonalDetails(document) {
        return {
            name: this.getFieldValue(document, 'name', /full\s+name:?\s*([^,\n]+)/i),
            utr: this.getFieldValue(document, 'utr', /utr:?\s*(\d{10})/i),
            nino: this.getFieldValue(document, 'nino', /national\s+insurance:?\s*([A-Z]{2}\d{6}[A-D])/i),
            address: this.extractAddress(document)
        };
    }

    extractIncomeDetails(document) {
        return {
            employment: this.extractAmount(this.getFieldValue(document, 'employment', /employment\s+income:?\s*£?([\d,]+\.?\d*)/i)),
            selfEmployment: this.extractAmount(this.getFieldValue(document, 'selfEmployment', /self\s+employment:?\s*£?([\d,]+\.?\d*)/i)),
            property: this.extractAmount(this.getFieldValue(document, 'property', /property\s+income:?\s*£?([\d,]+\.?\d*)/i)),
            dividends: this.extractAmount(this.getFieldValue(document, 'dividends', /dividends:?\s*£?([\d,]+\.?\d*)/i)),
            interest: this.extractAmount(this.getFieldValue(document, 'interest', /interest:?\s*£?([\d,]+\.?\d*)/i))
        };
    }

    extractDeductions(document) {
        return {
            pensionContributions: this.extractAmount(this.getFieldValue(document, 'pension')),
            giftAid: this.extractAmount(this.getFieldValue(document, 'giftAid')),
            allowableExpenses: this.extractAmount(this.getFieldValue(document, 'expenses'))
        };
    }

    extractAddress(document) {
        const addressPattern = /address:?\s*([\s\S]*?)(?=\n\s*\n|\n\s*[A-Z]|$)/i;
        const match = document.text.match(addressPattern);
        return match ? match[1].trim().split('\n').map(line => line.trim()).filter(Boolean) : [];
    }

    async validateEntities(entities) {
        await super.validateEntities(entities);
        this.validatePersonalDetails(entities.personalDetails);
        this.validateIncomeDetails(entities.income);
        return true;
    }
}

export { SA100Processor };