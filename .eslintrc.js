module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: [
    // All packages in this monorepo use TypeScript
    '@typescript-eslint',
    // All packages in this monorepo use Prettier
    'prettier'
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:jest/recommended',
    'plugin:jest/style'
  ],
  rules: {
    /**
     * The default setting for Prettier is 'warn' because then it shows as yellow squiggly lines
     * in the VS Code IDE. However, it means `eslint` will not have an error code if there is warning
     * due to prettier unles you also add the `--max-warnings=0` flag in front of it. So, in the `lint-staged`
     * scripts in the packages within this monorepo, we add that flag so that the precommit hooks
     * associated with that script will fail when run.
     */
    'prettier/prettier': 'warn'
  }
};
