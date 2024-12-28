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
            return {
                accessToken: response.data.access_token,
                itemId: response.data.item_id,
                metadata: {
                    createdAt: new Date().toISOString(),
                    status: 'ACTIVE'
                }
            };
        } catch (error) {
            throw new Error(`Token exchange failed: ${error.message}`);
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

        while (hasMore) {
            const response = await this.client.transactionsSync({
                ...request,
                cursor
            });
            
            allTransactions = [...allTransactions, ...response.data.added];
            hasMore = response.data.has_more;
            cursor = response.data.next_cursor;
        }

        return {
            transactions: allTransactions,
            metadata: {
                count: allTransactions.length,
                dateRange: { startDate, endDate },
                processedAt: new Date().toISOString(),
                status: 'COMPLETED'
            }
        };
    }

    async getAccountBalances(accessToken) {
        try {
            const response = await this.client.accountsBalanceGet({
                access_token: accessToken
            });

            const accounts = response.data.accounts.map(account => ({
                accountId: account.account_id,
                name: account.name,
                type: account.type,
                subtype: account.subtype,
                balance: {
                    current: account.balances.current,
                    available: account.balances.available,
                    limit: account.balances.limit
                },
                mask: account.mask,
                metadata: {
                    lastUpdated: new Date().toISOString(),
                    institution: response.data.item.institution_id,
                    status: account.balances.current !== null ? 'ACTIVE' : 'INACTIVE'
                }
            }));

            return {
                accounts,
                summary: this.generateAccountSummary(accounts),
                metadata: {
                    fetchedAt: new Date().toISOString(),
                    totalAccounts: accounts.length,
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

    processTransactions(data) {
        return {
            income: this.categorizeIncome(data.transactions),
            expenses: this.categorizeExpenses(data.transactions),
            metadata: {
                accountIds: data.accounts.map(acc => acc.account_id),
                dateRange: {
                    start: data.start_date,
                    end: data.end_date
                }
            }
        };
    }

    categorizeIncome(transactions) {
        const incomeCategories = {
            salary: ['salary', 'payroll', 'wages'],
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

    categorizeTransactions(transactions) {
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

            const categorized = this.categorizeTransactions(transactions.transactions);
            
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
            checks: this.performValidationChecks(data),
            warnings: this.generateWarnings(data),
            taxImplications: this.calculateTaxImplications(data),
            metadata: {
                processedAt: new Date().toISOString(),
                status: 'VALIDATING',
                taxYear: data.metadata.taxYear
            }
        };

        return {
            isValid: this.isDataValid(validation),
            validation,
            status: this.determineProcessingStatus(validation),
            metadata: {
                ...validation.metadata,
                status: 'VALIDATED',
                warningCount: validation.warnings.length,
                severity: this.calculateWarningSeverity(validation.warnings)
            }
        };
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
        if (data.summary.totalIncome > 100000) {
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
        
        // Tax registration
        if (data.income.selfEmployment > 1000 || data.income.property > 1000) {
            warnings.push('Self Assessment registration required');
        }

        return {
            warnings,
            severity: this.calculateWarningSeverity(warnings),
            requiresAction: warnings.length > 0,
            metadata: {
                generatedAt: new Date().toISOString(),
                count: warnings.length
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
            
            return {
                accessToken: response.data.access_token,
                itemId: response.data.item_id,
                metadata: {
                    exchangedAt: new Date().toISOString(),
                    status: 'ACTIVE'
                }
            };
        } catch (error) {
            throw new Error(`Token exchange failed: ${error.message}`);
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
        return {
            isValid: true,
            checks: {
                hasTransactions: data.transactions.length > 0,
                hasIncome: data.income.total > 0,
                hasValidDateRange: