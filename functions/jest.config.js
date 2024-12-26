module.exports = {
  testEnvironment: 'node',
  verbose: true,
  clearMocks: true,
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  testMatch: ['**/__tests__/**/*.test.js'],
};