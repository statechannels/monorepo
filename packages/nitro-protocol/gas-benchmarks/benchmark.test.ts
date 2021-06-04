import {channelId} from './fixtures';
import {gasRequiredTo} from './gas';
import {erc20AssetHolder, ethAssetHolder, nitroAdjudicator, token} from './vanillaSetup';

describe('Consumes the expected gas', () => {
  it(`when deploying the NitroAdjudicator >>>>>  ${gasRequiredTo.deployInfrastructureContracts.vanillaNitro.NitroAdjudicator} gas`, async () => {
    const {gasUsed} = await nitroAdjudicator.deployTransaction.wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.deployInfrastructureContracts.vanillaNitro.NitroAdjudicator
    );
  });
  it(`when deploying the ETHAssetHolder >>>>>  ${gasRequiredTo.deployInfrastructureContracts.vanillaNitro.ETHAssetHolder} gas`, async () => {
    const {gasUsed} = await ethAssetHolder.deployTransaction.wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.deployInfrastructureContracts.vanillaNitro.ETHAssetHolder
    );
  });
  it(`when deploying the ERC20AssetHolder >>>>>  ${gasRequiredTo.deployInfrastructureContracts.vanillaNitro.ERC20AssetHolder} gas`, async () => {
    const {gasUsed} = await erc20AssetHolder.deployTransaction.wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.deployInfrastructureContracts.vanillaNitro.ERC20AssetHolder
    );
  });
  it(`when directly funding a channel with ETH (first deposit) >>>>>  ${gasRequiredTo.directlyFundAChannelWithETHFirst.vanillaNitro} gas`, async () => {
    const tx = ethAssetHolder.deposit(channelId, 0, 5, {value: 5});
    const {gasUsed} = await (await tx).wait();
    expect(gasUsed.toNumber()).toEqual(gasRequiredTo.directlyFundAChannelWithETHFirst.vanillaNitro);
  });
  it(`when directly funding a channel with ETH (second deposit) >>>>> ${gasRequiredTo.directlyFundAChannelWithETHSecond.vanillaNitro} gas`, async () => {
    // begin setup
    const setupTX = ethAssetHolder.deposit(channelId, 0, 5, {value: 5});
    await (await setupTX).wait();
    // end setup
    const tx = ethAssetHolder.deposit(channelId, 5, 5, {value: 5});
    const {gasUsed} = await (await tx).wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.directlyFundAChannelWithETHSecond.vanillaNitro
    );
  });
  it(`when directly funding a channel with an ERC20 (first deposit)`, async () => {
    // begin setup
    await (await token.transfer(erc20AssetHolder.address, 1)).wait(); // The asset holder already has some tokens (for other channels)
    // end setup
    const {gasUsed: gasUsedToApprove} = await (
      await token.increaseAllowance(erc20AssetHolder.address, 100)
    ).wait();
    expect(gasUsedToApprove.toNumber()).toEqual(
      gasRequiredTo.directlyFundAChannelWithERC20First.vanillaNitro.approve
    );
    const tx = erc20AssetHolder.deposit(channelId, 0, 5);
    const {gasUsed} = await (await tx).wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.directlyFundAChannelWithERC20First.vanillaNitro.deposit
    );
  });
  it(`when directly funding a channel with an ERC20 (second deposit)`, async () => {
    // begin setup
    await (await token.increaseAllowance(erc20AssetHolder.address, 100)).wait();
    await (await erc20AssetHolder.deposit(channelId, 0, 5)).wait(); // The asset holder already has some tokens *for this channel*
    await (await token.decreaseAllowance(erc20AssetHolder.address, 95)).wait(); // reset allowance to zero
    // end setup
    const {gasUsed: gasUsedToApprove} = await (
      await token.increaseAllowance(erc20AssetHolder.address, 100)
    ).wait();
    expect(gasUsedToApprove.toNumber()).toEqual(
      gasRequiredTo.directlyFundAChannelWithERC20Second.vanillaNitro.approve
    );
    const tx = erc20AssetHolder.deposit(channelId, 5, 5);
    const {gasUsed} = await (await tx).wait();
    expect(gasUsed.toNumber()).toEqual(
      gasRequiredTo.directlyFundAChannelWithERC20Second.vanillaNitro.deposit
    );
  });
});