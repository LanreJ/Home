import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

class PlaidClient {
    constructor() {
        const configuration = new Configuration({
            basePath: PlaidEnvironments.sandbox,
            baseOptions: {
                headers: {
                    'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
                    'PLAID-SECRET': process.env.PLAID_SANDBOX_API_KEY,
                },
            },
        });

        this.client = new PlaidApi(configuration);
        this.processStartTime = null;
        this.exchangeRates = null;
    }

    async initializeExchangeRates() {
        try {
            const response = await fetch('https://api.hmrc.gov.uk/exchange-rates', {
                headers: {
                    'Accept': 'application/json',
                    'Authorization': `Bearer ${process.env.HMRC_API_TOKEN}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HMRC API error: ${response.statusText}`);
            }

            const data = await response.json();
            this.exchangeRates = {
                USD: data.rates.usd || 0.79,
                EUR: data.rates.eur || 0.86,
                GBP: 1.0
            };
            this.ratesLastUpdated = new Date().toISOString();
        } catch (error) {
            console.warn('Failed to fetch HMRC rates, using defaults:', error);
            this.exchangeRates = {
                USD: 0.79,
                EUR: 0.86,
                GBP: 1.0
            };
        }
    }

    async createLinkToken(userId) {
        try {
            const request = {
                user: { client_user_id: userId },
                client_name: 'Tax Return Helper',
                products: ['transactions'],
                country_codes: ['GB'],
                language: 'en',
                webhook: process.env.PLAID_WEBHOOK_URL
            };

            const response = await this.client.linkTokenCreate(request);
            return {
                linkToken: response.data.link_token,
                expiration: response.data.expiration,
                metadata: {
                    createdAt: new Date().toISOString(),
                    userId,
                    status: 'INITIALIZED'
                }
            };
        } catch (error) {
            throw new Error(`Failed to create link token: ${error.message}`);
        }
    }

    async getTransactions(accessToken, startDate, endDate) {
        const request = {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate
        };

        const response = await this.client.transactionsGet(request);
        return this.processTransactions(response.data);
    }

    async exchangePublicToken(publicToken) {
        try {
            const response = await this.client.itemPublicTokenExchange({
                public_token: publicToken
            });
            
            const accessToken = response.data.access_token;
            const validation = await this.validateAccessToken(accessToken);
            
            return {
                accessToken,
                itemId: response.data.item_id,
                metadata: {
                    exchangedAt: new Date().toISOString(),
                    status: validation.isValid ? 'ACTIVE' : 'INVALID',
                    validation,
                    processing: {
                        startTime: new Date().toISOString(),
                        status: 'READY'
                    }
                }
            };
        } catch (error) {
            throw new Error(`Token exchange failed: ${error.message}`);
        }
    }

    async validateAccessToken(accessToken) {
        try {
            await this.client.accountsGet({
                access_token: accessToken
            });
            return {
                isValid: true,
                tokenType: 'ACCESS_TOKEN',
                validatedAt: new Date().toISOString()
            };
        } catch (error) {
            return {
                isValid: false,
                tokenType: 'ACCESS_TOKEN',
                error: error.message,
                validatedAt: new Date().toISOString()
            };
        }
    }

    async fetchTransactions(accessToken, startDate, endDate) {
        const request = {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate,
            options: {
                include_personal_finance_category: true,
                include_original_description: true
            }
        };

        let allTransactions = [];
        let hasMore = true;
        let cursor = null;
        let batchCount = 0;

        while (hasMore) {
            const response = await this.client.transactionsSync({
                ...request,
                cursor
            });
            
            allTransactions = [...allTransactions, ...response.data.added];
            hasMore = response.data.has_more;
            cursor = response.data.next_cursor;
            batchCount++;
        }

        return {
            transactions: allTransactions,
            metadata: {
                count: allTransactions.length,
                batchCount,
                dateRange: { startDate, endDate },
                processedAt: new Date().toISOString(),
                status: 'COMPLETED'
            }
        };
    }

    async fetchAllTransactions(accessToken, startDate, endDate) {
        const request = {
            access_token: accessToken,
            start_date: startDate,
            end_date: endDate,
            options: {
                include_personal_finance_category: true,
                include_original_description: true
            }
        };

        let allTransactions = [];
        let hasMore = true;
        let cursor = null;
        let batchCount = 0;

        while (hasMore) {
            try {
                const response = await this.client.transactionsSync({
                    ...request,
                    cursor
                });
                
                allTransactions = [...allTransactions, ...response.data.added];
                hasMore = response.data.has_more;
                cursor = response.data.next_cursor;
                batchCount++;
            } catch (error) {
                throw new Error(`Failed to fetch transactions batch: ${error.message}`);
            }
        }

        return {
            transactions: allTransactions,
            metadata: {
                count: allTransactions.length,
                batchCount,
                dateRange: { startDate, endDate },
                processedAt: new Date().toISOString(),
                status: 'COMPLETED',
                validation: {
                    hasTransactions: allTransactions.length > 0,
                    dateRangeValid: this.validateDateRange(startDate, endDate)
                }
            }
        };
    }

    async getAccountBalances(accessToken) {
        try {
            const response = await this.client.accountsBalanceGet({
                access_token: accessToken
            });

            if (!this.exchangeRates) {
                await this.initializeExchangeRates();
            }

            const accounts = response.data.accounts.map(account => ({
                accountId: account.account_id,
                name: account.name,
                type: account.type,
                subtype: account.subtype,
                balance: {
                    original: {
                        amount: account.balances.current,
                        currency: account.balances.iso_currency_code || 'GBP'
                    },
                    gbp: {
                        amount: this.convertToGBP(
                            account.balances.current,
                            account.balances.iso_currency_code || 'GBP'
                        ),
                        exchangeRate: this.exchangeRates[account.balances.iso_currency_code || 'GBP']
                    },
                    available: account.balances.available,
                    limit: account.balances.limit
                },
                mask: account.mask,
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    institution: response.data.item.institution_id,
                    status: account.balances.current !== null ? 'ACTIVE' : 'INACTIVE',
                    exchangeRateTimestamp: this.ratesLastUpdated
                }
            }));

            return {
                accounts,
                summary: this.generateAccountSummary(accounts),
                metadata: {
                    fetchedAt: new Date().toISOString(),
                    totalAccounts: accounts.length,
                    currencies: [...new Set(accounts.map(a => a.balance.original.currency))],
                    status: 'COMPLETED'
                }
            };
        } catch (error) {
            throw new Error(`Failed to fetch account balances: ${error.message}`);
        }
    }

    async getAccountDetails(accessToken) {
        const response = await this.client.accountsGet({
            access_token: accessToken
        });
        return response.data.accounts;
    }

    processTransactions(transactions) {
        return {
            income: this.categorizeIncome(transactions),
            expenses: this.categorizeExpenses(transactions),
            summary: this.generateTransactionSummary(transactions),
            metadata: {
                transactionCount: transactions.length,
                dateRange: this.getTransactionDateRange(transactions)
            }
        };
    }

    categorizeIncome(transactions) {
        const incomeCategories = {
            salary:8 ['salary', 'payroll', 'wages'],
            selfEmployment: ['freelance', 'contractor', 'consulting', 'business income'],
            property: ['rent', 'rental income', 'lease'],
            investments: ['dividend', 'interest', 'investment income']
        };

        const income = transactions.reduce((acc, transaction) => {
            if (transaction.amount < 0) { // Plaid uses negative for credits
                const amount = Math.abs(transaction.amount);
                for (const [category, keywords] of Object.entries(incomeCategories)) {
                    if (this.matchesCategory(transaction, keywords)) {
                        acc[category] = (acc[category] || 0) + amount;
                        break;
                    }
                }
            }
            return acc;
        }, {});

        return {
            ...income,
            total: Object.values(income).reduce((a, b) => a + b, 0),
            categorized: Object.keys(income).length > 0
        };
    }

    matchesCategory(transaction, keywords) {
        const searchText = [
            transaction.name,
            transaction.original_description,
            ...(transaction.category || []) 
        ].join(' ').toLowerCase();

        return keywords.some(keyword => searchText.includes(keyword));
    }

    categorizeExpenses(transactions) {
        const expenseCategories = {
            propertyExpenses: ['mortgage', 'repairs', 'maintenance'],
            tradingExpenses: ['office', 'equipment', 'supplies'],
            allowableExpenses: ['insurance', 'utilities', 'professional']
        };

        return transactions.reduce((acc, transaction) => {
            if (transaction.amount > 0) {
                const category = this.determineExpenseCategory(
                    transaction.category, 
                    expenseCategories
                );
                
                if (category) {
                    acc[category] = (acc[category] || 0) + transaction.amount;
                }
            }
            return acc;
        }, {});
    }

    determineIncomeCategory(transactionCategory, categories) {
        for (const [category, keywords] of Object.entries(categories)) {
            if (keywords.some(keyword => 
                transactionCategory.some(cat => 
                    cat.toLowerCase().includes(keyword)
                ))) {
                return category;
            }
        }
        return null;
    }

    categorizeAndSummarizeTransactions(transactions) {
        const income = this.categorizeIncome(transactions);
        const expenses = this.categorizeExpenses(transactions);
        
        return {
            income: {
                employment: income.salary || 0,
                selfEmployment: income.selfEmployment || 0,
                property: income.property || 0,
                investments: income.investments || 0,
                other: income.other || 0,
                total: Object.values(income).reduce((a, b) => a + b, 0)
            },
            expenses: {
                business: expenses.business || 0,
                property: expenses.property || 0,
                allowable: expenses.allowable || 0,
                personal: expenses.personal || 0,
                total: Object.values(expenses).reduce((a, b) => a + b, 0)
            },
            metadata: {
                processedAt: new Date().toISOString(),
                transactionCount: transactions.length,
                categorizedCount: transactions.filter(t => t.category).length,
                dateRange: this.getTransactionDateRange(transactions),
                validation: {
                    hasEmploymentIncome: income.salary > 0,
                    hasSelfEmployment: income.selfEmployment > 0,
                    hasPropertyIncome: income.property > 0,
                    hasInvestments: income.investments > 0,
                    hasBusinessExpenses: expenses.business > 0
                },
                summary: {
                    totalTransactions: transactions.length,
                    incomeTransactions: transactions.filter(t => t.amount < 0).length,
                    expenseTransactions: transactions.filter(t => t.amount > 0).length,
                    uncategorized: transactions.filter(t => !t.category).length
                }
            }
        };
    }

    getTransactionDateRange(transactions) {
        if (!transactions.length) return null;
        
        const dates = transactions.map(t => new Date(t.date));
        return {
            start: new Date(Math.min(...dates)).toISOString().split('T')[0],
            end: new Date(Math.max(...dates)).toISOString().split('T')[0]
        };
    }

    async processTransactionData(accessToken, taxYear) {
        try {
            const startDate = `${taxYear}-04-06`;
            const endDate = `${parseInt(taxYear) + 1}-04-05`;

            const [transactions, accounts] = await Promise.all([
                this.fetchAllTransactions(accessToken, startDate, endDate),
                this.getAccountBalances(accessToken)
            ]);

            const categorized = this.categorizeAndSummarizeTransactions(transactions.transactions);
            
            return {
                data: {
                    transactions: categorized,
                    accounts
                },
                summary: this.generateFinancialSummary(categorized),
                metadata: {
                    taxYear,
                    processedAt: new Date().toISOString(),
                    status: 'PROCESSED',
                    transactionCount: transactions.transactions.length,
                    accountCount: accounts.length
                }
            };
        } catch (error) {
            throw new Error(`Transaction processing failed: ${error.message}`);
        }
    }

    async processFinancialData(accessToken, taxYear) {
        try {
            const startDate = `${taxYear}-04-06`;
            const endDate = `${parseInt(taxYear) + 1}-04-05`;
            
            const [transactions, accounts] = await Promise.all([
                this.fetchAllTransactions(accessToken, startDate, endDate),
                this.getAccountBalances(accessToken)
            ]);

            const processed = await this.validateAndProcessData({
                transactions: transactions.transactions,
                accounts,
                metadata: {
                    taxYear,
                    dateRange: { startDate, endDate }
                }
            });

            return {
                data: processed,
                summary: this.generateFinancialSummary(processed),
                validation: this.validateFinancialData(processed),
                status: this.determineProcessingStatus(processed.validation),
                metadata: {
                    processedAt: new Date().toISOString(),
                    accountCount: accounts.length,
                    transactionCount: transactions.transactions.length,
                    version: '1.0'
                }
            };
        } catch (error) {
            throw new Error(`Financial data processing failed: ${error.message}`);
        }
    }

    generateFinancialSummary(processed) {
        return {
            income: this.calculateTotalIncome(processed),
            expenses: this.calculateTotalExpenses(processed),
            taxable: this.calculateTaxableAmount(processed),
            yearToDate: {
                income: processed.data.income.total,
                expenses: processed.data.expenses.total,
                net: processed.data.income.total - processed.data.expenses.total
            }
        };
    }

    async validateFinancialData(data) {
        const validation = {
            isValid: true,
            checks: {
                hasTransactions: data.transactions.length > 0,
                hasIncome: data.income.total > 0,
                hasValidDateRange: this.validateDateRange(data.metadata.dateRange),
                hasRequiredCategories: this.checkRequiredCategories(data),
                hasSufficientData: data.transactions.length >= 10
            },
            warnings: this.generateWarnings(data),
            taxImplications: {
                requiresSelfAssessment: data.income.selfEmployment > 1000,
                vatRegistrationRequired: data.income.selfEmployment > 85000,
                highIncomeWarning: data.income.total > 100000,
                expenseRatioWarning: (data.expenses.total / data.income.total) > 0.8
            },
            metadata: {
                processedAt: new Date().toISOString(),
                status: 'VALIDATING',
                warningCount: 0,
                severity: 'NONE',
                lastUpdated: new Date().toISOString()
            }
        };

        validation.metadata.warningCount = validation.warnings.length;
        validation.metadata.severity = this.calculateWarningSeverity(validation.warnings);
        validation.metadata.status = validation.isValid ? 'VALIDATED' : 'FAILED';
        validation.isValid = Object.values(validation.checks).every(check => check);

        return validation;
    }

    performValidationChecks(data) {
        return {
            hasMinimumIncome: data.summary.totalIncome > 0,
            hasRequiredCategories: this.checkRequiredCategories(data),
            dateRangeValid: this.validateDateRange(data.metadata.dateRange),
            hasCompleteTransactions: data.transactions.length > 0,
            hasValidAccounts: data.accounts.length > 0
        };
    }

    calculateTaxImplications(data) {
        return {
            requiresSelfAssessment: data.income.selfEmployment > 1000 || data.income.property > 1000,
            vatRegistrationRequired: data.income.selfEmployment > 85000,
            highIncomeWarning: data.summary.totalIncome > 100000,
            expenseRatioWarning: (data.expenses.total / data.income.total) > 0.8
        };
    }

    generateWarnings(data) {
        const warnings = [];
        
        // Income thresholds
        if (data.income.total > 100000) {
            warnings.push('High income: Additional reporting required');
        }
        
        // VAT checks
        if (data.income.selfEmployment > 85000) {
            warnings.push('VAT registration may be required');
        }
        
        // Expense ratio
        const expenseRatio = data.expenses.total / data.income.total;
        if (expenseRatio > 0.8) {
            warnings.push('High expense ratio: Documentation required');
        }

        return {
            warnings,
            severity: this.calculateWarningSeverity(warnings),
            requiresAction: warnings.length > 0,
            metadata: {
                generatedAt: new Date().toISOString(),
                count: warnings.length,
                highestSeverity: this.calculateWarningSeverity(warnings)
            }
        };
    }

    calculateWarningSeverity(warnings) {
        if (warnings.length === 0) return 'NONE';
        if (warnings.some(w => w.includes('VAT registration'))) return 'HIGH';
        if (warnings.some(w => w.includes('Self Assessment'))) return 'MEDIUM';
        return 'LOW';
    }

    checkRequiredCategories(data) {
        return {
            hasIncome: data.summary.totalIncome > 0,
            hasExpenses: data.summary.totalExpenses > 0,
            hasValidDateRange: this.validateDateRange(data.metadata.dateRange),
            hasAccountData: data.metadata.accountIds.length > 0
        };
    }

    async validateAndProcessData(data) {
        const validation = {
            warnings: this.generateWarnings(data),
            checks: this.checkRequiredCategories(data),
            taxImplications: {
                requiresSelfAssessment: data.income.selfEmployment > 0 || data.income.property > 0,
                vatRegistrationRequired: data.income.selfEmployment > 85000,
                highIncomeWarning: data.summary.totalIncome > 100000
            },
            metadata: {
                processedAt: new Date().toISOString(),
                status: 'VALIDATED',
                taxYear: data.metadata.taxYear
            }
        };

        return {
            ...data,
            validation,
            summary: {
                ...data.summary,
                validation: validation.checks,
                warnings: validation.warnings
            },
            status: this.determineProcessingStatus(validation)
        };
    }

    determineProcessingStatus(validation) {
        if (!validation.checks.hasIncome) return 'INCOMPLETE';
        if (validation.warnings.length > 0) return 'NEEDS_REVIEW';
        if (validation.taxImplications.requiresSelfAssessment) return 'REQUIRES_SA';
        return 'READY';
    }

    async processAndValidate(accessToken, taxYear) {
        try {
            const startDate = `${taxYear}-04-06`;
            const endDate = `${parseInt(taxYear) + 1}-04-05`;

            const data = await this.fetchFinancialData(accessToken, startDate, endDate);
            const processed = await this.validateAndProcessData(data);
            const status = this.determineProcessingStatus(processed.validation);

            return {
                data: processed,
                status,
                metadata: {
                    taxYear,
                    processedAt: new Date().toISOString(),
                    transactionCount: data.transactions.length,
                    accountCount: data.accounts.length,
                    validation: processed.validation,
                    warnings: processed.warnings
                }
            };
        } catch (error) {
            throw new Error(`Processing failed: ${error.message}`);
        }
    }

    async fetchFinancialData(accessToken, startDate, endDate) {
        const [transactions, accounts] = await Promise.all([
            this.fetchAllTransactions(accessToken, startDate, endDate),
            this.getAccountBalances(accessToken)
        ]);

        return {
            transactions: transactions.transactions,
            accounts,
            metadata: {
                dateRange: { startDate, endDate },
                processedAt: new Date().toISOString()
            }
        };
    }

    async initializeConnection(userId) {
        try {
            const linkToken = await this.createLinkToken(userId);
            return {
                linkToken: linkToken.link_token,
                expiration: linkToken.expiration,
                metadata: {
                    createdAt: new Date().toISOString(),
                    userId,
                    status: 'INITIALIZED'
                }
            };
        } catch (error) {
            throw new Error(`Failed to initialize Plaid connection: ${error.message}`);
        }
    }

    async exchangePublicToken(publicToken) {
        try {
            const response = await this.client.itemPublicTokenExchange({
                public_token: publicToken
            });
            
            const accessToken = response.data.access_token;
            const validation = await this.validateAccessToken(accessToken);
            
            return {
                accessToken,
                itemId: response.data.item_id,
                metadata: {
                    exchangedAt: new Date().toISOString(),
                    status: validation.isValid ? 'ACTIVE' : 'INVALID',
                    validation,
                    processing: {
                        startTime: new Date().toISOString(),
                        status: 'READY'
                    }
                }
            };
        } catch (error) {
            throw new Error(`Token exchange failed: ${error.message}`);
        }
    }

    async validateAccessToken(accessToken) {
        try {
            await this.client.accountsGet({
                access_token: accessToken
            });
            return {
                isValid: true,
                tokenType: 'ACCESS_TOKEN',
                validatedAt: new Date().toISOString()
            };
        } catch (error) {
            return {
                isValid: false,
                tokenType: 'ACCESS_TOKEN',
                error: error.message,
                validatedAt: new Date().toISOString()
            };
        }
    }

    async processTransactions(accessToken, taxYear) {
        try {
            const startDate = `${taxYear}-04-06`;
            const endDate = `${parseInt(taxYear) + 1}-04-05`;

            const [transactions, accounts] = await Promise.all([
                this.fetchAllTransactions(accessToken, startDate, endDate),
                this.getAccountBalances(accessToken)
            ]);
            
            const categorized = await this.categorizeTransactions(transactions.transactions);
            const validation = await this.validateTransactionData(categorized);
            const summary = this.generateFinancialSummary(categorized);

            return {
                data: {
                    transactions: categorized,
                    accounts: accounts.accounts
                },
                summary,
                validation,
                metadata: {
                    taxYear,
                    processedAt: new Date().toISOString(),
                    status: validation.isValid ? 'PROCESSED' : 'NEEDS_REVIEW',
                    transactionCount: transactions.transactions.length,
                    accountCount: accounts.accounts.length,
                    dateRange: { startDate, endDate }
                },
                taxCategories: {
                    income: this.mapToTaxCategories(categorized.income),
                    expenses: this.mapToTaxCategories(categorized.expenses)
                }
            };
        } catch (error) {
            throw new Error(`Transaction processing failed: ${error.message}`);
        }
    }

    mapToTaxCategories(transactions) {
        const taxCategories = {
            employment: ['salary', 'wages', 'payroll'],
            selfEmployment: ['freelance', 'contractor', 'consulting'],
            property: ['rent', 'rental income', 'lease'],
            investments: ['dividend', 'interest', 'investment']
        };

        return Object.entries(transactions).reduce((acc, [category, amount]) => {
            for (const [taxCategory, keywords] of Object.entries(taxCategories)) {
                if (keywords.some(keyword => category.toLowerCase().includes(keyword))) {
                    acc[taxCategory] = (acc[taxCategory] || 0) + amount;
                    break;
                }
            }
            return acc;
        }, {});
    }

    validateTransactionData(data) {
        const validation = {
            isValid: true,
            checks: {
                hasTransactions: data.transactions.length > 0,
                hasIncome: data.income.total > 0,
                hasValidDateRange: this.validateDateRange(data.metadata.dateRange),
                hasRequiredCategories: this.checkRequiredCategories(data),
                hasSufficientData: data.transactions.length >= 10,
                hasValidCurrencies: this.validateCurrencies(data.transactions)
            },
            warnings: this.generateWarnings(data),
            taxImplications: {
                requiresSelfAssessment: data.income.selfEmployment > 1000 || data.income.property > 1000,
                vatRegistrationRequired: data.income.selfEmployment > 85000,
                highIncomeWarning: data.income.total > 100000,
                multiCurrencyWarning: this.hasMultipleCurrencies(data.transactions)
            },
            metadata: {
                processedAt: new Date().toISOString(),
                status: 'VALIDATING',
                warningCount: 0,
                severity: 'NONE',
                lastUpdated: new Date().toISOString(),
                exchangeRates: this.exchangeRates,
                ratesLastUpdated: this.ratesLastUpdated
            }
        };

        validation.metadata.warningCount = validation.warnings.length;
        validation.metadata.severity = this.calculateWarningSeverity(validation.warnings);
        validation.metadata.status = validation.isValid ? 'VALIDATED' : 'FAILED';
        validation.isValid = Object.values(validation.checks).every(check => check);

        return validation;
    }

    async categorizeTransactions(transactions) {
        const categories = {
            income: {
                employment: ['salary', 'wages', 'payroll'],
                selfEmployment: ['freelance', 'contractor', 'consulting'],
                property: ['rent', 'rental income', 'lease'],
                investments: ['dividend', 'interest', 'investment']
            },
            expenses: {
                business: ['office', 'supplies', 'equipment'],
                property: ['mortgage', 'maintenance', 'repairs'],
                allowable: ['insurance', 'utilities', 'professional']
            }
        };

        const result = {
            categorized: transactions.reduce((acc, transaction) => {
                const convertedAmount = await this.convertToGBP(
                    Math.abs(transaction.amount), 
                    transaction.iso_currency_code || 'GBP'
                );
                const isIncome = transaction.amount < 0;
                const categoryType = isIncome ? 'income' : 'expenses';
                
                for (const [category, keywords] of Object.entries(categories[categoryType])) {
                    if (this.matchesCategory(transaction, keywords)) {
                        acc[categoryType][category] = (acc[categoryType][category] || 0) + convertedAmount;
                        acc.originalAmounts.push({
                            id: transaction.transaction_id,
                            original: transaction.amount,
                            currency: transaction.iso_currency_code,
                            converted: convertedAmount,
                            exchangeRate: this.exchangeRates[transaction.iso_currency_code || 'GBP']
                        });
                        break;
                    }
                }
                return acc;
            }, { income: {}, expenses: {}, originalAmounts: [] }),
            metadata: {
                processedAt: new Date().toISOString(),
                transactionCount: transactions.length,
                currencies: [...new Set(transactions.map(t => t.iso_currency_code || 'GBP'))],
                exchangeRates: this.exchangeRates,
                ratesLastUpdated: this.ratesLastUpdated
            }
        };

        return result;
    }

    async convertToGBP(amount, currency) {
        if (!this.exchangeRates) {
            await this.initializeExchangeRates();
        }
        if (!this.exchangeRates[currency]) {
            throw new Error(`Unsupported currency: ${currency}`);
        }
        return amount * this.exchangeRates[currency];
    }
}
