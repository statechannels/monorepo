import {Contract, Wallet, utils} from 'ethers';
const {id, keccak256} = utils;

import AssetHolderArtifact from '../../../artifacts/contracts/ETHAssetHolder.sol/ETHAssetHolder.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {getRandomNonce, getTestProvider, setupContract} from '../../test-helpers';

const provider = getTestProvider();
let AssetHolder: Contract;
let channelId;

const participants = ['', '', ''];
const wallets = new Array(3);
const chainId = process.env.CHAIN_NETWORK_ID;
const channelNonce = getRandomNonce('setOutcome');
const outcomeContent = id('some outcome data');

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}

beforeAll(async () => {
  AssetHolder = setupContract(provider, AssetHolderArtifact, process.env.ETH_ASSET_HOLDER_ADDRESS);
  const channel: Channel = {chainId, participants, channelNonce};
  channelId = getChannelId(channel);
});

describe('setOutcome', () => {
  it('Reverts when called directly from an EOA', async () => {
    const reasonString = 'Only NitroAdjudicator authorized';
    const regex = new RegExp(
      '(' + 'VM Exception while processing transaction: revert ' + reasonString + ')'
    );
    await expect(
      AssetHolder.setAssetOutcomeHash(channelId, keccak256(outcomeContent))
    ).rejects.toThrow(regex);
  });
});
