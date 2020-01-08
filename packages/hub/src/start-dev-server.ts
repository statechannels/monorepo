import {setupGanache} from '@statechannels/devtools';
import {deploy} from '../deployment/deploy';
import {startServer} from './hub/server';

async function setupGanacheAndContracts() {
  const {deployer} = await setupGanache();
  const deployedArtifacts = await deploy(deployer);

  process.env = {...process.env, ...deployedArtifacts};
}

async function start() {
  await setupGanacheAndContracts();
  await startServer();
}

if (require.main === module) {
  require('../env'); // Note: importing this module has the side effect of modifying env vars
  start();
}
