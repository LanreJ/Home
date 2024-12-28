import { DocumentProcessor } from '../DocumentProcessor';
import { TaxReturnService } from '../TaxReturnService';
import { admin } from '../../config/firebase';

class FormProcessor {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.taxRates = this.getTaxRates(taxYear);
    }

    getTaxRates(taxYear) {
        return {
            '2023-24': {
                personalAllowance: 12570,
                basicRate: { threshold: 37700, rate: 0.20 },
                higherRate: { threshold: 150000, rate: 0.40 },
                additionalRate: { rate: 0.45 }
            }
        }[taxYear];
    }

    calculateTax(income) {
        let tax = 0;
        let remainingIncome = income;
        const rates = this.taxRates;

        // Personal Allowance
        if (remainingIncome > rates.personalAllowance) {
            remainingIncome -= rates.personalAllowance;
        } else {
            return 0;
        }

        // Calculate tax bands
        const taxByBand = this.calculateTaxByBand(remainingIncome);
        
        return {
            totalTax: Math.round(taxByBand.total * 100) / 100,
            breakdown: taxByBand.bands
        };
    }

    calculateTaxByBand(income) {
        const rates = this.taxRates;
        const bands = {
            basic: 0,
            higher: 0,
            additional: 0
        };

        // Basic Rate
        const basicRateAmount = Math.min(income, rates.basicRate.threshold);
        bands.basic = basicRateAmount * rates.basicRate.rate;
        income -= basicRateAmount;

        // Higher Rate
        if (income > 0) {
            const higherRateAmount = Math.min(income, 
                rates.higherRate.threshold - rates.basicRate.threshold);
            bands.higher = higherRateAmount * rates.higherRate.rate;
            income -= higherRateAmount;
        }

        // Additional Rate
        if (income > 0) {
            bands.additional = income * rates.additionalRate.rate;
        }

        return {
            total: Object.values(bands).reduce((a, b) => a + b, 0),
            bands
        };
    }

    calculateNationalInsurance(income) {
        const NIRates = {
            primaryThreshold: 12570,
            upperEarningsLimit: 50270,
            primaryRate: 0.12,
            upperRate: 0.02
        };

        let ni = 0;
        let remainingIncome = income;

        if (remainingIncome > NIRates.primaryThreshold) {
            const primaryBand = Math.min(
                remainingIncome - NIRates.primaryThreshold,
                NIRates.upperEarningsLimit - NIRates.primaryThreshold
            );
            ni += primaryBand * NIRates.primaryRate;
            remainingIncome -= primaryBand;
        }

        if (remainingIncome > NIRates.upperEarningsLimit) {
            ni += (remainingIncome - NIRates.upperEarningsLimit) * NIRates.upperRate;
        }

        return Math.round(ni * 100) / 100;
    }

    calculateTaxSummary(income) {
        const incomeTax = this.calculateTax(income);
        const ni = this.calculateNationalInsurance(income);

        return {
            grossIncome: income,
            incomeTax: incomeTax.totalTax,
            nationalInsurance: ni,
            totalDeductions: incomeTax.totalTax + ni,
            netIncome: income - (incomeTax.totalTax + ni),
            breakdown: {
                tax: incomeTax.breakdown,
                ni: ni
            }
        };
    }

    calculateAllowances(income, options) {
        let totalAllowances = 0;
        
        // Marriage Allowance
        if (options.marriageAllowance && income < 50270) {
            totalAllowances += 1260;
        }

        // Blind Person's Allowance
        if (options.blindPersonsAllowance) {
            totalAllowances += 2870;
        }

        // Trading Allowance
        if (options.selfEmployed && income <= 1000) {
            totalAllowances += 1000;
        }

        // Property Allowance
        if (options.propertyIncome && options.propertyIncome <= 1000) {
            totalAllowances += 1000;
        }

        // Capital Gains Annual Exempt Amount
        if (options.capitalGains) {
            totalAllowances += 12300;
        }

        // Personal Savings Allowance
        if (income <= 50270) {
            totalAllowances += 1000; // Basic rate
        } else if (income <= 150000) {
            totalAllowances += 500;  // Higher rate
        }

        return totalAllowances;
    }

    calculateStudentLoan(income, planType) {
        const thresholds = {
            'plan1': 22015,
            'plan2': 27295,
            'plan4': 25375,
            'postgrad': 21000
        };

        if (!planType || !thresholds[planType]) return 0;

        const threshold = thresholds[planType];
        if (income <= threshold) return 0;

        const rate = planType === 'postgrad' ? 0.06 : 0.09;
        return Math.round((income - threshold) * rate * 100) / 100;
    }

    calculateGiftAid(donations) {
        const basicRate = 0.20;
        return Math.round(donations * (basicRate / (1 - basicRate)) * 100) / 100;
    }

    calculatePensionRelief(contributions, income) {
        let rate = 0.20; // Basic rate
        if (income > 50270) rate = 0.40; // Higher rate
        if (income > 150000) rate = 0.45; // Additional rate
        return Math.round(contributions * rate * 100) / 100;
    }

    calculateCapitalGains(gains, taxableIncome) {
        const allowance = 12300;
        const remainingBasicRate = 37700 - taxableIncome;
        let tax = 0;

        if (gains <= allowance) return 0;

        const taxableGains = gains - allowance;
        
        if (remainingBasicRate > 0) {
            const basicRateGains = Math.min(taxableGains, remainingBasicRate);
            tax += basicRateGains * 0.10;
            const higherRateGains = taxableGains - basicRateGains;
            if (higherRateGains > 0) tax += higherRateGains * 0.20;
        } else {
            tax = taxableGains * 0.20;
        }

        return Math.round(tax * 100) / 100;
    }

    calculatePropertyAllowance(income, expenses) {
        const propertyAllowance = 1000;
        if (income <= propertyAllowance) return income;
        return Math.min(expenses, propertyAllowance);
    }

    calculateBusinessRelief(income, expenses, capitalAllowances) {
        let totalRelief = 0;
        
        // Trading allowance check
        if (income <= 1000) {
            totalRelief += income;
            return totalRelief;
        }

        // Business expenses
        totalRelief += Math.min(expenses, income);

        // Capital allowances
        if (capitalAllowances?.annualInvestment) {
            totalRelief += Math.min(capitalAllowances.annualInvestment, 1000000);
        }

        // Loss relief
        if (capitalAllowances?.losses) {
            const lossRelief = Math.min(capitalAllowances.losses, income);
            totalRelief += lossRelief;
        }

        return Math.round(totalRelief * 100) / 100;
    }

    calculateFinalTax(data) {
        const summary = {
            income: this.calculateTotalIncome(data),
            reliefs: {
                business: this.calculateBusinessRelief(data.businessIncome, data.expenses, data.capitalAllowances),
                property: this.calculatePropertyAllowance(data.propertyIncome, data.propertyExpenses),
                personal: this.calculatePersonalAllowance(data.income)
            }
        };

        summary.totalReliefs = Object.values(summary.reliefs).reduce((a, b) => a + b, 0);
        summary.taxableIncome = Math.max(0, summary.income - summary.totalReliefs);
        summary.tax = this.calculateTax(summary.taxableIncome);
        
        return summary;
    }

    generateTaxSummary(data) {
        const income = this.calculateTotalIncome(data);
        const reliefs = this.calculateTotalReliefs(data);
        const taxableIncome = Math.max(0, income - reliefs);
        
        return {
            grossIncome: income,
            totalReliefs: reliefs,
            taxableIncome: taxableIncome,
            incomeTax: this.calculateTax(taxableIncome),
            nationalInsurance: this.calculateNationalInsurance(income),
            capitalGains: this.calculateCapitalGains(data.gains || 0, taxableIncome),
            timestamp: new Date().toISOString()
        };
    }

    validateTaxYear(date) {
        const taxYearEnd = new Date(this.taxYear.split('-')[1], 3, 5);
        return date <= taxYearEnd;
    }

    calculateTotalRelief(data) {
        return {
            business: this.calculateBusinessRelief(
                data.businessIncome, 
                data.expenses, 
                data.capitalAllowances
            ),
            property: this.calculatePropertyAllowance(
                data.propertyIncome, 
                data.propertyExpenses
            ),
            personal: this.taxRates.personalAllowance,
            total: function() {
                return this.business + this.property + this.personal;
            }
        };
    }

    generateFinalSummary(data) {
        try {
            const reliefs = this.calculateTotalRelief(data);
            const taxableIncome = Math.max(0, data.totalIncome - reliefs.total());
            
            return {
                taxYear: this.taxYear,
                income: data.totalIncome,
                reliefs: reliefs,
                taxableIncome: taxableIncome,
                tax: this.calculateTax(taxableIncome),
                nationalInsurance: this.calculateNationalInsurance(data.totalIncome),
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            throw new Error(`Tax calculation failed: ${error.message}`);
        }
    }

    async processReturn(data) {
        try {
            // Calculate tax
            const taxSummary = this.generateFinalSummary(data);
            
            // Store results
            const returnRef = await this.storeReturnData(taxSummary);
            
            // Generate forms
            const forms = await this.generateTaxForms(taxSummary);
            
            // Update status
            await this.updateReturnStatus(returnRef.id, {
                status: 'READY_FOR_REVIEW',
                forms: forms,
                lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            });

            return {
                returnId: returnRef.id,
                taxSummary,
                forms
            };
        } catch (error) {
            throw new Error(`Return processing failed: ${error.message}`);
        }
    }

    async generateTaxForms(taxSummary) {
        const taxReturnService = new TaxReturnService(this.taxYear);
        return taxReturnService.generateForms(taxSummary);
    }

    async processTaxReturn(data) {
        try {
            const allowances = this.calculateAllowances(data.income, data);
            const taxableIncome = Math.max(0, data.income - allowances);
            
            return {
                income: data.income,
                allowances,
                taxableIncome,
                tax: this.calculateTax(taxableIncome),
                ni: this.calculateNationalInsurance(data.income),
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            };
        } catch (error) {
            throw new Error(`Tax processing failed: ${error.message}`);
        }
    }

    async generateTaxReturn(data) {
        try {
            // 1. Calculate all allowances and reliefs
            const allowances = this.calculateAllowances(data.income, data);
            const reliefs = this.calculateReliefs(data);
            
            // 2. Calculate final tax position
            const taxableIncome = Math.max(0, data.income - allowances - reliefs);
            const taxDue = this.calculateTax(taxableIncome);
            
            // 3. Generate required forms
            const forms = await this.generateRequiredForms(data, {
                allowances,
                reliefs,
                taxableIncome,
                taxDue
            });

            // 4. Store results
            const returnRef = await this.storeReturnData({
                forms,
                calculations: {
                    income: data.income,
                    allowances,
                    reliefs,
                    taxableIncome,
                    taxDue
                },
                status: 'DRAFT',
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            return {
                returnId: returnRef.id,
                status: 'DRAFT',
                forms: forms.map(f => f.type)
            };
        } catch (error) {
            throw new Error(`Tax return generation failed: ${error.message}`);
        }
    }

    async storeReturnData(data) {
        return admin.firestore()
            .collection('tax_returns')
            .add({
                ...data,
                metadata: {
                    version: '1.0',
                    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
                    taxYear: this.taxYear
                }
            });
    }

    async generateRequiredForms(data, calculations) {
        const forms = [];
        
        // Main return - always required
        forms.push(await this.generateSA100(data, calculations));
        
        // Additional forms based on income types
        if (data.propertyIncome) {
            forms.push(await this.generateSA105(data, calculations));
        }
        if (data.selfEmployment) {
            forms.push(await this.generateSA103(data, calculations));
        }
        
        return forms;
    }
}

export { FormProcessor };