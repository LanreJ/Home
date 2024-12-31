import { TaxRates } from './TaxRates.js';
import { AllowanceCalculator } from './AllowanceCalculator.js';
import { ValidationService } from '../validation/ValidationService.js';

export class TaxCalculator {
    constructor(taxYear) {
        this.taxYear = taxYear;
        this.rates = new TaxRates(taxYear);
        this.allowances = new AllowanceCalculator(taxYear);
        this.validator = new ValidationService();
    }

    calculateTax(income, expenses = {}, allowances = {}) {
        // Validate inputs
        this.validator.validateIncome(income);
        this.validator.validateExpenses(expenses);

        // Calculate taxable income
        const taxableIncome = this.calculateTaxableIncome(income, expenses, allowances);

        // Calculate tax due
        const taxDue = this.calculateTaxDue(taxableIncome);

        // Calculate payment schedule
        const paymentSchedule = this.calculatePaymentSchedule(taxDue);

        return {
            summary: {
                taxableIncome,
                taxDue,
                effectiveRate: (taxDue / taxableIncome * 100).toFixed(2)
            },
            schedule: paymentSchedule,
            status: this.getTaxReturnStatus()
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

    // Additional helper methods...
}