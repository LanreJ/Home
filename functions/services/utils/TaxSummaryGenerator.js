import { admin } from '../../config/firebase';

class TaxSummaryGenerator {
    constructor(taxYear) {
        this.taxYear = taxYear;
    }

    async generateSummary(forms) {
        const summary = {
            personalDetails: forms.SA100?.entities.personalDetails,
            income: this.calculateTotalIncome(forms),
            deductions: this.calculateDeductions(forms),
            propertyIncome: forms.SA105?.calculations,
            totalTax: this.calculateTotalTax(forms),
            metadata: {
                taxYear: this.taxYear,
                generated: admin.firestore.FieldValue.serverTimestamp(),
                version: '1.0'
            }
        };

        await this.validateAndStoreTaxReturn(summary);
        return summary;
    }

    calculateTotalIncome(forms) {
        const income = {
            employment: forms.SA100?.entities.income.employment || 0,
            selfEmployment: forms.SA100?.entities.income.selfEmployment || 0,
            property: forms.SA105?.calculations.taxableIncome || 0,
            dividends: forms.SA100?.entities.income.dividends || 0,
            interest: forms.SA100?.entities.income.interest || 0,
            other: forms.SA100?.entities.income.other || 0
        };

        return {
            ...income,
            total: Object.values(income).reduce((sum, val) => sum + val, 0),
            breakdown: {
                trading: income.employment + income.selfEmployment,
                investment: income.dividends + income.interest,
                property: income.property
            }
        };
    }

    sumIncomes(forms) {
        const incomeTypes = ['employment', 'selfEmployment', 'property', 'dividends', 'interest'];
        return incomeTypes.reduce((total, type) => 
            total + (forms.SA100?.entities.income[type] || 0), 0);
    }

    calculateDeductions(forms) {
        return {
            personalAllowance: this.calculatePersonalAllowance(forms),
            pensionContributions: forms.SA100?.entities.deductions.pensionContributions || 0,
            giftAid: forms.SA100?.entities.deductions.giftAid || 0,
            total: this.sumDeductions(forms)
        };
    }

    calculatePersonalAllowance(forms) {
        const baseAllowance = 12570;
        const totalIncome = this.sumIncomes(forms);
        
        if (totalIncome <= 100000) return baseAllowance;
        
        const reduction = Math.floor((totalIncome - 100000) / 2);
        return Math.max(0, baseAllowance - reduction);
    }

    async storeTaxReturn(summary) {
        return admin.firestore()
            .collection('tax_returns')
            .add({
                ...summary,
                status: 'DRAFT',
                created: admin.firestore.FieldValue.serverTimestamp(),
                updated: admin.firestore.FieldValue.serverTimestamp()
            });
    }

    async validateAndStoreTaxReturn(summary) {
        const validation = await this.validateTaxSummary(summary);
        if (!validation.isValid) {
            throw new Error(`Tax summary validation failed: ${validation.errors.join(', ')}`);
        }

        return this.storeTaxReturn({
            ...summary,
            validation,
            status: validation.warnings.length > 0 ? 'NEEDS_REVIEW' : 'READY'
        });
    }

    calculateTotalTax(forms) {
        const taxableIncome = this.calculateTaxableIncome(forms);
        const taxBands = this.calculateTaxBands(taxableIncome);
        const ni = this.calculateNationalInsurance(forms);

        return {
            incomeTax: {
                basic: taxBands.basic,
                higher: taxBands.higher,
                additional: taxBands.additional,
                total: Object.values(taxBands).reduce((a, b) => a + b, 0)
            },
            nationalInsurance: ni,
            total: taxBands.total + ni,
            effectiveRate: this.calculateEffectiveRate(taxBands.total + ni, taxableIncome)
        };
    }

    calculateTaxBands(income) {
        const bands = {
            basic: { threshold: 37700, rate: 0.20 },
            higher: { threshold: 150000, rate: 0.40 },
            additional: { rate: 0.45 }
        };

        let remaining = income;
        const tax = { basic: 0, higher: 0, additional: 0 };

        // Basic Rate
        tax.basic = Math.min(remaining, bands.basic.threshold) * bands.basic.rate;
        remaining -= bands.basic.threshold;

        // Higher Rate
        if (remaining > 0) {
            const higherAmount = Math.min(remaining, bands.higher.threshold - bands.basic.threshold);
            tax.higher = higherAmount * bands.higher.rate;
            remaining -= higherAmount;
        }

        // Additional Rate
        if (remaining > 0) {
            tax.additional = remaining * bands.additional.rate;
        }

        tax.total = Object.values(tax).reduce((a, b) => a + b, 0);
        return tax;
    }

    calculateEffectiveRate(totalTax, taxableIncome) {
        return taxableIncome > 0 ? (totalTax / taxableIncome) * 100 : 0;
    }
}

export { TaxSummaryGenerator };