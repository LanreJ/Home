import { OpenAI } from 'openai';
import { getFirestore } from 'firebase-admin/firestore';

export class AIAssistant {
    constructor(openai, db) {
        this.openai = openai;
        this.db = db;
        this.systemPrompt = `You are a UK tax expert assistant helping with self-assessment returns.
            Focus on accuracy and compliance with HMRC guidelines.
            Provide clear explanations and suggest relevant documentation when needed.`;
    }

    async initialize(userId) {
        this.userId = userId;
        this.conversationRef = this.db.collection('conversations').doc(userId);
        await this.loadContext();
    }

    async processQuery(query, documents = [], bankData = {}) {
        try {
            const context = await this.buildContext(documents, bankData);
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'system', content: context },
                    ...this.conversationHistory,
                    { role: 'user', content: query }
                ],
                temperature: 0.3
            });

            const response = completion.choices[0].message.content;
            await this.saveInteraction(query, response);
            return response;
        } catch (error) {
            console.error('AI processing error:', error);
            throw new Error('Failed to process query');
        }
    }

    async validateFormField(fieldName, value, formContext) {
        try {
            const completion = await this.openai.chat.completions.create({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: this.systemPrompt },
                    { role: 'user', content: `Validate ${fieldName}: ${value}` },
                    { role: 'system', content: JSON.stringify(formContext) }
                ],
                temperature: 0.1
            });
            return JSON.parse(completion.choices[0].message.content);
        } catch (error) {
            console.error('Field validation error:', error);
            throw new Error('Failed to validate field');
        }
    }

    private async loadContext() {
        const snapshot = await this.conversationRef.get();
        this.conversationHistory = snapshot.exists ? 
            snapshot.data().history || [] : [];
    }

    private async buildContext(documents, bankData) {
        return JSON.stringify({
            documents: documents.map(doc => ({
                type: doc.type,
                extracted_data: doc.data,
                confidence: doc.confidence
            })),
            banking: {
                income: bankData.income || [],
                expenses: bankData.expenses || [],
                categories: bankData.categories || {}
            }
        });
    }

    private async saveInteraction(query, response) {
        const interaction = {
            timestamp: new Date(),
            query,
            response
        };
        
        await this.conversationRef.set({
            history: [...this.conversationHistory, interaction],
            updatedAt: new Date()
        }, { merge: true });
    }
}