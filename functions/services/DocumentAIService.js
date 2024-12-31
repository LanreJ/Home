import { DocumentProcessorServiceClient } from '@google-cloud/documentai';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';

export class DocumentAIService {
    constructor(projectId) {
        this.client = new DocumentProcessorServiceClient();
        this.storage = getStorage();
        this.projectId = projectId;
        this.location = 'europe-west2';
        this.processors = {
            default: '937da5fa78490a0b',
            receipt: 'a8b390cf49281c',
            form: 'c7d234ef56789a'
        };
    }

    async processDocument(file, type = 'default') {
        try {
            const processorId = this.processors[type];
            const name = `projects/${this.projectId}/locations/${this.location}/processors/${processorId}`;
            
            const docBuffer = await this.readFileBuffer(file);
            const request = {
                name,
                document: {
                    content: docBuffer.toString('base64'),
                    mimeType: file.mimetype
                }
            };

            const [result] = await this.client.processDocument(request);
            return this.parseResult(result);
        } catch (error) {
            logger.error('Document processing failed:', error);
            throw error;
        }
    }

    async detectDocumentType(file) {
        const documentTypes = {
            'P60': /P60|P 60|Employment Details/i,
            'BankStatement': /Statement|Account Summary|Transaction History/i,
            'Receipt': /Receipt|Invoice|Bill of Sale/i,
            'TaxCertificate': /Tax Certificate|Interest Statement|Dividend/i
        };

        const text = await this.extractText(file);
        for (const [type, pattern] of Object.entries(documentTypes)) {
            if (pattern.test(text)) return type;
        }
        return 'Unknown';
    }

    private async parseResult(result) {
        const { document } = result;
        return {
            text: document.text,
            pages: document.pages.map(page => ({
                pageNumber: page.pageNumber,
                width: page.width,
                height: page.height,
                blocks: page.blocks,
                paragraphs: page.paragraphs,
                lines: page.lines,
                tokens: page.tokens
            })),
            entities: document.entities,
            confidence: document.textStyles?.[0]?.confidence || 0
        };
    }

    private async readFileBuffer(file) {
        if (file.buffer) return file.buffer;
        return await this.storage.bucket().file(file.path).download();
    }
}