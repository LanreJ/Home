import { PlaidClient } from '../../functions/services/plaid/PlaidClient';
import { jest } from '@jest/globals';

describe('PlaidClient', () => {
    let client;
    
    beforeEach(() => {
        client = new PlaidClient();
        client.exchangeRates = {
            USD: 0.79,
            EUR: 0.86,
            GBP: 1.0
        };
        client.ratesLastUpdated = new Date().toISOString();
    });

    describe('Currency Conversion', () => {
        test('converts USD to GBP correctly', async () => {
            const result = await client.convertToGBP(100, 'USD');
            expect(result).toBe(79);
        });

        test('validates unsupported currency', async () => {
            await expect(client.convertToGBP(100, 'JPY'))
                .rejects
                .toThrow('Unsupported currency: JPY');
        });
    });

    describe('Exchange Rate Management', () => {
        test('refreshes rates after 24 hours', async () => {
            const oldDate = new Date();
            oldDate.setHours(oldDate.getHours() - 25);
            client.ratesLastUpdated = oldDate.toISOString();
            
            await client.refreshExchangeRates();
            expect(new Date(client.ratesLastUpdated)).toBeGreaterThan(oldDate);
        });

        test('calculates rate age correctly', () => {
            const oldDate = new Date();
            oldDate.setHours(oldDate.getHours() - 2);
            client.ratesLastUpdated = oldDate.toISOString();
            
            const age = client.calculateRateAge();
            expect(age).toBe(2);
        });

        test('validates currency support', async () => {
            const transactions = [
                { iso_currency_code: 'USD' },
                { iso_currency_code: 'GBP' },
                { iso_currency_code: 'EUR' }
            ];
            
            const result = await client.validateCurrencies(transactions);
            expect(result.supported).toBe(true);
            expect(result.currencies).toContain('USD');
            expect(result.currencies).toContain('GBP');
            expect(result.currencies).toContain('EUR');
        });
    });

    describe('Transaction Processing', () => {
        const mockTransactions = [
            {
                transaction_id: '1',
                amount: -2000,
                iso_currency_code: 'USD',
                category: ['Income', 'Salary'],
                date: '2024-01-01'
            },
            {
                transaction_id: '2',
                amount: 500,
                iso_currency_code: 'GBP',
                category: ['Business', 'Office Supplies'],
                date: '2024-01-02'
            }
        ];

        test('categorizes transactions correctly', async () => {
            const result = await client.categorizeTransactions(mockTransactions);
            expect(result.categorized.income.employment).toBeDefined();
            expect(result.categorized.expenses.business).toBeDefined();
            expect(result.metadata.transactionCount).toBe(2);
        });

        test('converts currencies in transactions', async () => {
            const result = await client.categorizeTransactions(mockTransactions);
            const usdSalary = mockTransactions[0].amount * client.exchangeRates.USD;
            expect(result.categorized.income.employment).toBe(Math.abs(usdSalary));
        });

        test('validates transaction date range', () => {
            const dateRange = {
                startDate: '2024-04-06',
                endDate: '2025-04-05'
            };
            const result = client.validateDateRange(dateRange);
            expect(result).toBe(true);
        });
    });

    describe('Tax Categories', () => {
        const mockTransactions = {
            income: {
                'salary': 50000,
                'freelance_income': 20000,
                'rental_income': 15000,
                'dividend_payment': 5000
            },
            expenses: {
                'office_supplies': 2000,
                'property_maintenance': 5000,
                'professional_fees': 3000
            }
        };

        test('maps income to tax categories correctly', () => {
            const result = client.mapToTaxCategories(mockTransactions.income);
            expect(result.employment).toBe(50000);
            expect(result.selfEmployment).toBe(20000);
            expect(result.property).toBe(15000);
            expect(result.investments).toBe(5000);
        });

        test('calculates tax implications correctly', () => {
            const data = {
                income: { selfEmployment: 90000 },
                summary: { totalIncome: 120000 }
            };
            const result = client.calculateTaxImplications(data);
            expect(result.vatRegistrationRequired).toBe(true);
            expect(result.requiresSelfAssessment).toBe(true);
            expect(result.highIncomeWarning).toBe(true);
        });

        test('validates tax year data completeness', () => {
            const data = {
                transactions: mockTransactions,
                metadata: {
                    dateRange: {
                        startDate: '2024-04-06',
                        endDate: '2025-04-05'
                    }
                }
            };
            const validation = client.validateTransactionData(data);
            expect(validation.isValid).toBe(true);
            expect(validation.checks.hasRequiredCategories).toBe(true);
        });
    });

    describe('Financial Summary', () => {
        const mockData = {
            income: {
                employment: 50000,
                selfEmployment: 30000,
                property: 20000,
                investments: 10000
            },
            expenses: {
                business: 25000,
                property: 15000,
                allowable: 5000,
                personal: 10000
            },
            metadata: {
                taxYear: '2024',
                dateRange: {
                    startDate: '2024-04-06',
                    endDate: '2025-04-05'
                },
                currencies: ['GBP', 'USD']
            }
        };

        test('generates accurate financial summary', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.income.total).toBe(110000);
            expect(summary.expenses.total).toBe(55000);
            expect(summary.netIncome).toBe(55000);
            expect(summary.taxableIncome).toBe(110000);
        });

        test('calculates tax category totals', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.taxCategories.employment).toBe(50000);
            expect(summary.taxCategories.selfEmployment).toBe(30000);
            expect(summary.taxCategories.property).toBe(20000);
        });

        test('generates appropriate warnings', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.warnings).toContain('High income: Additional reporting required');
            expect(summary.warnings).toContain('VAT registration may be required');
        });

        test('validates allowance calculations', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.allowances).toEqual({
                tradingAllowance: 1000,
                propertyAllowance: 1000,
                personalAllowance: 12570
            });
        });

        test('calculates tax thresholds correctly', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.taxImplications).toEqual({
                requiresVAT: true, // selfEmployment > 85000
                requiresSelfAssessment: true, // multiple income sources
                requiresPaymentsOnAccount: true, // tax liability > 1000
                tradingAllowanceEligible: false // income > 1000
            });
        });

        test('handles multiple currencies correctly', () => {
            const multiCurrencyData = {
                ...mockData,
                income: {
                    ...mockData.income,
                    employment: { amount: 63291.14, currency: 'USD' } // $80,000 USD
                }
            };
            
            const summary = client.generateFinancialSummary(multiCurrencyData);
            expect(summary.income.employment).toBe(50000); // £50,000 GBP at 0.79 rate
            expect(summary.metadata.currencies).toContain('USD');
        });

        test('validates tax thresholds', () => {
            const summary = client.generateFinancialSummary(mockData);
            expect(summary.thresholds).toEqual({
                vatThreshold: { exceeded: true, amount: 85000 },
                tradingAllowance: { eligible: false, reason: 'Income exceeds limit' },
                propertyAllowance: { eligible: false, reason: 'Income exceeds limit' },
                taxBands: {
                    basic: { exceeded: true, amount: 37700 },
                    higher: { exceeded: true, amount: 100000 }
                }
            });
        });

        test('categorizes expenses correctly', () => {
            const expenses = client.categorizeExpenses(mockData.expenses);
            expect(expenses).toEqual({
                allowableCosts: 30000,  // business + property
                capitalAllowances: 0,
                personalUse: 10000,
                propertyFinance: 15000
            });
        });

        test('tracks currency conversions', () => {
            const conversions = summary.metadata.currencyConversions;
            expect(conversions).toContainEqual({
                originalCurrency: 'USD',
                originalAmount: 63291.14,
                convertedAmount: 50000,
                exchangeRate: 0.79,
                source: 'HMRC'
            });
        });

        test('calculates warning severity', () => {
            const warnings = client.generateWarnings(mockData);
            expect(warnings.severity).toBe('HIGH');
            expect(warnings.requiresAction).toBe(true);
            expect(warnings.metadata.vatWarning).toBe(true);
        });
    });

    describe('Validation Rules', () => {
        test('validates tax year dates', () => {
            const validation = client.validateTaxYear({
                startDate: '2024-04-06',
                endDate: '2025-04-05'
            });
            expect(validation.isValid).toBe(true);
            expect(validation.taxYear).toBe('2024-25');
        });

        test('checks self-assessment requirements', () => {
            const validation = client.validateTaxRequirements({
                income: {
                    selfEmployment: 20000,
                    property: 15000,
                    total: 45000
                }
            });
            expect(validation.requiresSelfAssessment).toBe(true);
            expect(validation.reasons).toContain('Self-employment income over £1,000');
            expect(validation.reasons).toContain('Property income over £1,000');
        });

        test('validates expense thresholds', () => {
            const validation = client.validateExpenseThresholds({
                income: { total: 100000 },
                expenses: { total: 85000 }
            });
            expect(validation.warnings).toContain('High expense ratio');
            expect(validation.requiresDocumentation).toBe(true);
        });

        test('checks tax band thresholds', () => {
            const bands = client.calculateTaxBands({
                taxableIncome: 120000
            });
            expect(bands.basic.exceeded).toBe(true);
            expect(bands.higher.exceeded).toBe(true);
            expect(bands.additional.exceeded).toBe(false);
        });

        const testData = {
            income: {
                selfEmployment: 90000,
                property: 20000,
                total: 110000
            },
            expenses: {
                business: 45000,
                property: 10000,
                total: 55000
            },
            metadata: {
                currencies: ['GBP', 'USD'],
                exchangeRates: {
                    USD: 0.79,
                    GBP: 1.0
                }
            }
        };

        test('validates currency conversion rules', () => {
            const validation = client.validateCurrencyRules(testData);
            expect(validation).toEqual({
                isValid: true,
                supportedCurrencies: ['GBP', 'USD'],
                hasHMRCRates: true,
                ratesValidityPeriod: '24h'
            });
        });

        test('checks VAT registration threshold', () => {
            const validation = client.validateVATThreshold(testData);
            expect(validation).toEqual({
                requiresRegistration: true,
                threshold: 85000,
                exceededBy: 5000,
                registrationDeadline: expect.any(String)
            });
        });

        test('validates expense ratios', () => {
            const validation = client.validateExpenseRatios(testData);
            expect(validation).toEqual({
                ratio: 0.5,
                requiresEvidence: true,
                warningLevel: 'MEDIUM',
                recommendations: expect.arrayContaining([
                    'Maintain detailed records',
                    'Keep all receipts'
                ])
            });
        });
    });

    describe('Tax Threshold Validations', () => {
        const testData = {
            income: {
                selfEmployment: 90000,
                property: 20000,
                employment: 50000,
                total: 160000
            },
            expenses: {
                business: 45000,
                property: 10000,
                total: 55000
            },
            metadata: {
                taxYear: '2024',
                currencies: ['GBP']
            }
        };

        test('validates income tax thresholds', () => {
            const validation = client.validateIncomeTaxThresholds(testData);
            expect(validation).toEqual({
                bands: {
                    basic: { exceeded: true, limit: 37700 },
                    higher: { exceeded: true, limit: 125140 },
                    additional: { exceeded: false, limit: 125140 }
                },
                personalAllowance: {
                    entitled: false,
                    reason: 'Income exceeds £125,140',
                    tapered: true
                },
                warnings: expect.arrayContaining([
                    'Income exceeds higher rate threshold',
                    'Personal allowance fully tapered'
                ])
            });
        });

        test('validates National Insurance thresholds', () => {
            const validation = client.validateNIThresholds(testData.income);
            expect(validation).toEqual({
                selfEmployed: {
                    class2Required: true,
                    class4Required: true,
                    profits: 45000
                },
                warnings: expect.arrayContaining([
                    'Class 2 NICs due',
                    'Class 4 NICs applicable'
                ])
            });
        });
    });

    describe('Tax Calculations', () => {
        const taxData = {
            income: {
                employment: 45000,
                selfEmployment: {
                    income: 90000,
                    expenses: 40000,
                    netProfit: 50000
                },
                property: {
                    income: 24000,
                    expenses: 9200,
                    netProfit: 14800
                },
                investments: 5000
            },
            allowances: {
                personal: 12570,
                trading: 1000,
                property: 1000
            },
            taxYear: '2024'
        };

        test('calculates total taxable income correctly', () => {
            const result = client.calculateTotalTaxableIncome(taxData);
            expect(result).toEqual({
                grossIncome: 114800,
                allowableExpenses: 49200,
                taxableIncome: 65600,
                applicableAllowances: 12570,
                finalTaxableAmount: 53030,
                effectiveTaxRate: 0.23  // 23%
            });
        });

        test('applies tax bands correctly', () => {
            const result = client.calculateTaxLiability(taxData);
            expect(result).toEqual({
                basic: { amount: 37700, tax: 7540 },
                higher: { amount: 15330, tax: 6132 },
                total: 13672,
                paymentsDue: {
                    january: 6836,
                    july: 6836
                }
            });
        });
    });

    describe('Tax Calculations', () => {
        const taxData = {
            income: {
                employment: 45000,
                selfEmployment: {
                    income: 90000,
                    expenses: 40000,
                    netProfit: 50000
                },
                property: {
                    income: 24000,
                    expenses: 9200,
                    netProfit: 14800
                }
            },
            allowances: {
                personal: 12570,
                trading: 1000,
                property: 1000
            },
            taxYear: '2024'
        };

        test('calculates total taxable income', () => {
            const result = client.calculateTaxableIncome(taxData);
            expect(result).toEqual({
                totalIncome: 109800,
                allowances: 12570,
                taxableIncome: 97230,
                bands: {
                    basic: { amount: 37700, tax: 7540 },
                    higher: { amount: 59530, tax: 23812 },
                    additional: { amount: 0, tax: 0 }
                },
                totalTax: 31352
            });
        });

        test('applies correct tax rates', () => {
            const bands = client.calculateTaxBands(taxData);
            expect(bands).toEqual({
                basic: { rate: 0.20, from: 0, to: 37700 },
                higher: { rate: 0.40, from: 37701, to: 125140 },
                additional: { rate: 0.45, from: 125141, to: null }
            });
        });
    });

    describe('Tax Deductions and Payments', () => {
        const testData = {
            income: {
                selfEmployment: 90000,
                property: 20000,
                total: 110000
            },
            expenses: {
                business: {
                    office: 12000,
                    travel: 8000,
                    utilities: 6000,
                    homeUse: {
                        rooms: 1,
                        totalRooms: 4,
                        hoursPerWeek: 20
                    }
                },
                property: {
                    repairs: 5000,
                    insurance: 2000,
                    management: 3000
                }
            }
        };

        test('calculates allowable expenses', () => {
            const allowable = client.calculateAllowableExpenses(testData.expenses);
            expect(allowable).toEqual({
                business: {
                    total: 26000,
                    homeUse: 1500,  // Based on room and time calculation
                    categories: {
                        office: 12000,
                        travel: 8000,
                        utilities: 6000
                    }
                },
                property: {
                    total: 10000,
                    categories: {
                        repairs: 5000,
                        insurance: 2000,
                        management: 3000
                    }
                }
            });
        });

        test('calculates payments on account', () => {
            const payments = client.calculatePaymentsOnAccount({
                lastYearTax: 58203,
                currentYearEstimate: 60000
            });
            expect(payments).toEqual({
                firstPayment: 29101.50,
                secondPayment: 29101.50,
                dueDate1: '2025-01-31',
                dueDate2: '2025-07-31',
                balancingPayment: 1797
            });
        });
    });

    describe('Business Expenses', () => {
        const businessData = {
            expenses: {
                fixed: {
                    rent: 12000,
                    insurance: 2400,
                    utilities: 3600
                },
                variable: {
                    supplies: 5000,
                    travel: 3000
                },
                homeOffice: {
                    rooms: 1,
                    totalRooms: 4,
                    daysUsed: 240,
                    costs: {
                        mortgage: 12000,
                        utilities: 2400,
                        maintenance: 1200
                    }
                },
                vehicle: {
                    businessMiles: 12000,
                    totalMiles: 15000,
                    expenses: {
                        fuel: 3000,
                        insurance: 800,
                        maintenance: 1200
                    }
                }
            }
        };

        test('calculates total allowable expenses', () => {
            const result = client.calculateAllowableExpenses(businessData);
            expect(result).toEqual({
                fixed: 18000,
                variable: 8000,
                homeOffice: 3900,  // (15600 / 4) * (240/365)
                vehicle: 4000,     // (5000 * 0.8)
                total: 33900
            });
        });

        test('validates expense categories', () => {
            const validation = client.validateExpenseCategories(businessData);
            expect(validation.isValid).toBe(true);
            expect(validation.categories).toEqual({
                fixed: { valid: true, total: 18000 },
                variable: { valid: true, total: 8000 },
                homeOffice: { valid: true, total: 3900 },
                vehicle: { valid: true, total: 4000 }
            });
        });
    });

    describe('Property Income Calculations', () => {
        const propertyData = {
            income: {
                rental: 24000,
                serviceCharges: 1200
            },
            expenses: {
                mortgage: {
                    interest: 6000,
                    restrictions: 0.25
                },
                maintenance: 3000,
                insurance: 800,
                services: {
                    management: 2400,
                    cleaning: 1200,
                    utilities: 1800
                }
            },
            metadata: {
                propertyType: 'residential',
                furnished: true,
                mortgaged: true
            }
        };

        test('calculates net property income', () => {
            const result = client.calculatePropertyIncome(propertyData);
            expect(result).toEqual({
                income: {
                    total: 25200,
                    allowableExpenses: 9200,
                    restrictedFinanceCosts: 4500,
                    netIncome: 11500
                },
                validation: {
                    isValid: true,
                    requiresReporting: true,
                    warnings: expect.arrayContaining([
                        'Finance cost restriction applies'
                    ])
                }
            });
        });

        test('validates expense ratios', () => {
            const validation = client.validatePropertyExpenses(propertyData);
            expect(validation).toEqual({
                ratio: 0.365,  // 9200/25200
                isReasonable: true,
                requiresEvidence: false,
                categories: {
                    maintenance: { ratio: 0.119, isReasonable: true },
                    services: { ratio: 0.214, isReasonable: true }
                }
            });
        });
    });

    describe('Tax Calculations', () => {
        const taxData = {
            income: {
                employment: 45000,
                selfEmployment: {
                    income: 90000,
                    expenses: 40000,
                    netProfit: 50000
                },
                property: {
                    income: 24000,
                    expenses: 9200,
                    netProfit: 14800
                }
            },
            allowances: {
                personal: 12570,
                trading: 1000,
                property: 1000
            },
            taxYear: '2024'
        };

        test('calculates total taxable income', () => {
            const result = client.calculateTaxableIncome(taxData);
            expect(result).toEqual({
                totalIncome: 109800,
                allowances: 12570,
                taxableIncome: 97230,
                bands: {
                    basic: { amount: 37700, tax: 7540 },
                    higher: { amount: 59530, tax: 23812 },
                    additional: { amount: 0, tax: 0 }
                },
                totalTax: 31352
            });
        });

        test('applies correct tax rates', () => {
            const bands = client.calculateTaxBands(taxData);
            expect(bands).toEqual({
                basic: { rate: 0.20, from: 0, to: 37700 },
                higher: { rate: 0.40, from: 37701, to: 125140 },
                additional: { rate: 0.45, from: 125141, to: null }
            });
        });
    });

    describe('Business Expense Calculations', () => {
        const expenseData = {
            home: {
                totalCosts: {
                    mortgage: 24000,
                    utilities: 4800,
                    insurance: 1200,
                    repairs: 2000
                },
                usage: {
                    rooms: 1,
                    totalRooms: 4,
                    hoursPerWeek: 20,
                    weeksUsed: 48
                }
            },
            vehicle: {
                costs: {
                    fuel: 3600,
                    insurance: 1200,
                    maintenance: 800,
                    roadTax: 155
                },
                usage: {
                    businessMiles: 8000,
                    totalMiles: 12000,
                    isMainPurpose: true
                }
            }
        };

        test('calculates home office expenses', () => {
            const result = client.calculateHomeOfficeExpenses(expenseData.home);
            expect(result).toEqual({
                annualCost: 8000,        // Total costs
                roomRatio: 0.25,         // 1/4 rooms
                timeRatio: 0.238,        // 20hrs/84hrs
                allowableAmount: 1904,    // 8000 * 0.25 * 0.238
                metadata: {
                    calculationMethod: 'actual',
                    isReasonable: true,
                    requiresEvidence: true
                }
            });
        });

        test('calculates vehicle expenses', () => {
            const result = client.calculateVehicleExpenses(expenseData.vehicle);
            expect(result).toEqual({
                totalCosts: 5755,
                mileageRatio: 0.667,     // 8000/12000
                allowableAmount: 3833,    // 5755 * 0.667
                simplified: 4000,         // 8000 * 0.50 (simplified rate)
                recommended: 'simplified',
                metadata: {
                    method: 'mileage',
                    rate: 0.50,
                    requiresLogbook: true
                }
            });
        });
    });

    describe('Business Expense Categorization', () => {
        const expenseData = {
            direct: {
                materials: 12000,
                subcontractors: 8000,
                supplies: 3000
            },
            indirect: {
                insurance: 2400,
                utilities: 1800,
                professional: 3600
            },
            capital: {
                equipment: { cost: 15000, date: '2024-01-15' },
                computers: { cost: 3000, date: '2024-02-01' },
                furniture: { cost: 2000, date: '2024-03-10' }
            },
            mixedUse: {
                phone: { cost: 1200, businessUse: 0.8 },
                internet: { cost: 600, businessUse: 0.9 },
                software: { cost: 1800, businessUse: 1.0 }
            }
        };

        test('calculates allowable expenses correctly', () => {
            const result = client.calculateAllowableExpenses(expenseData);
            expect(result).toEqual({
                allowable: {
                    direct: 23000,
                    indirect: 7800,
                    capital: {
                        annualInvestment: 20000,
                        writingDown: 0,
                        total: 20000
                    },
                    mixedUse: 3240
                },
                total: 54040,
                validation: {
                    isValid: true,
                    requiresEvidence: true,
                    warnings: []
                }
            });
        });

        test('validates expense thresholds', () => {
            const validation = client.validateExpenseThresholds(expenseData);
            expect(validation).toEqual({
                thresholds: {
                    annualInvestment: { exceeded: false, limit: 1000000 },
                    writingDown: { exceeded: false, limit: 18000 },
                    mixedUse: { reasonable: true }
                },
                status: 'VALID',
                requiresAttention: false
            });
        });
    });

    describe('Capital Allowances', () => {
        const capitalData = {
            assets: {
                new: [
                    { type: 'equipment', cost: 25000, date: '2024-05-15' },
                    { type: 'computer', cost: 2000, date: '2024-06-01' },
                    { type: 'vehicle', cost: 35000, date: '2024-07-10', co2: 95 }
                ],
                existing: [
                    { type: 'machinery', cost: 40000, writtenDown: 30000 },
                    { type: 'fixtures', cost: 15000, writtenDown: 11250 }
                ],
                disposals: [
                    { type: 'equipment', cost: 12000, proceeds: 8000, date: '2024-09-15' }
                ]
            },
            pooling: {
                main: { brought: 41250 },
                special: { brought: 0 }
            }
        };

        test('calculates annual investment allowance', () => {
            const result = client.calculateAnnualInvestmentAllowance(capitalData);
            expect(result).toEqual({
                qualifying: 27000,    // equipment + computer
                claimed: 27000,
                remaining: 973000,    // 1000000 - 27000
                validation: {
                    withinLimit: true,
                    requiresPooling: false
                }
            });
        });

        test('calculates writing down allowances', () => {
            const result = client.calculateWritingDownAllowances(capitalData);
            expect(result).toEqual({
                mainPool: {
                    brought: 41250,
                    additions: 35000,    // vehicle
                    disposals: 12000,
                    allowance: 16062.50  // (41250 + 35000 - 12000) * 0.25
                },
                specialPool: {
                    additions: 0,
                    allowance: 0
                }
            });
        });

        test('processes capital allowances correctly', () => {
            const result = client.calculateCapitalAllowances(capitalData);
            expect(result).toEqual({
                aia: {
                    claimed: 27000,            // equipment + computer
                    remaining: 973000
                },
                wda: {
                    mainPool: 16062.50,        // (41250 + 35000 - 12000) * 0.25
                    specialPool: 0
                },
                balancing: {
                    charges: 0,
                    allowances: 0
                },
                total: 43062.50,
                validation: {
                    isValid: true,
                    requiresAttention: false
                }
            });
        });

        test('calculates disposal effects', () => {
            const disposalData = {
                asset: { 
                    type: 'machinery',
                    cost: 40000,
                    writtenDown: 30000,
                    proceeds: 35000,
                    date: '2024-09-15'
                },
                poolBalance: 41250
            };

            const result = client.calculateDisposalEffects(disposalData);
            expect(result).toEqual({
                disposal: {
                    proceeds: 35000,
                    writtenDownValue: 30000,
                    balancingCharge: 5000,    // proceeds > written down
                    poolAdjustment: -35000    // remove from pool
                },
                timing: {
                    taxYear: '2024-25',
                    monthsHeld: 5,
                    disposalDate: '2024-09-15'
                },
                validation: {
                    isValid: true,
                    requiresNotification: true,
                    notes: ['Balancing charge payable']
                }
            });
        });

        test('handles special rate pool assets', () => {
            const specialAsset = {
                type: 'integral_features',
                cost: 50000,
                date: '2024-04-10'
            };

            const result = client.calculateSpecialRateAllowance(specialAsset);
            expect(result).toEqual({
                allowance: 3000,            // 50000 * 0.06
                poolAddition: 50000,
                timing: {
                    taxYear: '2024-25',
                    fullYear: true
                }
            });
        });
    });

    describe('Capital Allowances Advanced', () => {
        const advancedCapitalData = {
            mixedUse: {
                vehicle: {
                    cost: 45000,
                    businessUse: 0.8,
                    co2: 120,
                    date: '2024-06-15'
                }
            },
            partYear: {
                equipment: {
                    cost: 30000,
                    date: '2024-11-20',
                    daysInUse: 132
                }
            },
            thresholds: {
                aiaRemaining: 800000,
                mainPoolBalance: 150000,
                specialPoolBalance: 75000
            }
        };

        test('calculates mixed use asset allowances', () => {
            const result = client.calculateMixedUseAllowances(advancedCapitalData.mixedUse);
            expect(result).toEqual({
                qualifying: 36000,         // 45000 * 0.8
                specialRate: true,         // CO2 > 110g/km
                allowance: 2160,          // 36000 * 0.06
                restriction: 'emissions',
                validation: {
                    isValid: true,
                    notes: ['Requires mileage log']
                }
            });
        });

        test('handles part year calculations', () => {
            const result = client.calculatePartYearAllowance(advancedCapitalData.partYear);
            expect(result).toEqual({
                fullAmount: 30000,
                daysApportioned: 132,
                adjustedAmount: 10849,    // (30000 * 132/365)
                timing: {
                    taxYear: '2024-25',
                    apportioned: true
                }
            });
        });
    });

    describe('Capital Allowances Complete Suite', () => {
        const testData = {
            assets: {
                mainPool: [
                    { type: 'machinery', cost: 50000, date: '2024-05-01', businessUse: 1.0 },
                    { type: 'vehicle', cost: 35000, date: '2024-06-15', businessUse: 0.8, co2: 95 }
                ],
                specialPool: [
                    { type: 'integral', cost: 25000, date: '2024-04-10', businessUse: 1.0 },
                    { type: 'highEmission', cost: 40000, date: '2024-07-01', businessUse: 0.9, co2: 120 }
                ],
                disposals: [
                    { type: 'machinery', cost: 30000, proceeds: 25000, date: '2024-09-15', poolValue: 22500 }
                ],
                broughtForward: {
                    mainPool: 75000,
                    specialPool: 45000
                }
            }
        };

        test('processes complete capital allowances calculation', () => {
            const result = client.calculateAllCapitalAllowances(testData);
            expect(result).toEqual({
                mainPool: {
                    additions: 78000,      // 50000 + (35000 * 0.8)
                    disposals: 25000,
                    writtenDown: 32000,    // (75000 + 78000 - 25000) * 0.25
                    carryForward: 96000
                },
                specialPool: {
                    additions: 61000,      // 25000 + (40000 * 0.9)
                    writtenDown: 6360,     // (45000 + 61000) * 0.06
                    carryForward: 99640
                },
                balancing: {
                    charge: 2500,          // 25000 - 22500
                    allowance: 0
                },
                total: 35860,
                validation: {
                    isValid: true,
                    requiresEvidence: true,
                    notes: ['Vehicle log required', 'CO2 restrictions apply']
                }
            });
        });
    });

    describe('Capital Allowances Timing', () => {
        const timingData = {
            assets: {
                fullYear: {
                    type: 'machinery',
                    cost: 50000,
                    date: '2024-04-10'
                },
                partYear: {
                    type: 'equipment',
                    cost: 30000,
                    date: '2024-11-15'
                },
                transitional: {
                    type: 'vehicle',
                    cost: 35000,
                    date: '2025-03-25',
                    straddling: true
                }
            },
            taxYear: '2024-25',
            yearEnd: '2025-04-05'
        };

        test('calculates allowances with timing rules', () => {
            const result = client.calculateTimingAllowances(timingData);
            expect(result).toEqual({
                fullYear: {
                    cost: 50000,
                    allowance: 12500,     // 25% WDA
                    timing: 'full-year'
                },
                partYear: {
                    cost: 30000,
                    daysInUse: 142,       // Until year end
                    allowance: 2918,      // (30000 * 142/365) * 0.25
                    timing: 'part-year'
                },
                transitional: {
                    cost: 35000,
                    daysInYear: 12,       // Days until year end
                    allowance: 287,       // (35000 * 12/365) * 0.25
                    carryForward: 34713,  // Remaining for next year
                    timing: 'straddling'
                },
                validation: {
                    isValid: true,
                    requiresApportionment: true
                }
            });
        });
    });

    describe('Capital Allowances Year End', () => {
        const yearEndData = {
            assets: {
                standard: [
                    { type: 'machinery', cost: 50000, date: '2024-04-10', businessUse: 1.0 },
                    { type: 'equipment', cost: 30000, date: '2025-03-25', businessUse: 0.9 }
                ],
                special: [
                    { type: 'integral', cost: 25000, date: '2024-12-15', businessUse: 1.0 },
                    { type: 'vehicle', cost: 40000, date: '2025-02-01', businessUse: 0.8, co2: 115 }
                ]
            },
            timing: {
                taxYear: '2024-25',
                yearEnd: '2025-04-05'
            }
        };

        test('calculates year end allowances', () => {
            const result = client.calculateYearEndAllowances(yearEndData);
            expect(result).toEqual({
                fullYear: {
                    standard: 50000,
                    special: 25000
                },
                partYear: {
                    standard: 27000,    // 30000 * 0.9
                    special: 32000     // 40000 * 0.8
                },
                allowances: {
                    mainPool: 25750,   // (50000 + 27000) * 0.25
                    specialPool: 3420  // (25000 + 32000) * 0.06
                },
                timing: {
                    isComplete: true,
                    transitional: false
                }
            });
        });
    });

    describe('Capital Allowances Calculations', () => {
        const yearEndData = {
            ...existing code...
                    allowances: {
                        mainPool: 25750,   // (50000 + 27000) * 0.25
                        specialPool: 3420,  // (25000 + 32000) * 0.06
                        timing: {
                            standard: { fullYear: true },
                            special: { partYear: true, daysRemaining: 64 }
                        }
                    },
                    validation: {
                        requiresEvidence: true,
                        warnings: ['Vehicle CO2 emissions exceed threshold'],
                        timing: 'valid'
                    }
                });
            });

            test('handles transitional periods', () => {
                const transitionalData = {
                    assets: {
                        type: 'machinery',
                        cost: 60000,
                        purchaseDate: '2025-03-15',
                        disposalDate: '2025-05-20',
                        taxYearEnd: '2025-04-05'
                    },
                    timing: {
                        taxYear: '2024-25',
                        basis: 'accruals'
                    }
                };

                const result = client.calculateTransitionalAllowances(transitionalData);
                expect(result).toEqual({
                    currentYear: {
                        days: 22,
                        amount: 3616.44,    // (60000 * 22/365)
                        allowance: 904.11   // 3616.44 * 0.25
                    },
                    nextYear: {
                        days: 45,
                        amount: 7397.26,    // (60000 * 45/365)
                        allowance: 1849.32  // 7397.26 * 0.25
                    },
                    pooling: {
                        mainPool: true,
                        written: 48986.30   // Remaining amount
                    },
                    validation: {
                        isValid: true,
                        requiresApportionment: true,
                        notes: ['Split tax year calculation']
                    }
                });
            });
    });

    describe('Capital Allowances Integration', () => {
        const integrationData = {
            plaidTransactions: [
                { 
                    amount: 60000,
                    date: '2024-05-15',
                    category: 'business_equipment',
                    description: 'Manufacturing machinery'
                },
                {
                    amount: 35000,
                    date: '2024-12-10',
                    category: 'vehicle',
                    description: 'Company van',
                    metadata: { co2: 95 }
                }
            ],
            existingPools: {
                main: 75000,
                special: 45000
            },
            taxYear: '2024-25'
        };

        test('processes capital allowances from Plaid data', () => {
            const result = client.processPlaidCapitalAllowances(integrationData);
            expect(result).toEqual({
                identified: {
                    mainPool: [
                        { cost: 60000, type: 'machinery', date: '2024-05-15' },
                        { cost: 35000, type: 'vehicle', date: '2024-12-10', co2: 95 }
                    ]
                },
                allowances: {
                    aia: 95000,
                    mainPool: {
                        brought: 75000,
                        additions: 95000,
                        writtenDown: 42500
                    },
                    validation: {
                        isValid: true,
                        hmrcCompliant: true,
                        requiresEvidence: ['Vehicle log', 'Purchase invoices']
                    }
                }
            });
        });
    });

    describe('Tax Return Integration', () => {
        const testData = {
            documents: {
                p60: { type: 'P60', amount: 45000, tax: 9000 },
                propertyIncome: { type: 'PropertyStatement', amount: 24000, expenses: 8000 },
                selfEmployment: { type: 'SelfEmployment', income: 35000, expenses: 12000 }
            },
            bankData: {
                transactions: [
                    { type: 'salary', amount: -3750, date: '2024-05-01' },
                    { type: 'rental_income', amount: -2000, date: '2024-05-05' },
                    { type: 'business_expense', amount: 500, date: '2024-05-10' }
                ]
            },
            taxYear: '2024-25'
        };

        test('processes tax return data', () => {
            const result = client.processTaxReturn(testData);
            expect(result).toEqual({
                income: {
                    employment: 45000,
                    property: 24000,
                    selfEmployment: 35000,
                    total: 104000
                },
                expenses: {
                    property: 8000,
                    selfEmployment: 12000,
                    total: 20000
                },
                tax: {
                    liability: 23450,
                    paid: 9000,
                    due: 14450
                },
                validation: {
                    isComplete: true,
                    requiresSupplementary: true,
                    warnings: ['High income: Additional rate applicable']
                }
            });
        });
    });

    describe('Capital Allowances Test Suite', () => {
        let client;
        
        beforeEach(() => {
            client = new PlaidClient();
            client.exchangeRates = {
                USD: 0.79,
                EUR: 0.86,
                GBP: 1.0
            };
            client.ratesLastUpdated = new Date().toISOString();
        });

        describe('Allowance Calculations', () => {
            const testData = {
                assets: {
                    standard: [
                        { type: 'machinery', cost: 50000, date: '2024-04-10', businessUse: 1.0 },
                        { type: 'equipment', cost: 30000, date: '2024-11-15', businessUse: 0.9 }
                    ],
                    special: [
                        { type: 'integral', cost: 25000, date: '2024-12-15', businessUse: 1.0 },
                        { type: 'vehicle', cost: 40000, date: '2025-02-01', businessUse: 0.8, co2: 115 }
                    ]
                },
                timing: {
                    taxYear: '2024-25',
                    yearEnd: '2025-04-05'
                }
            };

            test('calculates standard allowances', () => {
                const result = client.calculateAllowances(testData);
                expect(result).toBeDefined();
                expect(result.mainPool).toBeDefined();
                expect(result.specialPool).toBeDefined();
            });
        });
    });
});