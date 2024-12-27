class UKTaxCalculator {
    constructor(taxYear = TAX_YEAR_2023_24) {
        this.taxYear = taxYear;
    }

    calculateIncomeTax(income) {
        let remainingIncome = income;
        let totalTax = 0;
        
        if (income <= this.taxYear.personalAllowance) {
            return 0;
        }

        for (const band of this.taxYear.bands) {
            const taxableInBand = Math.min(
                Math.max(0, remainingIncome - band.start + 1),
                band.end - band.start + 1
            );
            totalTax += taxableInBand * band.rate;
            remainingIncome -= taxableInBand;
            if (remainingIncome <= 0) break;
        }

        return totalTax;
    }

    calculateNIC(profit) {
        let class2 = 0;
        let class4 = 0;

        // Class 2
        if (profit >= this.taxYear.nationalInsurance.class2.smallProfitsThreshold) {
            class2 = this.taxYear.nationalInsurance.class2.weeklyRate * 52;
        }

        // Class 4
        for (const band of this.taxYear.nationalInsurance.class4) {
            const taxableInBand = Math.max(0, Math.min(profit, band.end) - band.start);
            class4 += taxableInBand * band.rate;
        }

        return { class2, class4, total: class2 + class4 };
    }
}