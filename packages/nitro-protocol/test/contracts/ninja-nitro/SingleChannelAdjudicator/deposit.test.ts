import {Contract, BigNumber} from 'ethers';

import AdjudicatorFactoryArtifact from '../../../../artifacts/contracts/ninja-nitro/AdjudicatorFactory.sol/AdjudicatorFactory.json';
import TokenArtifact from '../../../../artifacts/contracts/Token.sol/Token.json';
import {getTestProvider, randomChannelId, setupContract} from '../../../test-helpers';

const provider = getTestProvider();
let AdjudicatorFactory: Contract;
let Token: Contract;

beforeAll(async () => {
  AdjudicatorFactory = await setupContract(
    provider,
    AdjudicatorFactoryArtifact,
    process.env.ADJUDICATOR_FACTORY_ADDRESS
  );
  Token = await setupContract(provider, TokenArtifact, process.env.TEST_TOKEN_ADDRESS);
});

describe('deposit ETH', () => {
  it('before contract deployed', async () => {
    const channelId = randomChannelId();
    const channelAddress = await AdjudicatorFactory.getChannelAddress(channelId);
    await (
      await provider.getSigner().sendTransaction({
        to: channelAddress,
        value: 5,
      })
    ).wait();

    expect((await provider.getBalance(channelAddress)).eq(BigNumber.from(5))).toBe(true);
  });
  it('after contract deployed', async () => {
    const channelId = randomChannelId();
    const channelAddress = await AdjudicatorFactory.getChannelAddress(channelId);
    await (await AdjudicatorFactory.createChannel(channelId)).wait();
    await (
      await provider.getSigner().sendTransaction({
        to: channelAddress,
        value: 5,
      })
    ).wait();

    expect((await provider.getBalance(channelAddress)).eq(BigNumber.from(5))).toBe(true);
  });
});

describe('deposit ERC20 Tokens', () => {
  it('before contract deployed', async () => {
    const channelId = randomChannelId();
    const channelAddress = await AdjudicatorFactory.getChannelAddress(channelId);
    await (await Token.transfer(channelAddress, 6)).wait();

    expect((await Token.balanceOf(channelAddress)).eq(BigNumber.from(6))).toBe(true);
  });
  it('after contract deployed', async () => {
    const channelId = randomChannelId();
    const channelAddress = await AdjudicatorFactory.getChannelAddress(channelId);
    await (await AdjudicatorFactory.createChannel(channelId)).wait();
    await (await Token.transfer(channelAddress, 6)).wait();

    expect((await Token.balanceOf(channelAddress)).eq(BigNumber.from(6))).toBe(true);
  });
});
