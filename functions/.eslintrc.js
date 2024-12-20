module.exports = {
  env: {
    node: true,
    es2021: true,
  },
  parserOptions: {
    ecmaVersion: 12,
  },
  extends: [
    "eslint:recommended",
  ],
  rules: {
    "object-curly-spacing": ["error", "never"],
    "quotes": ["error", "double"],
    "no-trailing-spaces": "error",
    "max-len": ["error", {"code": 80}],
    "no-unused-vars": ["error", {"argsIgnorePattern": "^_"}],
    "valid-jsdoc": ["error", {
      "requireReturn": false,
      "requireReturnDescription": false
    }],
    "eol-last": ["error", "always"],
  },
  overrides: [
    {
      files: ["**/*.spec.*"],
      env: {
        mocha: true,
      },
      rules: {},
    },
  ],
  globals: {},
}; // Added closing comma
