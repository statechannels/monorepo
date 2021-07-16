var config = require('./jest.config');
config.testMatch = ['<rootDir>/test/contracts/**/*.test.ts'];
config.testPathIgnorePatterns = ['ninja-nitro'];
config.reporters = ['default'];
config.globalSetup = '<rootDir>/jest/contract-test-setup.ts';
config.globalTeardown = '<rootDir>/jest/contract-test-teardown.ts';
module.exports = config;
