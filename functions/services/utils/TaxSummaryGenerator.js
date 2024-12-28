import { admin } from '../../config/firebase';

class TaxSummaryGenerator {
    constructor(taxYear) {
        this.taxYear = taxYear;
    }

    async generateSummary(forms) {
        try {
            const income = this.calculateTotalIncome(forms);
            const deductions = this.calculateDeductions(forms);
            const taxBands = this.calculateTaxBands(income.taxable);
            const ni = this.calculateNI(income);

            const summary = {
                personalDetails: forms.SA100?.entities.personalDetails,
                income,
                deductions,
                propertyIncome: forms.SA105?.calculations,
                tax: {
                    bands: taxBands,
                    ni,
                    total: Object.values(taxBands).reduce((a, b) => a + b, 0) + ni.amount,
                    effectiveRate: this.calculateEffectiveRate(income.total)
                },
                metadata: {
                    taxYear: this.taxYear,
                    generated: admin.firestore.FieldValue.serverTimestamp(),
                    version: '1.0',
                    status: 'DRAFT'
                }
            };

            await this.validateAndStoreTaxReturn(summary);
            return summary;
        } catch (error) {
            throw new Error(`Failed to generate tax summary: ${error.message}`);
        }
    }

    calculateTotalIncome(forms) {
        const income = this.processAllIncomeSources(forms);
        const totalIncome = this.calculateTotal(income);
        const allowances = this.calculateAllowances(totalIncome);
        const taxableIncome = Math.max(0, totalIncome - allowances);

        return {
            sources: income,
            total: totalIncome,
            allowances,
            taxable: taxableIncome,
            bands: this.calculateTaxBands(taxableIncome),
            metadata: {
                calculatedAt: new Date().toISOString(),
                version: '1.0',
                warnings: this.generateWarnings(totalIncome)
            }
        };
    }

    processAllIncomeSources(forms) {
        return {
            employment: this.processEmploymentIncome(forms),
            selfEmployment: this.processSelfEmploymentIncome(forms),
            property: this.processPropertyIncome(forms),
            investments: this.processInvestmentIncome(forms),
            other: forms.SA100?.entities.income.other || 0
        };
    }

    sumIncomeFromAllSources(income) {
        return Object.values(income).reduce((total, source) => {
            if (typeof source === 'number') return total + source;
            return total + (source.net || 0);
        }, 0);
    }

    calculateAllowances(totalIncome) {
        const baseAllowance = 12570;
        if (totalIncome <= 100000) return baseAllowance;
        
        const reduction = Math.floor((totalIncome - 100000) / 2);
        return Math.max(0, baseAllowance - reduction);
    }

    processEmploymentIncome(forms) {
        const salary = forms.SA100?.entities.income.employment || 0;
        const benefits = forms.SA100?.entities.income.benefits || 0;
        const expenses = forms.SA100?.entities.income.employmentExpenses || 0;

        return {
            salary,
            benefits,
            expenses,
            net: salary + benefits - expenses,
            allowableExpenses: this.validateAllowableExpenses(expenses, salary)
        };
    }

    processSelfEmploymentIncome(forms) {
        const income = forms.SA100?.entities.income.selfEmployment || 0;
        const expenses = forms.SA100?.entities.income.selfEmploymentExpenses || 0;
        const tradingAllowance = Math.min(income, 1000);
        
        return {
            income,
            expenses,
            tradingAllowance,
            net: Math.max(0, income - Math.max(expenses, tradingAllowance)),
            metadata: {
                usedTradingAllowance: expenses <= tradingAllowance,
                exceedsVatThreshold: income > 85000,
                taxYear: this.taxYear
            }
        };
    }

    processPropertyIncome(forms) {
        const propertyData = forms.SA105?.calculations || {};
        const income = propertyData.income?.gross || 0;
        const expenses = propertyData.expenses || 0;
        const propertyAllowance = Math.min(income, 1000);

        return {
            income,
            expenses,
            propertyAllowance,
            net: Math.max(0, income - Math.max(expenses, propertyAllowance)),
            metadata: {
                usedPropertyAllowance: expenses <= propertyAllowance,
                isFurnished: propertyData.furnished || false
            }
        };
    }

    processInvestmentIncome(forms) {
        const dividends = forms.SA100?.entities.income.dividends || 0;
        const interest = forms.SA100?.entities.income.interest || 0;

        return {
            dividends: {
                gross: dividends,
                allowance: Math.min(dividends, 2000),
                taxable: Math.max(0, dividends - 2000)
            },
            interest: {
                gross: interest,
                allowance: this.calculateSavingsAllowance(interest),
                taxable: Math.max(0, interest - this.calculateSavingsAllowance(interest))
            },
            total: dividends + interest
        };
    }

    calculateSavingsAllowance(totalIncome) {
        if (totalIncome <= 50270) return 1000;
        if (totalIncome <= 150000) return 500;
        return 0;
    }

    calculateTotal(income) {
        return Object.values(income).reduce((total, source) => {
            if (typeof source === 'number') return total + source;
            return total + (source.net || 0);
        }, 0);
    }

    categorizeIncome(income) {
        return {
            trading: income.employment.total + income.selfEmployment.net,
            investment: income.investments.dividends.amount + income.investments.interest.amount,
            property: income.property
        };
    }

    checkIncomeThresholds(income) {
        const total = this.calculateTotal(income);
        return {
            vatThreshold: total > 85000,
            higherRateThreshold: total > 50270,
            additionalRateThreshold: total > 150000,
            personalAllowanceThreshold: total > 100000
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

    async validateTaxReturn(summary) {
        const validation = {
            isValid: true,
            errors: [],
            warnings: []
        };

        // Check required fields
        if (!summary.personalDetails?.utr) {
            validation.errors.push('Missing UTR number');
            validation.isValid = false;
        }

        // Validate calculations
        if (summary.income.total < summary.tax.total) {
            validation.errors.push('Tax due exceeds total income');
            validation.isValid = false;
        }

        // Check thresholds
        if (summary.income.total > 100000) {
            validation.warnings.push('Personal allowance reduction applies');
        }
        if (summary.income.total > 85000) {
            validation.warnings.push('VAT registration may be required');
        }

        return validation;
    }

    async validateAndStoreTaxReturn(summary) {
        const validation = await this.validateTaxReturn(summary);
        
        const returnData = {
            ...summary,
            status: validation.warnings.length > 0 ? 'NEEDS_REVIEW' : 'READY',
            validation,
            metadata: {
                ...summary.metadata,
                processedAt: admin.firestore.FieldValue.serverTimestamp(),
                version: '1.0',
                lastUpdated: new Date().toISOString()
            }
        };

        const returnRef = await admin.firestore()
            .collection('tax_returns')
            .add(returnData);

        return { 
            returnId: returnRef.id, 
            status: returnData.status,
            validation 
        };
    }

    async updateProcessingStatus(returnId, status) {
        return admin.firestore()
            .collection('tax_returns')
            .doc(returnId)
            .update({
                status,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
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

    calculateTaxBands(taxableIncome) {
        const bands = {
            basic: { threshold: 37700, rate: 0.20 },
            higher: { threshold: 150000, rate: 0.40 },
            additional: { rate: 0.45 }
        };

        let remaining = taxableIncome;
        const tax = { basic: 0, higher: 0, additional: 0 };

        // Calculate tax for each band
        tax.basic = Math.min(remaining, bands.basic.threshold) * bands.basic.rate;
        remaining -= bands.basic.threshold;

        if (remaining > 0) {
            const higherAmount = Math.min(remaining, 
                bands.higher.threshold - bands.basic.threshold);
            tax.higher = higherAmount * bands.higher.rate;
            remaining -= higherAmount;
        }

        if (remaining > 0) {
            tax.additional = remaining * bands.additional.rate;
        }

        return tax;
    }

    calculateEffectiveRate(totalTax, taxableIncome) {
        return taxableIncome > 0 ? (totalTax / taxableIncome) * 100 : 0;
    }

    generateFinalSummary(income, deductions) {
        return {
            grossIncome: income.total,
            allowances: deductions.total,
            taxableIncome: Math.max(0, income.total - deductions.total),
            taxBands: this.calculateTaxBands(income.total - deductions.total),
            nationalInsurance: this.calculateNI(income),
            warnings: this.generateWarnings(income)
        };
    }

    generateWarnings(income) {
        const warnings = [];
        if (income.total > 100000) warnings.push('Personal allowance reduction applies');
        if (income.total > 85000) warnings.push('VAT registration may be required');
        return warnings;
    }

    calculateNI(income) {
        const rates = {
            primary: { threshold: 12570, rate: 0.12 },
            upper: { threshold: 50270, rate: 0.02 }
        };

        let ni = 0;
        let remaining = income.employment?.salary || 0;
        let primaryBand = 0;
        let upperBand = 0;

        // Calculate primary threshold NI
        if (remaining > rates.primary.threshold) {
            primaryBand = Math.min(
                remaining - rates.primary.threshold,
                rates.upper.threshold - rates.primary.threshold
            );
            ni += primaryBand * rates.primary.rate;
            remaining -= primaryBand;
        }

        // Calculate upper threshold NI
        if (remaining > rates.upper.threshold) {
            upperBand = remaining - rates.upper.threshold;
            ni += upperBand * rates.upper.rate;
        }

        return {
            amount: Math.round(ni * 100) / 100,
            breakdown: {
                primary: Math.round((primaryBand * rates.primary.rate) * 100) / 100,
                upper: Math.round((upperBand * rates.upper.rate) * 100) / 100
            },
            thresholds: {
                primary: rates.primary.threshold,
                upper: rates.upper.threshold
            }
        };
    }

    async generateFinalSummary(income, deductions) {
        const taxBands = this.calculateTaxBands(income.total - deductions.total);
        const ni = this.calculateNI(income);
        const totalTax = Object.values(taxBands).reduce((a, b) => a + b, 0) + ni.amount;

        return {
            income: {
                gross: income.total,
                taxable: income.total - deductions.total,
                net: income.total - totalTax
            },
            tax: {
                bands: taxBands,
                ni: ni,
                total: totalTax,
                effectiveRate: this.calculateEffectiveRate(totalTax, income.total)
            },
            warnings: this.generateWarnings(income),
            metadata: {
                calculatedAt: new Date().toISOString(),
                version: '1.0'
            }
        };
    }

    calculateNationalInsurance(income) {
        const rates = {
            primary: { threshold: 12570, rate: 0.12 },
            upper: { threshold: 50270, rate: 0.02 }
        };

        let ni = 0;
        let remaining = income.employment?.salary || 0;

        // Calculate primary threshold NI
        if (remaining > rates.primary.threshold) {
            const primaryBand = Math.min(
                remaining - rates.primary.threshold,
                rates.upper.threshold - rates.primary.threshold
            );
            ni += primaryBand * rates.primary.rate;
            remaining -= primaryBand;
        }

        // Calculate upper threshold NI
        if (remaining > rates.upper.threshold) {
            ni += (remaining - rates.upper.threshold) * rates.upper.rate;
        }

        return {
            amount: Math.round(ni * 100) / 100,
            breakdown: {
                primary: Math.round((ni * rates.primary.rate) * 100) / 100,
                upper: Math.round((ni * rates.upper.rate) * 100) / 100
            }
        };
    }
}

export { TaxSummaryGenerator };