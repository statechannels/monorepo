import {Contract} from 'ethers';

import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import {Channel, getChannelId} from '../../../../src/contract/channel';
import {getRandomNonce, getTestProvider, setupContract} from '../../../test-helpers';

const provider = getTestProvider();
let AdjudicatorFactory: Contract;
const chainId = process.env.CHAIN_NETWORK_ID;
const participants: string[] = [];
beforeAll(async () => {
  AdjudicatorFactory = await setupContract(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
});

const channelNonce = getRandomNonce('deployAndPayout');
/**
 * We expect the gas cost of this call to be roughly as follows:
 * 21K base fee
 * 32K CREATE2 base fee (G_create)
 * G_codedeposit = 200 gas per byte of contract code  = 200 x 45 = 9K
 * G_sha3word = 6 x words_of_init_code = 12
 * so roughly 62000
 */
describe('deployAndPayout', () => {
  it('create2s the channel', async () => {
    const channel: Channel = {chainId, participants, channelNonce};
    const channelId = getChannelId(channel);
    const tx = AdjudicatorFactory.createChannel(channelId, {gasLimit: 3000000});

    const receipt = await (await tx).wait();

    console.log('gas used: ' + receipt.gasUsed);

    const channelAddress = await AdjudicatorFactory.getChannelAddress(channelId);
    const byteCode = await provider.getCode(channelAddress);
    // e.g. 0x363d3d373d3d3d363d73655341aabd39a5ee0939796df610ad685a984c535af43d82803e903d91602b57fd5bf3
    //      ......................address-of-master-copy-goes-in-thisspace..............................
    // See https://eips.ethereum.org/EIPS/eip-1167
    expect(byteCode).toHaveLength(92); // 90 hexits (45 bytes) plus the 0x prefix
    expect(receipt.gasUsed).toBeTruthy();
  });
});
