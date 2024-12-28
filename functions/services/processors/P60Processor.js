import { BaseProcessor } from './BaseProcessor';

class P60Processor extends BaseProcessor {
    async extractEntities(document) {
        return {
            taxYear: this.extractTaxYear(document),
            employerName: this.getFieldValue(document, 'employerName'),
            employerRef: this.getFieldValue(document, 'employerRef'),
            income: this.extractAmount(this.getFieldValue(document, 'totalPay')),
            taxPaid: this.extractAmount(this.getFieldValue(document, 'totalTax')),
            niContributions: this.extractAmount(this.getFieldValue(document, 'employeeNI'))
        };
    }

    async validateEntities(entities) {
        await super.validateEntities(entities);
        
        if (!entities.taxYear || !entities.employerRef) {
            throw new Error('Missing required P60 fields');
        }

        return true;
    }

    extractTaxYear(document) {
        const pattern = /tax\s+year\s+(\d{4})[/-](\d{2,4})/i;
        const match = document.text.match(pattern);
        
        if (!match) {
            throw new Error('Tax year not found in document');
        }

        const startYear = match[1];
        const endYear = match[2].length === 2 ? `20${match[2]}` : match[2];
        
        // Validate tax year
        if (parseInt(endYear) - parseInt(startYear) !== 1) {
            throw new Error('Invalid tax year range');
        }

        return `${startYear}-${endYear}`;
    }

    validateEmployerInfo(entities) {
        const paye = /^[0-9]{3}\/[A-Z]{1,2}[0-9]{1,5}$/i;
        
        if (!paye.test(entities.employerRef)) {
            throw new Error('Invalid employer PAYE reference');
        }

        if (!entities.employerName || entities.employerName.length < 3) {
            throw new Error('Invalid employer name');
        }
    }

    processAmounts(entities) {
        const amounts = ['income', 'taxPaid', 'niContributions'];
        const totals = {};

        for (const field of amounts) {
            if (entities[field] < 0) {
                throw new Error(`Invalid ${field}: negative amount`);
            }
            totals[field] = this.extractAmount(entities[field]);
        }

        // Validate relationships
        if (totals.taxPaid > totals.income) {
            throw new Error('Tax paid cannot exceed income');
        }

        if (totals.niContributions > totals.income * 0.12) {
            throw new Error('NI contributions appear too high');
        }

        return totals;
    }

    async processPages(document) {
        const pageResults = [];
        
        for (const page of document.pages) {
            try {
                const pageData = await this.processPage(page);
                pageResults.push(pageData);
            } catch (error) {
                this.metadata.errors = this.metadata.errors || [];
                this.metadata.errors.push({
                    page: page.pageNumber,
                    error: error.message
                });
            }
        }

        return pageResults;
    }
}

export { P60Processor };