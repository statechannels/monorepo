const rules = {
  'arrow-body-style': 'error',
  'arrow-parens': ['off', 'as-needed'],
  camelcase: 'error',
  complexity: 'off',
  'constructor-super': 'error',
  curly: 'error',
  'dot-notation': 'error',
  'eol-last': 'off',
  eqeqeq: ['error', 'smart'],
  'guard-for-in': 'error',
  'id-blacklist': [
    'error',
    'any',
    'Number',
    'number',
    'String',
    'string',
    'Boolean',
    'boolean',
    'Undefined'
    // 'undefined',
  ],
  'id-match': 'error',
  'import/order': 'error',
  'linebreak-style': 'off',
  'max-classes-per-file': 'off',
  'max-len': 'off',
  'new-parens': 'off',
  'newline-per-chained-call': 'off',
  'no-bitwise': 'error',
  'no-caller': 'error',
  'no-cond-assign': 'error',
  'no-console': [
    'error',
    {
      allow: [
        'log',
        'warn',
        'dir',
        'time',
        'timeEnd',
        'timeLog',
        'trace',
        'assert',
        'clear',
        'count',
        'countReset',
        'group',
        'groupEnd',
        'table',
        'debug',
        'info',
        'dirxml',
        'error',
        'groupCollapsed',
        'Console',
        'profile',
        'profileEnd',
        'timeStamp',
        'context'
      ]
    }
  ],
  'no-debugger': 'error',
  'no-empty': 'error',
  'no-eval': 'error',
  'no-extra-semi': 'off',
  'no-fallthrough': 'error',
  'no-invalid-this': 'off',
  'no-irregular-whitespace': 'off',
  'no-multiple-empty-lines': 'off',
  'no-new-wrappers': 'error',
  'no-shadow': [
    'error',
    {
      hoist: 'all'
    }
  ],
  'no-throw-literal': 'error',
  'no-trailing-spaces': 'off',
  'no-undef-init': 'error',
  'no-underscore-dangle': ['off'],
  'no-unsafe-finally': 'error',
  'no-unused-expressions': 'error',
  'no-unused-labels': 'error',
  'no-var': 'error',
  'object-shorthand': 'error',
  'one-var': ['error', 'never'],
  'prefer-arrow-callback': 'error',
  'prefer-const': 'error',
  'quote-props': 'off',
  radix: 'error',
  'space-before-function-paren': 'off',
  'spaced-comment': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'off',
  'prettier/prettier': 'error',
  'no-unused-vars': 'off',
  'import/default': 'off'
};

const TSRules = {
  '@typescript-eslint/adjacent-overload-signatures': 'error',
  '@typescript-eslint/array-type': 'error',
  '@typescript-eslint/ban-types': 'error',
  '@typescript-eslint/class-name-casing': 'error',
  '@typescript-eslint/consistent-type-assertions': 'error',
  '@typescript-eslint/consistent-type-definitions': 'off',
  '@typescript-eslint/explicit-member-accessibility': [
    'off',
    {
      accessibility: 'explicit'
    }
  ],
  '@typescript-eslint/indent': 'off',
  '@typescript-eslint/interface-name-prefix': 'off',
  '@typescript-eslint/member-delimiter-style': [
    'off',
    'error',
    {
      multiline: {
        delimiter: 'none',
        requireLast: true
      },
      singleline: {
        delimiter: 'semi',
        requireLast: false
      }
    }
  ],
  '@typescript-eslint/member-ordering': 'error',
  '@typescript-eslint/no-empty-function': 'error',
  '@typescript-eslint/no-empty-interface': 'error',
  '@typescript-eslint/no-explicit-any': 'off',
  '@typescript-eslint/no-misused-new': 'error',
  '@typescript-eslint/no-namespace': 'error',
  '@typescript-eslint/no-parameter-properties': 'off',
  '@typescript-eslint/no-use-before-declare': 'off',
  '@typescript-eslint/no-var-requires': 'error',
  '@typescript-eslint/prefer-for-of': 'off',
  '@typescript-eslint/prefer-function-type': 'error',
  '@typescript-eslint/prefer-namespace-keyword': 'error',
  '@typescript-eslint/quotes': 'off',
  '@typescript-eslint/semi': ['off', null],
  '@typescript-eslint/space-within-parens': ['off', 'never'],
  '@typescript-eslint/triple-slash-reference': 'error',
  '@typescript-eslint/type-annotation-spacing': 'off',
  '@typescript-eslint/unified-signatures': 'error',
  '@typescript-eslint/explicit-function-return-type': 'off',
  '@typescript-eslint/no-unused-vars': 'off',
  '@typescript-eslint/ban-ts-ignore': 'off',
  '@typescript-eslint/no-use-before-define': 'off'
};

module.exports = {
  env: {
    browser: true,
    es6: true
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    ecmaVersion: 2018,
    sourceType: 'module'
  },
  plugins: ['@typescript-eslint', '@typescript-eslint/tslint', 'prettier'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'eslint:recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'prettier/@typescript-eslint',
    'prettier'
  ],
  rules: Object.assign(rules, TSRules),
  overrides: [
    {
      files: ['tests/**/*.ts'],
      env: {
        node: true
      },
      globals: {
        jest: 'readonly',
        document: 'readonly',
        window: 'readonly',
        Promise: 'readonly',
        expect: 'readonly',
        it: 'readonly',
        describe: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly'
      }
    }
  ]
};
