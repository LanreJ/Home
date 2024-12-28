import { admin } from '../../config/firebase';

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
            const income = this.calculateTotalIncome(forms);
            const deductions = this.calculateDeductions(forms);
            const taxBands = this.calculateTaxBands(income.taxable);
            const ni = this.calculateNI(income);

            const summary = await this.generateFinalSummary(income, deductions, taxBands, ni);
            const validation = await this.validateTaxReturn(summary);
            const stored = await this.storeTaxReturn(summary);

            return {
                returnId: stored.id,
                summary,
                validation,
                status: stored.status
            };
        } catch (error) {
            throw new Error(`Tax summary generation failed: ${error.message}`);
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
        return {
            personalDetails: this.extractPersonalDetails(forms.SA100),
            income: this.processIncomeSources(forms),
            allowances: this.calculateAllowances(forms),
            metadata: {
                formTypes: Object.keys(forms),
                processed: new Date().toISOString(),
                taxYear: this.taxYear
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
            address: sa100.entities.personalDetails.address
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
}

export { TaxSummaryGenerator };