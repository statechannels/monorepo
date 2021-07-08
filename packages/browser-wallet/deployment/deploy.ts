import {TestContractArtifacts} from '@statechannels/nitro-protocol';
import {makeAddress} from '@statechannels/wallet-core';
import {constants, ContractFactory, providers, Wallet} from 'ethers';
import {TEST_ACCOUNTS} from '@statechannels/devtools';

// eslint-disable-next-line no-process-env
const rpcEndPoint = 'http://localhost:' + process.env.GANACHE_PORT;
const provider = new providers.JsonRpcProvider(rpcEndPoint);

const {TestNitroAdjudicatorArtifact, TokenArtifact} = TestContractArtifacts;

const [testNitroAdjudicatorFactory, tokenFactory] = [
  TestNitroAdjudicatorArtifact,
  TokenArtifact
].map(artifact =>
  new ContractFactory(artifact.abi, artifact.bytecode).connect(provider.getSigner(0))
);

export async function deploy(): Promise<any> {
  const TRIVIAL_APP_ADDRESS = makeAddress(constants.AddressZero);

  const NITRO_ADJUDICATOR_ADDRESS = (await testNitroAdjudicatorFactory.deploy()).address;

  const TEST_TOKEN_ADDRESS = (
    await tokenFactory.deploy(new Wallet(TEST_ACCOUNTS[0].privateKey).address)
  ).address;

  return {
    TRIVIAL_APP_ADDRESS,
    NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS
  };
}
