const path = require('path');
const writeJsonFile = require('write-json-file');

const testForceMoveArtifact = require('../build/contracts/TESTForceMove.json');
const testNitroAdjudicatorArtifact = require('../build/contracts/TESTNitroAdjudicator.json');
const testAssetHolderArtifact1 = require('../build/contracts/TESTAssetHolder.json');
const testAssetHolderArtifact2 = require('../build/contracts/TESTAssetHolder2.json');
const trivialAppArtifact = require('../build/contracts/TrivialApp.json');
const countingAppArtifact = require('../build/contracts/CountingApp.json');
const singleAssetPaymentsArtifact = require('../build/contracts/SingleAssetPayments.json');
const rockPaperScissorsArtifact = require('../build/contracts/RockPaperScissors.json');

const erc20AssetHolderArtifact = require('../build/contracts/ERC20AssetHolder.json');
const ethAssetHolderArtifact = require('../build/contracts/ETHAssetHolder.json');
const tokenArtifact = require('../build/contracts/Token.json');
const {migrate, migrationFactory, deploy} = require('./deploy');

async function deployTest(network, secret, etherscanApiKey) {
  let {networkMap, deployer, networkId} = await deploy(network, secret, etherscanApiKey);

  const startingMap = networkMap[networkId] || {};
  const contractsToAddresses = await migrate(deployer, startingMap, [
    migrationFactory(testNitroAdjudicatorArtifact),
    migrationFactory(ethAssetHolderArtifact, currentMap => [
      currentMap[testNitroAdjudicatorArtifact.contractName],
    ]),
    migrationFactory(erc20AssetHolderArtifact, currentMap => [
      currentMap[testNitroAdjudicatorArtifact.contractName],
      currentMap[tokenArtifact.contractName],
    ]),
    migrationFactory(testAssetHolderArtifact1),
    migrationFactory(testAssetHolderArtifact2),
    migrationFactory(trivialAppArtifact),
    migrationFactory(countingAppArtifact),
    migrationFactory(singleAssetPaymentsArtifact),
    migrationFactory(testForceMoveArtifact),
    migrationFactory(rockPaperScissorsArtifact),
  ]);

  networkMap = {
    ...networkMap,
    [networkId]: {...networkMap[networkId], ...contractsToAddresses},
  };
  await writeJsonFile(path.join(__dirname, 'network-map.json'), networkMap);
}

module.exports = {
  deploy: deployTest,
};
