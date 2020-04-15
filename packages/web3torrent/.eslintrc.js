const baseConfig = require('../../.eslintrc.js');

// From the tslint.json we used previously
const leftoverTsLintRules = {
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-use-before-define': 'off',
  '@typescript-eslint/no-unused-vars': 'off'
};

const jestViolations = {
  'jest/no-disabled-tests': 'off',
  'jest/expect-expect': 'off',
  // Below rules should probably be revisited
  'jest/prefer-to-have-length': 'off',
  'jest/prefer-to-contain': 'off',
  'jest/no-identical-title': 'off',
  'jest/no-jasmine-globals': 'off',
  'jest/no-try-expect': 'off',
  'jest/no-test-callback': 'off'
};

const otherViolations = {
  '@typescript-eslint/camelcase': 'off',
  // Below rules should probably be revisited
  '@typescript-eslint/no-inferrable-types': 'off',
  '@typescript-eslint/ban-ts-ignore': 'off',
  '@typescript-eslint/no-non-null-assertion': 'off',
  '@typescript-eslint/no-this-alias': 'off',
  '@typescript-eslint/no-empty-function': 'off',
  '@typescript-eslint/no-var-requires': 'off',
  'import/no-duplicates': 'off',
  'import/no-unresolved': 'off',
  'prefer-rest-params': 'off'
};

module.exports = {
  ...baseConfig,
  env: {
    browser: true,
    es6: true
  },
  plugins: [...baseConfig.plugins, "react-hooks", 'jest'],
  extends: [
    'plugin:jest/recommended',
    'plugin:jest/style',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript'
  ],
  rules: {
    ...leftoverTsLintRules,
    ...jestViolations,
    ...otherViolations,
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn'
  },
  globals: {
    fail: 'readonly',
    process: 'readonly',
    module: 'readonly',
    global: 'readonly',
    Buffer: 'readonly'
  }
};
