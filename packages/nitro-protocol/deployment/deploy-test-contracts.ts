// NOTE: this script manages deploying contracts for testing purposes ONLY
// DO NOT USE THIS SCRIPT TO DEPLOY CONTRACTS TO PRODUCTION NETWORKS
import {TEST_ACCOUNTS} from '@statechannels/devtools';
import {ContractFactory, providers, Wallet} from 'ethers';

import countingAppArtifact from '../artifacts/contracts/CountingApp.sol/CountingApp.json';
import nitroAdjudicatorArtifact from '../artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json';
import singleAssetPaymentsArtifact from '../artifacts/contracts/examples/SingleAssetPayments.sol/SingleAssetPayments.json';
import hashLockedSwapArtifact from '../artifacts/contracts/examples/HashLockedSwap.sol/HashLockedSwap.json';
import testForceMoveArtifact from '../artifacts/contracts/test/TESTForceMove.sol/TESTForceMove.json';
import testNitroAdjudicatorArtifact from '../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import tokenArtifact from '../artifacts/contracts/Token.sol/Token.json';
import trivialAppArtifact from '../artifacts/contracts/TrivialApp.sol/TrivialApp.json';
import embeddedApplicationArtifact from '../artifacts/contracts/examples/EmbeddedApplication.sol/EmbeddedApplication.json';

const rpcEndPoint = 'http://localhost:' + process.env.GANACHE_PORT;
const provider = new providers.JsonRpcProvider(rpcEndPoint);

// Factories

const [
  countingAppFactory,
  nitroAdjudicatorFactory,
  singleAssetPaymentsFactory,
  hashLockedSwapFactory,
  testForceMoveFactory,
  testNitroAdjudicatorFactory,
  tokenFactory,
  trivialAppFactory,
  embeddedApplicationFactory,
] = [
  countingAppArtifact,
  nitroAdjudicatorArtifact,
  singleAssetPaymentsArtifact,
  hashLockedSwapArtifact,
  testForceMoveArtifact,
  testNitroAdjudicatorArtifact,
  tokenArtifact,
  trivialAppArtifact,
  embeddedApplicationArtifact,
].map(artifact =>
  new ContractFactory(artifact.abi, artifact.bytecode).connect(provider.getSigner(0))
);

export async function deploy(): Promise<Record<string, string>> {
  const NITRO_ADJUDICATOR_ADDRESS = (await nitroAdjudicatorFactory.deploy()).address;
  const COUNTING_APP_ADDRESS = (await countingAppFactory.deploy()).address;

  const HASH_LOCK_ADDRESS = (await hashLockedSwapFactory.deploy()).address;
  const SINGLE_ASSET_PAYMENT_ADDRESS = (await singleAssetPaymentsFactory.deploy()).address;
  const TEST_NITRO_ADJUDICATOR_ADDRESS = (await testNitroAdjudicatorFactory.deploy()).address;
  const TRIVIAL_APP_ADDRESS = (await trivialAppFactory.deploy()).address;
  const TEST_FORCE_MOVE_ADDRESS = (await testForceMoveFactory.deploy()).address;
  const EMBEDDED_APPLICATION_ADDRESS = (await embeddedApplicationFactory.deploy()).address;

  const TEST_TOKEN_ADDRESS = (
    await tokenFactory.deploy(new Wallet(TEST_ACCOUNTS[0].privateKey).address)
  ).address;
  return {
    NITRO_ADJUDICATOR_ADDRESS,
    COUNTING_APP_ADDRESS,
    HASH_LOCK_ADDRESS,
    EMBEDDED_APPLICATION_ADDRESS,
    SINGLE_ASSET_PAYMENT_ADDRESS,
    TRIVIAL_APP_ADDRESS,
    TEST_FORCE_MOVE_ADDRESS,
    TEST_NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS,
  };
}
