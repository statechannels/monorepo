var config = require('./jest.config');
config.testMatch = ['<rootDir>/test/**/ninja-nitro/**/*.test.ts'];
config.reporters = ['default'];
config.globalSetup = '<rootDir>/jest/ninja-nitro-contract-test-setup.ts';
config.globalTeardown = '<rootDir>/jest/contract-test-teardown.ts';
module.exports = config;
