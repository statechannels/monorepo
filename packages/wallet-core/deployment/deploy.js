/* eslint-disable @typescript-eslint/no-var-requires */
const {
  NitroAdjudicatorArtifact,
  TokenArtifact
} = require('@statechannels/nitro-protocol').ContractArtifacts;


const [
  nitroAdjudicatorFactory,
  tokenFactory
] = [
  NitroAdjudicatorArtifact,
  TokenArtifact
].map(artifact =>
  new ContractFactory(artifact.abi, artifact.bytecode).connect(provider.getSigner(0))
);

const deploy = async () => {
  const TRIVIAL_APP_ADDRESS = makeAddress(constants.AddressZero);

  const TRIVIAL_APP_ADDRESS = makeAddress(constants.AddressZero);

  const NITRO_ADJUDICATOR_ADDRESS = (await nitroAdjudicatorFactory.deploy()).address;

  const TEST_TOKEN_ADDRESS = (
    await tokenFactory.deploy(new Wallet(TEST_ACCOUNTS[0].privateKey).address)
  ).address;

  return {
    TRIVIAL_APP_ADDRESS,
    NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS
  };
};

module.exports = {
  deploy
};
