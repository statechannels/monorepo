const {GanacheDeployer, ETHERLIME_ACCOUNTS} = require('@statechannels/devtools');
const {Wallet} = require('ethers');

const countingAppArtifact = require('../artifacts/contracts/CountingApp.sol/CountingApp.json');
const erc20AssetHolderArtifact = require('../artifacts/contracts/test/TestErc20AssetHolder.sol/TestErc20AssetHolder.json');
const ethAssetHolderArtifact = require('../artifacts/contracts/test/TestEthAssetHolder.sol/TestEthAssetHolder.json');
const nitroAdjudicatorArtifact = require('../artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json');
const singleAssetPaymentsArtifact = require('../artifacts/contracts/examples/SingleAssetPayments.sol/SingleAssetPayments.json');
const testAssetHolderArtifact1 = require('../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json');
const testAssetHolderArtifact2 = require('../artifacts/contracts/test/TESTAssetHolder2.sol/TESTAssetHolder2.json');
const testForceMoveArtifact = require('../artifacts/contracts/test/TESTForceMove.sol/TESTForceMove.json');
const testNitroAdjudicatorArtifact = require('../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json');
const tokenArtifact = require('../artifacts/contracts/Token.sol/Token.json');
const trivialAppArtifact = require('../artifacts/contracts/TrivialApp.sol/TrivialApp.json');

const deploy = async () => {
  const deployer = new GanacheDeployer(Number(process.env.GANACHE_PORT));

  const NITRO_ADJUDICATOR_ADDRESS = await deployer.deploy(nitroAdjudicatorArtifact);

  const COUNTING_APP_ADDRESS = await deployer.deploy(countingAppArtifact);
  const SINGLE_ASSET_PAYMENT_ADDRESS = await deployer.deploy(singleAssetPaymentsArtifact);
  const TEST_NITRO_ADJUDICATOR_ADDRESS = await deployer.deploy(testNitroAdjudicatorArtifact);
  const TRIVIAL_APP_ADDRESS = await deployer.deploy(trivialAppArtifact);
  const TEST_FORCE_MOVE_ADDRESS = await deployer.deploy(testForceMoveArtifact);
  const TEST_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    testAssetHolderArtifact1,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  const TEST_ASSET_HOLDER2_ADDRESS = await deployer.deploy(
    testAssetHolderArtifact2,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );

  // for test purposes in this package, wire up the assetholders with the testNitroAdjudicator

  const TEST_TOKEN_ADDRESS = await deployer.deploy(
    tokenArtifact,
    {},
    new Wallet(ETHERLIME_ACCOUNTS[0].privateKey).address
  );
  const TEST_ETH_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    ethAssetHolderArtifact,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  const TEST_TOKEN_ASSET_HOLDER_ADDRESS = await deployer.deploy(
    erc20AssetHolderArtifact,
    {},
    TEST_NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS
  );
  return {
    NITRO_ADJUDICATOR_ADDRESS,
    COUNTING_APP_ADDRESS,
    SINGLE_ASSET_PAYMENT_ADDRESS,
    TRIVIAL_APP_ADDRESS,
    TEST_FORCE_MOVE_ADDRESS,
    TEST_NITRO_ADJUDICATOR_ADDRESS,
    TEST_TOKEN_ADDRESS,
    TEST_ETH_ASSET_HOLDER_ADDRESS,
    TEST_TOKEN_ASSET_HOLDER_ADDRESS,
    TEST_ASSET_HOLDER_ADDRESS,
    TEST_ASSET_HOLDER2_ADDRESS,
  };
};

module.exports = {
  deploy,
};