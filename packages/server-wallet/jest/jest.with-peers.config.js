const config = require('./jest.config');
config.testMatch = ['<rootDir>/src/**/__test-with-peers__/**/?(*.)test.ts'];
// We don't want to run ./jest/knex-setup-teardown.ts' as it assumes a database called server_wallet_test
config.setupFilesAfterEnv = ['./jest/custom-matchers.ts'];
module.exports = config;
