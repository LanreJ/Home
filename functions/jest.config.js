module.exports = {
  testEnvironment: 'node',
  verbose: true,
  clearMocks: true,
  transform: {
    '^.+\\.jsx?$': 'babel-jest',
  },
  testMatch: ['**/__tests__/**/*.test.js'],
  coveragePathIgnorePatterns: ['/node_modules/'],
  setupFiles: ['./jest.setup.js']
};