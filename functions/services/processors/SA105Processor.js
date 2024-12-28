import { BaseProcessor } from './BaseProcessor';

class SA105Processor extends BaseProcessor {
    async process(document) {
        const entities = await this.extractEntities(document);
        
        return {
            type: 'SA105',
            entities,
            metadata: {
                confidence: document.textStyles[0]?.confidence || 0,
                processed: new Date().toISOString()
            }
        };
    }

    async extractEntities(document) {
        return {
            propertyDetails: this.extractPropertyDetails(document),
            income: this.extractIncomeDetails(document),
            expenses: this.extractExpenseDetails(document)
        };
    }

    extractPropertyDetails(document) {
        return {
            address: this.extractAddress(document),
            propertyType: this.getFieldValue(document, 'propertyType'),
            furnished: this.getFieldValue(document, 'furnished') === 'Yes'
        };
    }

    extractIncomeDetails(document) {
        return {
            rentReceived: this.extractAmount(this.getFieldValue(document, 'rent')),
            otherIncome: this.extractAmount(this.getFieldValue(document, 'otherIncome'))
        };
    }

    extractExpenseDetails(document) {
        return {
            repairs: this.extractAmount(this.getFieldValue(document, 'repairs')),
            insurance: this.extractAmount(this.getFieldValue(document, 'insurance')),
            management: this.extractAmount(this.getFieldValue(document, 'management')),
            mortgageInterest: this.extractAmount(this.getFieldValue(document, 'mortgage')),
            groundRent: this.extractAmount(this.getFieldValue(document, 'groundRent')),
            furnishing: this.extractAmount(this.getFieldValue(document, 'furnishing'))
        };
    }

    validatePropertyIncome(income, expenses) {
        // Validate total income
        if (income.rentReceived < 0) {
            throw new Error('Rent received cannot be negative');
        }

        // Validate expenses ratio
        const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0);
        if (totalExpenses > income.rentReceived * 0.8) {
            this.metadata.warnings = this.metadata.warnings || [];
            this.metadata.warnings.push('High expense ratio detected');
        }

        return true;
    }

    async validatePropertyData(entities) {
        const { propertyDetails, income, expenses } = entities;
        
        // Validate property details
        if (!propertyDetails.address || propertyDetails.address.length === 0) {
            throw new Error('Property address is required');
        }

        // Validate income
        this.validatePropertyIncome(income, expenses);

        // Check property type specific rules
        if (propertyDetails.furnished) {
            this.validateFurnishedProperty(expenses);
        }

        return true;
    }

    validateFurnishedProperty(expenses) {
        if (expenses.furnishing > 0 && !this.metadata.warnings) {
            this.metadata.warnings = [];
        }
        
        if (expenses.furnishing > 25000) {
            this.metadata.warnings.push('High furnishing expenses - additional documentation may be required');
        }
    }

    calculateAllowances(income, propertyDetails) {
        let allowances = 0;
        
        // Property income allowance
        if (income.rentReceived <= 1000) {
            allowances += income.rentReceived;
        } else {
            allowances += 1000;
        }

        // Furnished property allowance
        if (propertyDetails.furnished) {
            allowances += Math.min(expenses.furnishing, 1000);
        }

        return allowances;
    }

    calculateNetIncome(income, expenses) {
        const totalIncome = income.rentReceived + income.otherIncome;
        const totalExpenses = Object.values(expenses).reduce((a, b) => a + b, 0);
        return Math.max(0, totalIncome - totalExpenses);
    }

    async processResults(entities) {
        const netIncome = this.calculateNetIncome(entities.income, entities.expenses);
        const allowances = this.calculateAllowances(entities.income, entities.propertyDetails);
        const taxableIncome = Math.max(0, netIncome - allowances);

        return {
            ...entities,
            calculations: {
                netIncome,
                allowances,
                taxableIncome,
                taxImplications: this.calculateTaxImplications(taxableIncome)
            },
            metadata: {
                ...this.metadata,
                processingComplete: true,
                calculationsVersion: '1.0',
                timestamp: new Date().toISOString()
            }
        };
    }

    calculateTaxImplications(taxableIncome) {
        const taxBands = {
            basic: { threshold: 37700, rate: 0.20 },
            higher: { threshold: 150000, rate: 0.40 },
            additional: { rate: 0.45 }
        };

        let tax = 0;
        let remainingIncome = taxableIncome;

        // Basic rate
        const basicRateAmount = Math.min(remainingIncome, taxBands.basic.threshold);
        tax += basicRateAmount * taxBands.basic.rate;
        remainingIncome -= basicRateAmount;

        // Higher rate
        if (remainingIncome > 0) {
            const higherRateAmount = Math.min(remainingIncome, 
                taxBands.higher.threshold - taxBands.basic.threshold);
            tax += higherRateAmount * taxBands.higher.rate;
            remainingIncome -= higherRateAmount;
        }

        // Additional rate
        if (remainingIncome > 0) {
            tax += remainingIncome * taxBands.additional.rate;
        }

        return {
            taxDue: Math.round(tax * 100) / 100,
            effectiveRate: Math.round((tax / taxableIncome) * 100) / 100,
            bands: {
                basic: basicRateAmount * taxBands.basic.rate,
                higher: remainingIncome > 0 ? higherRateAmount * taxBands.higher.rate : 0,
                additional: remainingIncome > 0 ? remainingIncome * taxBands.additional.rate : 0
            }
        };
    }

    async generateTaxSummary(entities, calculations) {
        const summary = {
            propertyDetails: {
                address: entities.propertyDetails.address,
                type: entities.propertyDetails.propertyType,
                furnished: entities.propertyDetails.furnished
            },
            income: {
                gross: entities.income.rentReceived + entities.income.otherIncome,
                expenses: Object.values(entities.expenses).reduce((a, b) => a + b, 0),
                net: calculations.netIncome,
                allowances: calculations.allowances,
                taxable: calculations.taxableIncome
            },
            tax: calculations.taxImplications,
            metadata: {
                taxYear: this.taxYear,
                processingDate: new Date().toISOString(),
                version: '1.0'
            }
        };

        await this.storeTaxSummary(summary);
        return summary;
    }

    async storeTaxSummary(summary) {
        const docRef = await admin.firestore()
            .collection('property_tax_returns')
            .add({
                ...summary,
                status: 'DRAFT',
                created: admin.firestore.FieldValue.serverTimestamp(),
                updated: admin.firestore.FieldValue.serverTimestamp(),
                validation: await this.validateTaxSummary(summary)
            });

        await this.updateProcessingStatus(docRef.id, 'COMPLETED');
        return docRef;
    }

    async validateTaxSummary(summary) {
        const validationResults = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Validate income thresholds
        if (summary.income.gross > 85000) {
            validationResults.warnings.push('VAT threshold exceeded - registration may be required');
        }

        // Validate expense ratios
        const expenseRatio = summary.income.expenses / summary.income.gross;
        if (expenseRatio > 0.8) {
            validationResults.warnings.push('High expense ratio detected');
        }

        return validationResults;
    }

    async updateProcessingStatus(returnId, status) {
        return admin.firestore()
            .collection('property_tax_returns')
            .doc(returnId)
            .update({
                status,
                updated: admin.firestore.FieldValue.serverTimestamp()
            });
    }
}

export { SA105Processor };