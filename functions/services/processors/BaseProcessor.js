class BaseProcessor {
    constructor() {
        this.confidence = 0;
        this.metadata = {};
    }

    async process(document) {
        this.confidence = document.textStyles[0]?.confidence || 0;
        this.metadata = {
            pageCount: document.pages?.length || 0,
            processingTime: new Date().toISOString()
        };

        const entities = await this.extractEntities(document);
        await this.validateEntities(entities);

        return {
            entities,
            metadata: this.metadata,
            confidence: this.confidence
        };
    }

    async extractEntities(document) {
        throw new Error('extractEntities must be implemented by subclass');
    }

    async validateEntities(entities) {
        const validationRules = {
            utr: (value) => /^\d{10}$/.test(value),
            nino: (value) => /^[A-Z]{2}\d{6}[A-D]$/.test(value),
            amount: (value) => !isNaN(value) && value >= 0
        };

        const errors = [];
        for (const [field, value] of Object.entries(entities)) {
            const rule = validationRules[field];
            if (rule && !rule(value)) {
                errors.push(`Invalid ${field}: ${value}`);
            }
        }

        if (errors.length > 0) {
            throw new Error(`Validation failed: ${errors.join(', ')}`);
        }

        return true;
    }

    extractText(document, pattern) {
        const match = document.text.match(pattern);
        return match ? match[1].trim() : null;
    }

    extractAmount(text) {
        if (!text) return 0;
        const amount = parseFloat(text.replace(/[£,]/g, ''));
        return isNaN(amount) ? 0 : amount;
    }

    protected getFieldValue(document, fieldName) {
        const patterns = {
            utr: /UTR:?\s*(\d{10})/i,
            nino: /NI(?:NO)?:?\s*([A-Z]{2}\d{6}[A-D])/i,
            amount: /£?\s*([\d,]+\.?\d*)/
        };

        const pattern = patterns[fieldName];
        if (!pattern) {
            throw new Error(`No pattern defined for field: ${fieldName}`);
        }

        const match = document.text.match(pattern);
        return match ? match[1].trim() : null;
    }
}

export { BaseProcessor };