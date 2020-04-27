const {spawn} = require('child_process');
const {configureEnvVariables} = require('@statechannels/devtools');

/**
 * The purpose of this file is simply to run configureEnvVariables
 * before executing the webpack build command.
 */
void (() =>
  configureEnvVariables() &&
  spawn('yarn', ['run', 'react-scripts', 'build'], {
    stdio: 'inherit'
  }).on('close', process.exit))();
