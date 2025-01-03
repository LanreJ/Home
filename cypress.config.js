// filepath: /workspaces/Home/cypress.config.js
const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    setupNodeEvents(on, config) {
      // implement node event listeners here if needed
    },
    baseUrl: 'http://localhost:5000', // Adjust based on your development server
    specPattern: 'cypress/integration/**/*.js',
    supportFile: false, // or create the file at cypress/support/e2e.js
  },
});