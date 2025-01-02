// filepath: /workspaces/Home/functions/services/TaxCalculator.js
const calculateTax = (income, deductions) => {
  // Simplified tax calculation logic
  const taxableIncome = income - deductions;
  let taxLiability = 0;

  if (taxableIncome <= 9875) {
    taxLiability = taxableIncome * 0.10;
  } else if (taxableIncome <= 40125) {
    taxLiability = 987.50 + (taxableIncome - 9875) * 0.12;
  } else if (taxableIncome <= 85525) {
    taxLiability = 4617.50 + (taxableIncome - 40125) * 0.22;
  }
  // Add more brackets as needed

  return taxLiability;
};

module.exports = {
  calculateTax,
};