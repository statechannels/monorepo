import {expectRevert} from '@statechannels/devtools';
import {Contract} from 'ethers';
import {bigNumberify, id} from 'ethers/utils';
// @ts-ignore
import AssetHolderArtifact from '../../../build/contracts/TESTAssetHolder.json';
import {claimAllArgs} from '../../../src/contract/transaction-creators/asset-holder';
import {
  allocationToParams,
  getTestProvider,
  guaranteeToParams,
  newAssetTransferredEvent,
  randomChannelId,
  randomExternalAddress,
  replaceAddresses,
  setupContracts,
} from '../../test-helpers';

const provider = getTestProvider();
const addresses = {
  // channels
  t: undefined, // target
  g: undefined, // guarantor
  // externals
  I: randomExternalAddress(),
  A: randomExternalAddress(),
  B: randomExternalAddress(),
};
let AssetHolder: Contract;

beforeAll(async () => {
  AssetHolder = await setupContracts(provider, AssetHolderArtifact);
});

const reason5 =
  'claimAll | submitted data does not match outcomeHash stored against targetChannelId';
const reason6 =
  'claimAll | submitted data does not match outcomeHash stored against guarantorChannelId';

// 1. claim G1 (step 1 of figure 23 of nitro paper)
// 2. claim G2 (step 2 of figure 23 of nitro paper)
// 3. claim G1 (step 1 of alternative in figure 23 of nitro paper)
// 4. claim G2 (step 2 of alternative of figure 23 of nitro paper)

// amounts are valueString representations of wei
describe('claimAll', () => {
  it.each`
    name                                               | heldBefore | guaranteeDestinations | tOutcomeBefore        | tOutcomeAfter   | heldAfter | payouts         | reason
    ${'1. straight-through guarantee, 3 destinations'} | ${{g: 5}}  | ${['I', 'A', 'B']}    | ${{I: 5, A: 5, B: 5}} | ${{A: 5, B: 5}} | ${{g: 0}} | ${{I: 5}}       | ${undefined}
    ${'2. swap guarantee,             2 destinations'} | ${{g: 5}}  | ${['B', 'A']}         | ${{A: 5, B: 5}}       | ${{A: 5}}       | ${{g: 0}} | ${{B: 5}}       | ${undefined}
    ${'3. swap guarantee,             3 destinations'} | ${{g: 5}}  | ${['I', 'B', 'A']}    | ${{I: 5, A: 5, B: 5}} | ${{A: 5, B: 5}} | ${{g: 0}} | ${{I: 5}}       | ${undefined}
    ${'4. straight-through guarantee, 2 destinations'} | ${{g: 5}}  | ${['A', 'B']}         | ${{A: 5, B: 5}}       | ${{B: 5}}       | ${{g: 0}} | ${{A: 5}}       | ${undefined}
    ${'5. allocation not on chain'}                    | ${{g: 5}}  | ${['B', 'A']}         | ${{}}                 | ${{A: 5}}       | ${{g: 0}} | ${{B: 5}}       | ${reason5}
    ${'6. guarantee not on chain'}                     | ${{g: 5}}  | ${[]}                 | ${{A: 5, B: 5}}       | ${{A: 5}}       | ${{g: 0}} | ${{B: 5}}       | ${reason6}
    ${'7. swap guarantee, overfunded, 2 destinations'} | ${{g: 12}} | ${['B', 'A']}         | ${{A: 5, B: 5}}       | ${{}}           | ${{g: 2}} | ${{A: 5, B: 5}} | ${undefined}
    ${'8. underspecified guarantee, overfunded      '} | ${{g: 12}} | ${['B']}              | ${{A: 5, B: 5}}       | ${{}}           | ${{g: 2}} | ${{A: 5, B: 5}} | ${undefined}
  `(
    '$name',
    async ({
      name,
      heldBefore,
      guaranteeDestinations,
      tOutcomeBefore,
      tOutcomeAfter,
      heldAfter,
      payouts,
      reason,
    }) => {
      // compute channelIds
      const tNonce = bigNumberify(id(name))
        .maskn(30)
        .toNumber();
      const gNonce = bigNumberify(id(name + 'g'))
        .maskn(30)
        .toNumber();
      const targetId = randomChannelId(tNonce);
      const guarantorId = randomChannelId(gNonce);
      addresses.t = targetId;
      addresses.g = guarantorId;

      // transform input data (unpack addresses and BigNumberify amounts)
      heldBefore = replaceAddresses(heldBefore, addresses);
      tOutcomeBefore = replaceAddresses(tOutcomeBefore, addresses);
      tOutcomeAfter = replaceAddresses(tOutcomeAfter, addresses);
      heldAfter = replaceAddresses(heldAfter, addresses);
      payouts = replaceAddresses(payouts, addresses);
      guaranteeDestinations = guaranteeDestinations.map(x => addresses[x]);

      // set holdings (only works on test contract)
      new Set([...Object.keys(heldAfter), ...Object.keys(heldBefore)]).forEach(async key => {
        // key must be either in heldBefore or heldAfter or both
        const amount = heldBefore[key] ? heldBefore[key] : bigNumberify(0);
        await (await AssetHolder.setHoldings(key, amount)).wait();
        expect((await AssetHolder.holdings(key)).eq(amount)).toBe(true);
      });

      // compute an appropriate allocation.
      const allocation = [];
      Object.keys(tOutcomeBefore).forEach(key =>
        allocation.push({destination: key, amount: tOutcomeBefore[key]})
      );
      const [, outcomeHash] = allocationToParams(allocation);

      // set outcomeHash for target
      await (await AssetHolder.setAssetOutcomeHashPermissionless(targetId, outcomeHash)).wait();
      expect(await AssetHolder.outcomeHashes(targetId)).toBe(outcomeHash);

      // compute an appropriate guarantee

      const guarantee = {
        destinations: guaranteeDestinations,
        targetChannelId: targetId,
      };

      if (guaranteeDestinations.length > 0) {
        const [, gOutcomeContentHash] = guaranteeToParams(guarantee);

        // set outcomeHash for guarantor
        await (await AssetHolder.setAssetOutcomeHashPermissionless(
          guarantorId,
          gOutcomeContentHash
        )).wait();
        expect(await AssetHolder.outcomeHashes(guarantorId)).toBe(gOutcomeContentHash);
      }

      const tx = AssetHolder.claimAll(...claimAllArgs(guarantorId, guarantee, allocation));

      // call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        const {events}: {events: any[]} = await (await tx).wait();
        const given = {};
        events.map(({topics, args}) => (given[topics[1]] = args));

        const expected = {};
        Object.keys(payouts).map(destination => {
          const payout = payouts[destination];
          if (payout.gt(0)) {
            expected[destination] = newAssetTransferredEvent(destination, payout);
          }
        });

        expect(given).toMatchObject(expected);

        // check new holdings
        Object.keys(heldAfter).forEach(async key =>
          expect(await AssetHolder.holdings(key)).toEqual(heldAfter[key])
        );

        // check new outcomeHash
        const allocationAfter = [];
        Object.keys(tOutcomeAfter).forEach(key => {
          allocationAfter.push({destination: key, amount: tOutcomeAfter[key]});
        });
        const [, expectedNewOutcomeHash] = allocationToParams(allocationAfter);
        expect(await AssetHolder.outcomeHashes(targetId)).toEqual(expectedNewOutcomeHash);
      }
    }
  );
});
