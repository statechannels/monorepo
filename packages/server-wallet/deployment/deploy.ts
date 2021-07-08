import {Address} from '@statechannels/client-api-schema';
import {TestContractArtifacts} from '@statechannels/nitro-protocol';
import {TEST_ACCOUNTS} from '@statechannels/devtools';
import {ContractFactory, providers, Wallet} from 'ethers';

const {TestNitroAdjudicatorArtifact, TokenArtifact} = TestContractArtifacts;

export type TestNetworkContext = {
  ERC20_ADDRESS: Address;
  NITRO_ADJUDICATOR_ADDRESS: Address;
};

// NOTE: deploying contracts like this allows the onchain service package to
// be easily extracted
// eslint-disable-next-line no-process-env
export async function deploy(
  rpcEndPoint = 'http://localhost:' + process.env.GANACHE_PORT
): Promise<TestNetworkContext> {
  const provider = new providers.JsonRpcProvider(rpcEndPoint);

  const [testNitroAdjudicatorFactory, tokenFactory] = [
    TestNitroAdjudicatorArtifact,
    TokenArtifact,
  ].map(artifact =>
    new ContractFactory(artifact.abi, artifact.bytecode).connect(provider.getSigner(0))
  );

  const NITRO_ADJUDICATOR_ADDRESS = (await testNitroAdjudicatorFactory.deploy()).address;
  const ERC20_ADDRESS = (await tokenFactory.deploy(new Wallet(TEST_ACCOUNTS[0].privateKey).address))
    .address;

  return {
    NITRO_ADJUDICATOR_ADDRESS,
    ERC20_ADDRESS,
  };
}
