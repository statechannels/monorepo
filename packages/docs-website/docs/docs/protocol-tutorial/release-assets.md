---
id: release-assets
title: Release assets
---

If a channel has been finalized on chain, the adjudicator contract knows about the final outcome. This tutorial section covers releasing the assets.

## Using `transfer`

The `transfer` method pays out a given asset to a given set of destinations, according to outcomes that it knows about, if the channel is sufficiently funded.

```typescript
// In lesson14.test.ts
import {BigNumber, ethers} from 'ethers';
import {encodeAllocation} from '@statechannels/nitro-protocol';

const amount = '0x03';

const EOA = ethers.Wallet.createRandom().address;
const destination = hexZeroPad(EOA, 32);

const assetOutcome: AllocationAssetOutcome = {
  asset: MAGIC_ADDRESS_INDICATING_ETH,
  allocationItems: [{destination, amount}]
};
const outcomeBytes = encodeOutcome([
  {asset: MAGIC_ADDRESS_INDICATING_ETH, allocationItems: allocation},
]);

// Following earlier tutorials ...
// tx0 fund a channel
// tx1 conclude this channel with this outcome
// ...

const assetIndex = 0; // implies we are paying out the 0th asset (in this case the only asset, ETH)
const stateHash = constants.HashZero; // if the channel was concluded on the happy path, we can use this default value
const challengerAddress = constants.AddressZero; // if the channel was concluded on the happy path, we can use this default value
const indices = []; // this magic value (a zero length array) implies we want to pay out all of the allocationItems (in this case there is only one)

const tx2 = NitroAdjudicator.transfer(assetIndex, channelId, outcomeBytes, stateHash, challengerAddress, indices);

/*
  Check that a AllocationUpdated event was emitted.
*/
const {events} = await(await tx3).wait();
expect(events).toMatchObject(
  {
    event: 'AllocationUpdated',
  },
]);

expect(BigNumber.from(await provider.getBalance(EOA)).eq(BigNumber.from(amount)));
```

:::tip
If the destination specified in the outcome is external, the assets are paid out (as in the example above). Otherwise the destination is a channel id, and the contract updates its internal accounting such that this channel has its direct funding increased.
:::

:::tip
This method executes payouts that might benefit multiple participants. If multiple actors try and call this method, after the first transaction is confirmed the remaining ones may fail.
:::

:::tip
It may be desirable to payout to a subset of destinations (or even a single one). The `transfer` method can be used to do this, and accepts a list of `indices` to transfer from. See the contract API for more information. More information coming soon, including how to track the updated allocation after a `transfer` is mined.
:::

## Using `claim`

The `claim` method will pay out a particular asset held against a guarantor channel, according to a _target_ channel's outcome (and the specified allocation items) but with an preference order controlled by the guarantor channel. The API is otherwise similar to `transfer`, only metadata about both channels must be supplied.

```typescript
// In lesson15.test.ts

const amount = '0x03';
const EOA1 = ethers.Wallet.createRandom().address;
const EOA2 = ethers.Wallet.createRandom().address;
const destination1 = hexZeroPad(EOA1, 32);
const destination2 = hexZeroPad(EOA2, 32);

const assetOutcomeForTheTargetChannel: AllocationAssetOutcome = {
  asset: MAGIC_ADDRESS_INDICATING_ETH,
  allocationItems: [
    {destination: destination1, amount},
    {destination: destination2, amount}
  ]
};

const assetOutcomeForTheGuarantorChannel: GuaranteeAssetOutcome = {
  asset: MAGIC_ADDRESS_INDICATING_ETH,
  guarantee: {
    targetChannelId: targetChannelId,
    destinations: [
      destination2,
      destination1 // Note reversed order
    ]
  }
};

const targetOutcomeBytes = encodeOutcome([assetOutcomeForTheTargetChannel]);
const guarantorOutcomeBytes = encodeOutcome([assetOutcomeForTheGuarantorChannel]);

// Following earlier tutorials ...
// tx0 finalize a channel that allocates to Alice then Bob
// tx1 finalize a guarantor channel that targets the first channel
// and reprioritizes Bob over Alice
// tx2 fund the _guarantor_ channel, not the target channel
// with a deposit that only covers one of the payouts
// check that Bob got his payout
// ...

/*
    Submit claimAll transaction
  */

const assetIndex = 0; // implies we are paying out the 0th asset (in this case the only asset, ETH)
const stateHash = (targetStateHash = constants.HashZero); // if the channels were concluded on the happy path, we can use this default value
const challengerAddress = (targetChallengerAddress = constants.AddressZero); // if the channels were concluded on the happy path, we can use this default value
const indices = []; // this magic value (a zero length array) implies we want to pay out all of the allocationItems (in this case there is only one)

const tx3 = NitroAdjudicator.claim(
  assetIndex,
  guarantorId,
  guarantorOutcomeBytes,
  stateHash,
  challengerAddress,
  targetOutcomeBytes,
  targetStateHash,
  targetChallengerAddress,
  indices
);

await(await tx3).wait();
/* 
  Check that the ethereum account balance was updated
*/
expect(BigNumber.from(await provider.getBalance(EOA2)).eq(BigNumber.from(amount)));
```

If this process seems overly complicated to you: remember that guarantor channels are only required when virtually funding a channel. Also bear in mind that this process is unlinkely to actually play out on chain very often: it is in everyone's interest to administrate inter-channel funding off chain as much as possible, with the on chain administration such as this used as a last resort.

## Using `transferAllAssets`

If we wish to liquidate all assets from a channel, it is more convenient to use the `transferAllAssets` method, which will do this in a gas efficient manner.

## Using `concludeAndTransferAllAssets`

If we have a finalization proof, then we can call `concludeAndTransferAllAssets` to do the channel conclusion and payouts for all assets in one transaction.
