class AccountInsights {
    constructor(taxAccountService, paymentProcessor) {
        this.taxAccountService = taxAccountService;
        this.paymentProcessor = paymentProcessor;
        this.insightTypes = {
            PAYMENT: 'payment',
            FILING: 'filing',
            COMPLIANCE: 'compliance'
        };
    }

    async generateInsights(utr) {
        const [accountSummary, paymentHistory, statements] = await Promise.all([
            this.taxAccountService.getAccountSummary(utr),
            this.taxAccountService.getPaymentHistory(utr),
            this.taxAccountService.getAccountStatements(utr)
        ]);

        return {
            paymentInsights: await this.analyzePayments(accountSummary, paymentHistory),
            filingInsights: await this.analyzeFilingHistory(accountSummary),
            complianceRisks: this.assessCompliance(statements),
            recommendations: this.generateRecommendations(accountSummary)
        };
    }

    async analyzePayments(summary, history) {
        const trends = this.calculatePaymentTrends(history);
        const risks = this.assessPaymentRisks(summary, trends);
        const forecast = this.generatePaymentForecast(trends);

        return {
            currentBalance: summary.balances.total,
            nextPayment: {
                date: summary.nextPayment.dueDate,
                amount: summary.nextPayment.amount,
                urgency: this.calculatePaymentUrgency(summary.nextPayment.dueDate)
            },
            paymentTrends: trends,
            riskAssessment: risks,
            forecast: forecast,
            planningOptions: {
                paymentPlan: this.evaluatePaymentPlanOptions(summary),
                budgetSuggestions: this.generateBudgetSuggestions(trends)
            }
        };
    }

    async analyzeFilingHistory(accountSummary) {
        const currentTaxYear = this.getCurrentTaxYear();
        return {
            missingReturns: this.identifyMissingReturns(accountSummary.filings.missingYears),
            filingPattern: {
                onTime: accountSummary.filings.lastFiled ? this.isFiledOnTime(accountSummary.filings.lastFiled) : null,
                averageFilingDate: this.calculateAverageFilingDate(accountSummary.filings),
                riskLevel: this.assessFilingRisk(accountSummary.filings)
            },
            nextDeadline: {
                date: `${currentTaxYear + 1}-01-31`,
                daysRemaining: this.calculateDaysToDeadline(currentTaxYear),
                status: this.getFilingStatus(currentTaxYear)
            }
        };
    }

    calculatePaymentTrends(history) {
        return {
            averagePayment: this.calculateAveragePayment(history),
            frequency: this.analyzePaymentFrequency(history),
            seasonalPatterns: this.detectSeasonalPatterns(history),
            complianceScore: this.calculatePaymentComplianceScore(history)
        };
    }

    assessCompliance(statements) {
        return {
            riskLevel: this.calculateRiskLevel(statements),
            issues: this.identifyComplianceIssues(statements),
            suggestions: this.generateComplianceSuggestions(statements),
            history: {
                latePayments: this.countLatePayments(statements),
                missedDeadlines: this.countMissedDeadlines(statements),
                penalties: this.calculatePenalties(statements)
            }
        };
    }

    assessComplianceRisk(statements) {
        return {
            overallRisk: this.calculateRiskScore(statements),
            missedDeadlines: this.countMissedDeadlines(statements),
            latePayments: this.analyzeLatePayments(statements),
            penaltyHistory: this.analyzePenalties(statements),
            recommendations: this.generateComplianceRecommendations(statements)
        };
    }

    generateRecommendations(accountSummary) {
        return {
            immediate: this.getImmediateActions(accountSummary),
            shortTerm: this.getShortTermRecommendations(accountSummary),
            longTerm: this.getLongTermSuggestions(accountSummary),
            paymentPlans: this.getPaymentPlanOptions(accountSummary)
        };
    }

    generatePaymentForecast(trends) {
        return {
            nextYearEstimate: this.estimateNextYearPayments(trends),
            cashflowProjection: this.projectCashflow(trends),
            savingsRecommendations: this.calculateRecommendedSavings(trends)
        };
    }

    getCurrentTaxYear() {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth() + 1;
        return month >= 4 ? year : year - 1;
    }
}

module.exports = AccountInsights;