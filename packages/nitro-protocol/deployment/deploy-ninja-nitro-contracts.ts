// NOTE: this script manages deploying contracts for testing purposes ONLY
// DO NOT USE THIS SCRIPT TO DEPLOY CONTRACTS TO PRODUCTION NETWORKS
import {ContractFactory, providers, Wallet} from 'ethers';
import {TEST_ACCOUNTS} from '@statechannels/devtools';

import {setupContract} from '../test/test-helpers';
import adjudicatorFactoryArtifact from '../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import singleChannelAdjudicatorArtifact from '../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';
import tokenArtifact from '../artifacts/contracts/Token.sol/Token.json';

const rpcEndPoint = 'http://localhost:' + process.env.GANACHE_PORT;
const provider = new providers.JsonRpcProvider(rpcEndPoint);

const [adjudicatorFactoryFactory, singleChannelAdjudicatorFactory, tokenFactory] = [
  adjudicatorFactoryArtifact,
  singleChannelAdjudicatorArtifact,
  tokenArtifact,
].map(artifact =>
  new ContractFactory(artifact.abi, artifact.bytecode).connect(provider.getSigner(0))
);

export async function deploy(): Promise<Record<string, string>> {
  const TEST_TOKEN_ADDRESS = (
    await tokenFactory.deploy(new Wallet(TEST_ACCOUNTS[0].privateKey).address)
  ).address;

  const ADJUDICATOR_FACTORY_ADDRESS = (await adjudicatorFactoryFactory.deploy()).address;

  const SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS = (
    await singleChannelAdjudicatorFactory.deploy(ADJUDICATOR_FACTORY_ADDRESS)
  ).address; // The mastercopy requires the adjudicator factory address as a constructor arg
  // It will be "baked into" the bytecode of the Mastercopy

  // The following lines are not strictly part of deployment, but they constitute a crucial one-time setup
  // for the contracts. The factory needs to know the address of the mastercopy, and this is provided by calling
  // the setup method on the factory:
  const AdjudicatorFactory = await setupContract(
    provider,
    adjudicatorFactoryArtifact,
    ADJUDICATOR_FACTORY_ADDRESS
  );
  await (await AdjudicatorFactory.setup(SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS)).wait();

  return {
    SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS,
    ADJUDICATOR_FACTORY_ADDRESS,
    TEST_TOKEN_ADDRESS,
  };
}
