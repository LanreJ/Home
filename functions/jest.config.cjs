module.exports = {
    testEnvironment: 'jsdom',
    moduleFileExtensions: ['js', 'jsx', 'cjs'],
    transform: {
        "^.+\\.[t|j]sx?$": "babel-jest",
        "^.+\\.cjs$": "babel-jest"
    },
    transformIgnorePatterns: [
        "node_modules/(?!(@testing-library/jest-dom)/)",
    ],
    testMatch: [
        '**/__tests__/**/*.(test|spec).(js|jsx|cjs)'
    ],
    coverageDirectory: 'coverage',
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.cjs']
};

