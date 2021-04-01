import {expectRevert} from '@statechannels/devtools';
import {Contract, BigNumber} from 'ethers';

import AssetHolderArtifact from '../../../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';
import {
  allocationToParams,
  getRandomNonce,
  getTestProvider,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContracts,
  writeGasConsumption,
} from '../../test-helpers';
import {encodeAllocation} from '../../../src/contract/outcome';

const provider = getTestProvider();

let AssetHolder: Contract;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
};

beforeAll(async () => {
  AssetHolder = await setupContracts(
    provider,
    AssetHolderArtifact,
    process.env.TEST_ASSET_HOLDER_ADDRESS
  );
});

const reason0 = 'h(allocation)!=assetOutcomeHash';
const reason1 = 'Indices must be sorted';

// c is the channel we are transferring from.
describe('transfer', () => {
  it.each`
    name                               | heldBefore | setOutcome            | indices      | newOutcome      | heldAfter       | payouts         | reason
    ${' 0. outcome not set         '}  | ${{c: 1}}  | ${{}}                 | ${[0]}       | ${{}}           | ${{}}           | ${{A: 1}}       | ${reason0}
    ${' 1. funded          -> 1 EOA'}  | ${{c: 1}}  | ${{A: 1}}             | ${[0]}       | ${{}}           | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 2. overfunded      -> 1 EOA'}  | ${{c: 2}}  | ${{A: 1}}             | ${[0]}       | ${{}}           | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 3. underfunded     -> 1 EOA'}  | ${{c: 1}}  | ${{A: 2}}             | ${[0]}       | ${{A: 1}}       | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 4. funded      -> 1 channel'}  | ${{c: 1}}  | ${{C: 1}}             | ${[0]}       | ${{}}           | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 5. overfunded  -> 1 channel'}  | ${{c: 2}}  | ${{C: 1}}             | ${[0]}       | ${{}}           | ${{c: 1, C: 1}} | ${{}}           | ${undefined}
    ${' 6. underfunded -> 1 channel'}  | ${{c: 1}}  | ${{C: 2}}             | ${[0]}       | ${{C: 1}}       | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 7. -> 2 EOA         1 index'}  | ${{c: 2}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}} | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 8. -> 2 EOA         1 index'}  | ${{c: 1}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}} | ${{c: 0}}       | ${{A: 1}}       | ${undefined}
    ${' 9. -> 2 EOA         partial'}  | ${{c: 3}}  | ${{A: 2, B: 2}}       | ${[1]}       | ${{A: 2, B: 1}} | ${{c: 2}}       | ${{B: 1}}       | ${undefined}
    ${'10. -> 2 chan             no'}  | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[1]}       | ${{C: 1, X: 1}} | ${{c: 1}}       | ${{}}           | ${undefined}
    ${'11. -> 2 chan           full'}  | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[0]}       | ${{C: 0, X: 1}} | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${'12. -> 2 chan        partial'}  | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1]}       | ${{C: 2, X: 1}} | ${{c: 2, X: 1}} | ${{}}           | ${undefined}
    ${'13. -> 2 indices'}              | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[0, 1]}    | ${{C: 0, X: 1}} | ${{c: 0, X: 1}} | ${{C: 2}}       | ${undefined}
    ${'14. -> 3 indices'}              | ${{c: 5}}  | ${{A: 1, C: 2, X: 2}} | ${[0, 1, 2]} | ${{}}           | ${{c: 0, X: 2}} | ${{A: 1, C: 2}} | ${undefined}
    ${'15. -> reverse order (see 13)'} | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1, 0]}    | ${{C: 2, X: 1}} | ${{c: 2, X: 1}} | ${{}}           | ${reason1}
  `(
    `$name: heldBefore: $heldBefore, setOutcome: $setOutcome, newOutcome: $newOutcome, heldAfter: $heldAfter, payouts: $payouts`,
    async ({name, heldBefore, setOutcome, indices, newOutcome, heldAfter, reason}) => {
      // Compute channelId
      const nonce = getRandomNonce(name);
      const channelId = randomChannelId(nonce);
      addresses.c = channelId;

      // Transform input data (unpack addresses and BigNumberify amounts)
      heldBefore = replaceAddressesAndBigNumberify(heldBefore, addresses);
      setOutcome = replaceAddressesAndBigNumberify(setOutcome, addresses);
      newOutcome = replaceAddressesAndBigNumberify(newOutcome, addresses);
      heldAfter = replaceAddressesAndBigNumberify(heldAfter, addresses);

      // Reset the holdings (only works on test contract)
      new Set([...Object.keys(heldAfter), ...Object.keys(heldBefore)]).forEach(async key => {
        // Key must be either in heldBefore or heldAfter or both
        const amount = heldBefore[key] ? heldBefore[key] : BigNumber.from(0);
        await (await AssetHolder.setHoldings(key, amount)).wait();
        expect((await AssetHolder.holdings(key)).eq(amount)).toBe(true);
      });

      // Compute an appropriate allocation.
      const allocation = [];
      Object.keys(setOutcome).forEach(key =>
        allocation.push({destination: key, amount: setOutcome[key]})
      );
      const [, assetOutcomeHash] = allocationToParams(allocation);

      // Set assetOutcomeHash
      await (
        await AssetHolder.setAssetOutcomeHashPermissionless(channelId, assetOutcomeHash)
      ).wait();
      expect(await AssetHolder.assetOutcomeHashes(channelId)).toBe(assetOutcomeHash);

      const tx = AssetHolder.transfer(channelId, encodeAllocation(allocation), indices);

      // Call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        const expectedEvents = [
          {
            event: 'AllocationUpdated',
            args: {channelId, initialHoldings: heldBefore[channelId]},
          },
        ];

        const {events: eventsFromTx, gasUsed} = await (await tx).wait();
        // NOTE: _transferAsset is a NOOP in TESTAssetHolder, so gas costs will be much lower than for a real Asset Holder
        await writeGasConsumption('transfer.gas.md', name, gasUsed);
        expect(eventsFromTx).toMatchObject(expectedEvents);
        // Check new holdings
        Object.keys(heldAfter).forEach(async key =>
          expect(await AssetHolder.holdings(key)).toEqual(heldAfter[key])
        );

        // Check new assetOutcomeHash
        const allocationAfter = [];
        Object.keys(newOutcome).forEach(key => {
          allocationAfter.push({destination: key, amount: newOutcome[key]});
        });
        const [, expectedNewOutcomeHash] = allocationToParams(allocationAfter);
        expect(await AssetHolder.assetOutcomeHashes(channelId)).toEqual(expectedNewOutcomeHash);
      }
    }
  );
});
