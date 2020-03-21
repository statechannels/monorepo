/* eslint-env node */

'use strict';

const path = require('path');
const fs = require('fs');

function configureEnvVariables(env) {
  // https://github.com/bkeepers/dotenv#what-other-env-files-can-i-use
  let dotenvFiles = [
    `.env.${env}.local`,
    // Don't include `.env.local` for `test` environment
    // since normally you expect tests to produce the same
    // results for everyone
    env !== 'test' && `.env.local`,
    `.env.${env}`,
    '.env'
  ].filter(x => !!x);

  // Return the highest order .env file
  // If a local is available use it
  // Order: .env.local > .env.{env} > .env
  const dotenvFile = dotenvFiles.find(dotenvFile => fs.existsSync(dotenvFile));
  return dotenvFile;
}

module.exports = function(env) {
  const dotenvFile = configureEnvVariables(env);
  const DOT_ENV_PATH = path.join(
    path.dirname(__dirname),
    dotenvFile
  );
  return {
    clientAllowedKeys: [
      'TARGET_NETWORK',
      'FIREBASE_PROJECT',
      'WALLET_URL',
      'TTT_CONTRACT_ADDRESS',
      'CHAIN_NETWORK_ID',
      'USE_GANACHE_DEPLOYMENT_CACHE'
    ],
    failOnMissingKey: true,
    path: DOT_ENV_PATH
  };
};
