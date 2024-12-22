import prettierPlugin from "eslint-plugin-prettier";

export default [
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",

      globals: {
        // Node globals
        global: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        exports: "readonly",
        module: "readonly",
        require: "readonly",

        // Common Browser globals
        window: "readonly",
        document: "readonly",
        console: "readonly",
        alert: "readonly",
        fetch: "readonly",
      },
    },
    plugins: {
      prettier: prettierPlugin,
    },
    rules: {
      "object-curly-spacing": ["error", "never"],
      quotes: ["error", "double"],
      "no-trailing-spaces": "error",
      "max-len": ["error", { code: 80 }],
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "prettier/prettier": "error",
      "eol-last": ["error", "always"],
    },
  },
  {
    files: ["**/*.spec.*"],
    // Add test-specific configurations if needed
  },
];
