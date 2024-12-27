const TAX_YEAR_2023_24 = {
    personalAllowance: 12570,
    bands: [
        { name: 'Basic rate', start: 12571, end: 50270, rate: 0.20 },
        { name: 'Higher rate', start: 50271, end: 125140, rate: 0.40 },
        { name: 'Additional rate', start: 125141, end: Infinity, rate: 0.45 }
    ],
    nationalInsurance: {
        class2: { weeklyRate: 3.45, smallProfitsThreshold: 12570 },
        class4: [
            { start: 12570, end: 50270, rate: 0.09 },
            { start: 50271, end: Infinity, rate: 0.02 }
        ]
    }
};