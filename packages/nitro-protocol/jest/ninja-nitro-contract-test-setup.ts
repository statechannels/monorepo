import {GanacheServer, configureEnvVariables} from '@statechannels/devtools';
import {deploy} from '../deployment/deploy-ninja-nitro-contracts';

export default async function setup() {
  configureEnvVariables();
  const ganacheServer = new GanacheServer(
    Number(process.env.GANACHE_PORT),
    Number(process.env.CHAIN_NETWORK_ID)
  );
  await ganacheServer.ready();

  const deployedArtifacts = await deploy();

  process.env = {...process.env, ...deployedArtifacts};
  (global as any).__GANACHE_SERVER__ = ganacheServer;
}
