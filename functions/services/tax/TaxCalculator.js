class TaxCalculator {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.bands = {
            basic: { start: 12571, end: 50270, rate: 0.20 },
            higher: { start: 50271, end: 125140, rate: 0.40 },
            additional: { start: 125141, end: Infinity, rate: 0.45 }
        };
        this.nationalInsurance = {
            class2: { threshold: 11908, weeklyRate: 3.15 },
            class4: [
                { start: 11908, end: 50270, rate: 0.0925 },
                { start: 50271, end: Infinity, rate: 0.0325 }
            ]
        };

        this.returnStatuses = {
            DRAFT: 'DRAFT',
            PENDING: 'PENDING',
            SUBMITTED: 'SUBMITTED',
            ACCEPTED: 'ACCEPTED',
            REJECTED: 'REJECTED',
            OVERDUE: 'OVERDUE'
        };

        this.actionTypes = {
            FILE_RETURN: 'FILE_RETURN',
            MAKE_PAYMENT: 'MAKE_PAYMENT',
            UPDATE_INFO: 'UPDATE_INFO',
            REVIEW_ERRORS: 'REVIEW_ERRORS'
        };
    }

    calculateTax(income) {
        return {
            incomeTax: this.calculateIncomeTax(income),
            nationalInsurance: this.calculateNIC(income),
            paymentOnAccount: this.calculatePaymentOnAccount(income)
        };
    }

    calculateIncomeTax(income) {
        let remainingIncome = income;
        let totalTax = 0;

        for (const band of Object.values(this.bands)) {
            const taxableInBand = Math.min(
                Math.max(0, remainingIncome - band.start + 1),
                band.end - band.start + 1
            );
            totalTax += taxableInBand * band.rate;
            remainingIncome -= taxableInBand;
            if (remainingIncome <= 0) break;
        }

        return {
            total: totalTax,
            breakdown: this.calculateTaxBreakdown(income)
        };
    }

    calculateNIC(income) {
        let class2 = 0;
        let class4 = 0;

        if (income > this.nationalInsurance.class2.threshold) {
            class2 = this.nationalInsurance.class2.weeklyRate * 52;
        }

        for (const band of this.nationalInsurance.class4) {
            const taxableAmount = Math.min(
                Math.max(0, income - band.start),
                band.end - band.start
            );
            class4 += taxableAmount * band.rate;
        }

        return { class2, class4, total: class2 + class4 };
    }

    calculatePaymentOnAccount(income) {
        const totalLiability = this.calculateIncomeTax(income).total + 
                             this.calculateNIC(income).total;
        
        return {
            firstPayment: Math.ceil(totalLiability * 0.5),
            secondPayment: Math.ceil(totalLiability * 0.5),
            dueDate: {
                first: `${this.taxYear + 1}-01-31`,
                second: `${this.taxYear + 1}-07-31`
            }
        };
    }

    calculateTaxSummary(income, previousYear = null) {
        const currentYearTax = this.calculateTax(income);
        const adjustments = this.calculateAdjustments(previousYear);
        
        return {
            taxYear: this.taxYear,
            income: {
                total: income,
                taxable: Math.max(0, income - this.bands.basic.start)
            },
            calculation: {
                incomeTax: currentYearTax.incomeTax,
                nationalInsurance: currentYearTax.nationalInsurance,
                totalLiability: currentYearTax.incomeTax.total + 
                               currentYearTax.nationalInsurance.total
            },
            payments: {
                ...this.calculatePaymentSchedule(currentYearTax, adjustments),
                previousYearAdjustments: adjustments
            },
            allowances: this.calculateAllowances(income)
        };
    }

    calculateAdjustments(previousYear) {
        if (!previousYear) return { amount: 0, type: 'NONE' };

        const difference = previousYear.actualLiability - previousYear.paymentsMade;
        return {
            amount: Math.abs(difference),
            type: difference > 0 ? 'UNDERPAYMENT' : 'OVERPAYMENT'
        };
    }

    calculateAllowances(income) {
        const personalAllowance = this.calculatePersonalAllowance(income);
        return {
            personal: personalAllowance,
            propertyAllowance: income <= 1000 ? 1000 : 0,
            totalAllowances: personalAllowance
        };
    }

    calculatePersonalAllowance(income) {
        const baseAllowance = this.bands.basic.start;
        if (income <= 100000) return baseAllowance;
        
        const reduction = Math.floor((income - 100000) / 2);
        return Math.max(0, baseAllowance - reduction);
    }

    generateDetailedSummary(income, previousYearData = null) {
        const taxYear = {
            start: `${this.taxYear}-04-06`,
            end: `${this.taxYear + 1}-04-05`,
            paymentDates: {
                balancingPayment: `${this.taxYear + 1}-01-31`,
                firstPaymentOnAccount: `${this.taxYear + 1}-01-31`,
                secondPaymentOnAccount: `${this.taxYear + 1}-07-31`
            }
        };

        const calculations = {
            income: {
                total: income,
                taxable: Math.max(0, income - this.calculatePersonalAllowance(income))
            },
            tax: this.calculateTax(income),
            allowances: this.calculateAllowances(income),
            adjustments: previousYearData ? 
                this.calculatePreviousYearAdjustments(previousYearData) : 
                { amount: 0, type: 'NONE' }
        };

        return {
            taxYear,
            calculations,
            paymentSchedule: this.generatePaymentSchedule(calculations),
            penalties: this.calculatePenalties(calculations.tax.total),
            summary: {
                totalIncome: income,
                totalTaxDue: calculations.tax.incomeTax.total + calculations.tax.nationalInsurance.total,
                netPayable: this.calculateNetPayable(calculations),
                effectiveTaxRate: ((calculations.tax.incomeTax.total / income) * 100).toFixed(2)
            }
        };
    }

    calculatePreviousYearAdjustments(previousYear) {
        const { liability, paymentsMade } = previousYear;
        const difference = liability - paymentsMade;
        
        return {
            type: difference > 0 ? 'UNDERPAYMENT' : 'OVERPAYMENT',
            amount: Math.abs(difference),
            interestDue: this.calculateInterest(difference)
        };
    }

    calculateInterest(amount, days = 0) {
        const interestRate = 0.0325; // 3.25% HMRC Interest Rate
        return Math.ceil(amount * interestRate * (days / 365));
    }

    calculateTaxYearDates() {
        return {
            start: new Date(`${this.taxYear}-04-06`),
            end: new Date(`${this.taxYear + 1}-04-05`),
            paymentDates: {
                balancing: new Date(`${this.taxYear + 1}-01-31`),
                firstPOA: new Date(`${this.taxYear + 1}-01-31`),
                secondPOA: new Date(`${this.taxYear + 1}-07-31`)
            }
        };
    }

    calculatePenalties(dueAmount, paymentDate) {
        const rates = {
            threeMths: 0.05,
            sixMths: 0.05,
            twelveMths: 0.05
        };

        const penalties = {
            late: this.calculateLatePenalty(dueAmount, paymentDate),
            interest: this.calculateInterest(dueAmount, this.getDaysPastDue(paymentDate))
        };

        return {
            ...penalties,
            total: penalties.late + penalties.interest
        };
    }

    generatePaymentSummary(calculations, adjustments = null) {
        const dates = this.calculateTaxYearDates();
        const totalDue = calculations.incomeTax.total + 
                        calculations.nationalInsurance.total;
        
        return {
            balancingPayment: {
                amount: totalDue,
                dueDate: dates.paymentDates.balancing,
                adjustments: adjustments || { amount: 0, type: 'NONE' }
            },
            paymentsOnAccount: {
                first: { amount: totalDue * 0.5, dueDate: dates.paymentDates.firstPOA },
                second: { amount: totalDue * 0.5, dueDate: dates.paymentDates.secondPOA }
            },
            totalLiability: totalDue + (adjustments?.amount || 0)
        };
    }

    getDaysPastDue(paymentDate) {
        const today = new Date();
        const dueDate = new Date(paymentDate);
        return Math.max(0, Math.floor((today - dueDate) / (1000 * 60 * 60 * 24)));
    }

    calculatePaymentStatus(payment) {
        const daysPastDue = this.getDaysPastDue(payment.dueDate);
        const interestRate = 0.0325; // HMRC interest rate
        
        return {
            status: daysPastDue > 0 ? 'OVERDUE' : 'UPCOMING',
            daysOverdue: daysPastDue,
            penalties: this.calculateLatePenalties(payment.amount, daysPastDue),
            interest: this.calculateInterest(payment.amount, daysPastDue, interestRate),
            totalDue: payment.amount + 
                     this.calculateLatePenalties(payment.amount, daysPastDue) +
                     this.calculateInterest(payment.amount, daysPastDue, interestRate)
        };
    }

    calculateLatePenalties(amount, days) {
        if (days <= 30) return 0;
        let penalty = 0;
        if (days > 30) penalty += amount * 0.05;  // 5% after 30 days
        if (days > 180) penalty += amount * 0.05; // Additional 5% after 6 months
        if (days > 365) penalty += amount * 0.05; // Additional 5% after 12 months
        return penalty;
    }

    calculateInterest(amount, days, rate) {
        return (amount * rate * days) / 365;
    }

    calculateLatePenalty(amount, paymentDate) {
        const daysPastDue = this.getDaysPastDue(paymentDate);
        let penaltyRate = 0;

        if (daysPastDue > 30) penaltyRate += this.rates.threeMths;
        if (daysPastDue > 180) penaltyRate += this.rates.sixMths;
        if (daysPastDue > 365) penaltyRate += this.rates.twelveMths;

        return amount * penaltyRate;
    }

    generatePaymentSchedule(calculations) {
        const dates = this.calculateTaxYearDates();
        const totalDue = calculations.tax.total;

        return {
            currentYear: {
                balancingPayment: {
                    amount: totalDue,
                    dueDate: dates.paymentDates.balancing,
                    penalties: this.calculatePenalties(totalDue, dates.paymentDates.balancing)
                },
                paymentsOnAccount: {
                    first: {
                        amount: totalDue * 0.5,
                        dueDate: dates.paymentDates.firstPOA
                    },
                    second: {
                        amount: totalDue * 0.5,
                        dueDate: dates.paymentDates.secondPOA
                    }
                }
            },
            totalPayable: totalDue + calculations.adjustments.amount
        };
    }

    calculateTaxLiability(income, expenses) {
        const taxableIncome = this.calculateTaxableIncome(income, expenses);
        const incomeTax = this.calculateIncomeTax(taxableIncome);
        const nic = this.calculateNIC(taxableIncome);

        return {
            taxableIncome,
            calculations: {
                incomeTax,
                nationalInsurance: nic,
                total: incomeTax.total + nic.total
            },
            payments: this.generatePaymentSchedule({
                tax: { total: incomeTax.total + nic.total }
            }),
            summary: {
                grossIncome: income,
                totalExpenses: expenses,
                netTaxable: taxableIncome,
                totalLiability: incomeTax.total + nic.total,
                effectiveRate: ((incomeTax.total / taxableIncome) * 100).toFixed(2)
            },
            fiscalPeriod: this.calculateTaxYearDates()
        };
    }

    calculateTaxableIncome(income, expenses) {
        const allowances = this.calculateAllowances(income);
        return Math.max(0, income - expenses - allowances.totalAllowances);
    }

    getFiscalYear() {
        const today = new Date();
        const month = today.getMonth() + 1;
        const year = today.getFullYear();
        return month <= 4 ? year - 1 : year;
    }

    calculateTaxPeriod(year = this.getFiscalYear()) {
        return {
            currentYear: {
                start: new Date(`${year}-04-06`),
                end: new Date(`${year + 1}-04-05`)
            },
            paymentDeadlines: {
                balancing: new Date(`${year + 1}-01-31`),
                firstPOA: new Date(`${year + 1}-01-31`),
                secondPOA: new Date(`${year + 1}-07-31`)
            },
            isCurrentYear: year === this.getFiscalYear()
        };
    }

    generateTaxSummary(income, expenses, previousYear = null) {
        const taxableIncome = this.calculateTaxableIncome(income, expenses);
        const liability = this.calculateTaxLiability(taxableIncome);
        const period = this.calculateTaxPeriod();

        return {
            taxYear: {
                year: this.taxYear,
                ...period
            },
            income: {
                gross: income,
                expenses: expenses,
                taxable: taxableIncome,
                allowances: this.calculateAllowances(income)
            },
            liability: {
                ...liability,
                adjustments: previousYear ? 
                    this.calculatePreviousYearAdjustments(previousYear) : null
            },
            payments: this.generatePaymentSchedule(liability),
            summary: {
                totalDue: liability.total + 
                    (previousYear?.adjustments?.amount || 0),
                nextPaymentDate: this.getNextPaymentDate(period),
                status: this.getTaxReturnStatus()
            }
        };
    }

    getNextPaymentDate(period) {
        const today = new Date();
        const dates = [
            { date: period.paymentDeadlines.balancing, type: 'BALANCING' },
            { date: period.paymentDeadlines.firstPOA, type: 'FIRST_POA' },
            { date: period.paymentDeadlines.secondPOA, type: 'SECOND_POA' }
        ].sort((a, b) => a.date - b.date);

        const nextPayment = dates.find(d => d.date > today);
        return nextPayment ? {
            dueDate: nextPayment.date,
            type: nextPayment.type,
            daysRemaining: Math.ceil((nextPayment.date - today) / (1000 * 60 * 60 * 24))
        } : null;
    }

    getTaxReturnStatus() {
        const today = new Date();
        const filingDeadline = new Date(`${this.taxYear + 1}-01-31`);
        
        return {
            status: today > filingDeadline ? 'OVERDUE' : 'PENDING',
            deadline: filingDeadline,
            daysRemaining: Math.ceil((filingDeadline - today) / (1000 * 60 * 60 * 24)),
            filed: false
        };
    }

    getFilingHistory(returnId) {
        // To be implemented with database integration
        return {
            created: new Date(),
            lastUpdated: new Date(),
            status: this.returnStatuses.DRAFT,
            submissions: [],
            payments: [],
            amendments: []
        };
    }

    getRequiredActions() {
        const status = this.getTaxReturnStatus();
        const actions = [];

        if (status.status === 'OVERDUE') {
            actions.push({
                type: this.actionTypes.FILE_RETURN,
                priority: 'HIGH',
                deadline: status.deadline
            });
        }

        if (!status.filed) {
            actions.push({
                type: this.actionTypes.UPDATE_INFO,
                priority: 'MEDIUM',
                deadline: status.deadline
            });
        }

        return actions;
    }

    getUpcomingDeadlines() {
        const period = this.calculateTaxPeriod();
        return {
            filing: {
                deadline: period.paymentDeadlines.balancing,
                type: 'SELF_ASSESSMENT',
                status: this.getTaxReturnStatus().status
            },
            payments: [
                {
                    type: 'BALANCING',
                    deadline: period.paymentDeadlines.balancing,
                    status: this.getPaymentStatus(period.paymentDeadlines.balancing)
                },
                {
                    type: 'FIRST_POA',
                    deadline: period.paymentDeadlines.firstPOA,
                    status: this.getPaymentStatus(period.paymentDeadlines.firstPOA)
                },
                {
                    type: 'SECOND_POA',
                    deadline: period.paymentDeadlines.secondPOA,
                    status: this.getPaymentStatus(period.paymentDeadlines.secondPOA)
                }
            ]
        };
    }

    getPaymentStatus(deadline) {
        const today = new Date();
        const daysDiff = Math.ceil((deadline - today) / (1000 * 60 * 60 * 24));
        
        return {
            status: daysDiff < 0 ? 'OVERDUE' : 'PENDING',
            daysRemaining: Math.max(0, daysDiff),
            daysOverdue: Math.max(0, -daysDiff),
            notifications: this.getPaymentNotifications(daysDiff),
            actions: this.getPaymentActions(daysDiff)
        };
    }

    getPaymentNotifications(daysDiff) {
        const notifications = [];
        
        if (daysDiff <= 0) {
            notifications.push({
                type: 'URGENT',
                message: 'Payment overdue - penalties may apply',
                severity: 'HIGH',
                actions: [{
                    type: 'PAYMENT',
                    label: 'Pay Now',
                    priority: 'IMMEDIATE'
                }]
            });
        } else if (daysDiff <= 7) {
            notifications.push({
                type: 'WARNING',
                message: 'Payment due within 7 days',
                severity: 'MEDIUM',
                actions: [{
                    type: 'PAYMENT',
                    label: 'Schedule Payment',
                    priority: 'HIGH'
                }]
            });
        } else if (daysDiff <= 30) {
            notifications.push({
                type: 'REMINDER',
                message: 'Payment due within 30 days',
                severity: 'LOW',
                actions: [{
                    type: 'PAYMENT',
                    label: 'View Payment Options',
                    priority: 'MEDIUM'
                }]
            });
        }

        return notifications;
    }

    getPaymentActions(daysDiff) {
        const actions = [];
        
        if (daysDiff < 0) {
            actions.push({
                type: 'REQUIRED',
                action: 'MAKE_PAYMENT',
                deadline: 'IMMEDIATE'
            });
        } else if (daysDiff <= 30) {
            actions.push({
                type: 'RECOMMENDED',
                action: 'SCHEDULE_PAYMENT',
                deadline: `${daysDiff} days`
            });
        }

        return actions;
    }
}

module.exports = TaxCalculator;