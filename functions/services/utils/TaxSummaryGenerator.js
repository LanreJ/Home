import { admin } from '../../config/firebase';
import { HMRCClient } from '../hmrc/HMRCClient';

class TaxSummaryGenerator {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.rates = {
            ni: {
                primary: { threshold: 12570, rate: 0.12 },
                upper: { threshold: 50270, rate: 0.02 }
            },
            tax: {
                basic: { threshold: 37700, rate: 0.20 },
                higher: { threshold: 150000, rate: 0.40 },
                additional: { rate: 0.45 }
            },
            allowances: {
                personal: 12570,
                trading: 1000,
                property: 1000,
                dividends: 2000
            }
        };
    }

    async generateTaxSummary(forms) {
        try {
            if (!forms.SA100) {
                throw new Error('SA100 form is required');
            }

            const formData = this.processFormData(forms);
            const income = this.calculateTotalIncome(formData.income);
            const deductions = this.calculateDeductions(formData);
            const taxBands = this.calculateTaxBands(income.taxable);
            const ni = this.calculateNI(income);

            const summary = {
                personalDetails: formData.personalDetails,
                income,
                deductions,
                tax: {
                    bands: taxBands,
                    ni,
                    total: Object.values(taxBands).reduce((a, b) => a + b, 0) + ni.amount,
                    effectiveRate: this.calculateEffectiveRate(income.total)
                },
                hmrcSubmission: formData.hmrcSubmission,
                metadata: {
                    ...formData.metadata,
                    generated: admin.firestore.FieldValue.serverTimestamp(),
                    status: 'DRAFT'
                }
            };

            const validation = await this.validateTaxReturn(summary);
            if (!validation.isValid) {
                throw new Error(`Tax return validation failed: ${validation.errors.join(', ')}`);
            }

            const stored = await this.storeTaxReturn(summary);
            return { returnId: stored.id, summary, validation };
        } catch (error) {
            throw new Error(`Failed to generate tax summary: ${error.message}`);
        }
    }

    async validateTaxReturn(summary) {
        // Add validation logic
    }

    async storeTaxReturn(summary) {
        // Add storage logic
    }

    generateProcessingHistory(summary) {
        // Add history tracking
    }

    processFormData(forms) {
        if (!forms.SA100) {
            throw new Error('SA100 form is required');
        }

        return {
            personalDetails: this.extractPersonalDetails(forms.SA100),
            income: this.processIncomeSources(forms),
            allowances: this.calculateAllowances(forms),
            hmrcSubmission: {
                utr: forms.SA100.entities.personalDetails.utr,
                nino: forms.SA100.entities.personalDetails.nino,
                taxYear: this.taxYear,
                clientId: process.env.HMRC_CLIENT_ID,
                applicationId: process.env.HMRC_APPLICATION_ID
            },
            metadata: {
                formTypes: Object.keys(forms),
                processed: new Date().toISOString(),
                processingEnvironment: 'TEST',
                version: '1.0'
            }
        };
    }

    extractPersonalDetails(sa100) {
        if (!sa100?.entities?.personalDetails) {
            throw new Error('Missing personal details in SA100');
        }
        
        return {
            name: sa100.entities.personalDetails.name,
            utr: sa100.entities.personalDetails.utr,
            nino: sa100.entities.personalDetails.nino,
            address: sa100.entities.personalDetails.address,
            phoneNumber: sa100.entities.personalDetails.phoneNumber,
            email: sa100.entities.personalDetails.email
        };
    }

    processIncomeSources(forms) {
        return {
            employment: this.processEmploymentIncome(forms.SA100),
            selfEmployment: this.processSelfEmploymentIncome(forms.SA100),
            property: this.processPropertyIncome(forms.SA105),
            investments: this.processInvestmentIncome(forms.SA100),
            total: this.calculateTotalIncome(forms)
        };
    }

    calculateAllowances(forms) {
        const totalIncome = this.calculateTotalIncome(forms);
        return {
            personal: this.calculatePersonalAllowance(totalIncome),
            trading: this.calculateTradingAllowance(forms.SA100),
            property: this.calculatePropertyAllowance(forms.SA105),
            total: this.sumAllowances(forms)
        };
    }

    async submitToHMRC(summary) {
        const hmrcClient = new HMRCClient({
            clientId: process.env.HMRC_CLIENT_ID,
            clientSecret: process.env.HMRC_CLIENT_SECRET,
            applicationId: process.env.HMRC_APPLICATION_ID
        });

        try {
            const response = await hmrcClient.submitTaxReturn(summary);
            await this.updateSubmissionStatus(summary.id, response.data);
            return response.data;
        } catch (error) {
            throw new Error(`HMRC submission failed: ${error.message}`);
        }
    }

    async processAndSubmit(forms) {
        try {
            const summary = await this.generateTaxSummary(forms);
            const hmrcResponse = await this.submitToHMRC(summary);
            
            await this.updateSubmissionStatus(summary.returnId, {
                hmrcSubmissionId: hmrcResponse.submissionId,
                submittedAt: admin.firestore.FieldValue.serverTimestamp(),
                status: 'SUBMITTED'
            });

            return {
                returnId: summary.returnId,
                hmrcSubmissionId: hmrcResponse.submissionId,
                status: 'SUBMITTED',
                summary
            };
        } catch (error) {
            throw new Error(`Tax return processing failed: ${error.message}`);
        }
    }

    async updateSubmissionStatus(returnId, update) {
        return admin.firestore()
            .collection('tax_returns')
            .doc(returnId)
            .update({
                ...update,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });
    }
}

function calculateTaxSummary(incomes, allowances, benefits) {
    // Extend logic for multi-income scenarios
    let totalTax = 0;
    incomes.forEach((income) => {
        // handle multiple income types
        totalTax += computeTaxForIncome(income, allowances, benefits);
    });
    return totalTax;
}

export { TaxSummaryGenerator };