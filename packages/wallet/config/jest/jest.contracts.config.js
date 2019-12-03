let config = require("./jest.config");

module.exports = {
  ...config,
  bail: true,
  testMatch: ["<rootDir>/src/**/contract-tests/?(*.)test.ts?(x)"],
  globalSetup: "<rootDir>/jest/contract-test-setup.ts",
  globalTeardown: "<rootDir>/jest/contract-test-teardown.ts",
  setupFilesAfterEnv: []
};
