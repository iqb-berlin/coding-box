// Adapted from @iqb/eslint-config 2.2.0; see README.md and LICENSE-IQB.
const { rules: airbnbVariableRules } = require('eslint-config-airbnb-base/rules/variables');

module.exports = {
  "env": {
    "browser": true,
    "es2021": true
  },
  "extends": [
    "airbnb-base",
    require.resolve("./airbnb-typescript-base.cjs"),
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 12,
    "sourceType": "module",
    "project": "./tsconfig.json"
  },
  "plugins": [
    "@typescript-eslint",
    "@stylistic"
  ],
  "rules": {
    "@stylistic/comma-dangle": ["error", "never"],
    "import/prefer-default-export": "off",
    "import/no-extraneous-dependencies": ["error", {"devDependencies": true}],
    "@stylistic/lines-between-class-members": [
      "error", "always",
      {
        "exceptAfterSingleLine": true
      }
    ],
    "operator-linebreak": [2, "after"],
    "@stylistic/indent": [
      "error", 2,
      {
        "SwitchCase": 1,
        "FunctionExpression": {
          "parameters": "first"
        }
      }
    ],
    "arrow-parens": ["error", "as-needed"],
    "max-len": ["warn", 120],
    "@typescript-eslint/no-inferrable-types": "off",
    // TypeScript-ESLint 8 changed caughtErrors to "all"; preserve the IQB 7 policy.
    "@typescript-eslint/no-unused-vars": ["error", {
      ...airbnbVariableRules["no-unused-vars"][1],
      "caughtErrors": "none"
    }],
    // Preserve the TypeScript import-equals syntax accepted by no-var-requires in v7.
    "@typescript-eslint/no-require-imports": ["error", { "allowAsImport": true }],
    "@typescript-eslint/no-empty-object-type": ["error", { "allowInterfaces": "with-single-extends" }],
    "no-underscore-dangle": ["error", {"allowAfterThis": true}],
    "prefer-destructuring": ["off"],
    "@typescript-eslint/no-unused-expressions": [2, {"allowTernary": true}],
    "no-plusplus": ["error", {"allowForLoopAfterthoughts": true}],
    "no-param-reassign": ["error", {"props": false}],
    "@typescript-eslint/explicit-member-accessibility": [
      "error",
      {
        accessibility: 'no-public',
        overrides: {
          accessors: 'no-public',
          constructors: 'no-public',
          methods: 'no-public',
          properties: 'no-public',
          parameterProperties: 'no-public'
        }
      }
    ],
    "no-use-before-define": ["off"],
    "@typescript-eslint/no-use-before-define": ["off"],
    "object-shorthand": ["off"],
    "function-paren-newline": ["off"]
  }
};
