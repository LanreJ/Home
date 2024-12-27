const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;

class DocumentProcessor {
    constructor(processorId) {
        this.client = new DocumentProcessorServiceClient();
        this.processorPath = `projects/taxstats-document-ai/locations/eu/processors/${processorId}`;
    }

    async processDocument(file) {
        try {
            const [result] = await this.client.processDocument({
                name: this.processorPath,
                document: {
                    content: file.buffer,
                    mimeType: file.mimetype
                }
            });

            return {
                entities: this.extractEntities(result.document),
                metadata: {
                    confidence: result.document.textStyles[0]?.confidence || 0,
                    pageCount: result.document.pages?.length || 1,
                    documentType: this.detectDocumentType(result.document)
                }
            };
        } catch (error) {
            console.error('Document processing error:', error);
            throw new Error('Failed to process document');
        }
    }

    extractEntities(document) {
        return {
            amounts: this.findAmounts(document),
            dates: this.findDates(document),
            descriptions: this.findDescriptions(document)
        };
    }

    detectDocumentType(document) {
        const text = document.text.toLowerCase();
        if (text.includes('invoice')) return 'INVOICE';
        if (text.includes('receipt')) return 'RECEIPT';
        if (text.includes('statement')) return 'BANK_STATEMENT';
        return 'UNKNOWN';
    }
}

module.exports = DocumentProcessor;