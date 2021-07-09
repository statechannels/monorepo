import {expectRevert} from '@statechannels/devtools';
import {BigNumber, constants, Contract} from 'ethers';

import {
  getRandomNonce,
  getTestProvider,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContract,
} from '../../test-helpers';
import {encodeOutcome, hashOutcome, Outcome} from '../../../src/contract/outcome';
import {TESTNitroAdjudicator} from '../../../typechain/TESTNitroAdjudicator';
// eslint-disable-next-line import/order
import TESTNitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import {channelDataToStatus} from '../../../src';
import {MAGIC_ADDRESS_INDICATING_ETH} from '../../../src/transactions';

const testNitroAdjudicator = (setupContract(
  getTestProvider(),
  TESTNitroAdjudicatorArtifact,
  process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
) as unknown) as TESTNitroAdjudicator & Contract;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
};

const reason0 = 'Channel not finalized';
const reason1 = 'Indices must be sorted';
const reason2 = 'incorrect fingerprint';

// c is the channel we are transferring from.
describe('transfer', () => {
  it.each`
    name                                   | heldBefore | setOutcome            | indices      | newOutcome            | heldAfter       | payouts         | reason
    ${' 0. channel not finalized        '} | ${{c: 1}}  | ${{}}                 | ${[0]}       | ${{}}                 | ${{}}           | ${{A: 1}}       | ${reason0}
    ${' 1. funded          -> 1 EOA'}      | ${{c: 1}}  | ${{A: 1}}             | ${[0]}       | ${{A: 0}}             | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 2. overfunded      -> 1 EOA'}      | ${{c: 2}}  | ${{A: 1}}             | ${[0]}       | ${{A: 0}}             | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 3. underfunded     -> 1 EOA'}      | ${{c: 1}}  | ${{A: 2}}             | ${[0]}       | ${{A: 1}}             | ${{}}           | ${{A: 1}}       | ${undefined}
    ${' 4. funded      -> 1 channel'}      | ${{c: 1}}  | ${{C: 1}}             | ${[0]}       | ${{C: 0}}             | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 5. overfunded  -> 1 channel'}      | ${{c: 2}}  | ${{C: 1}}             | ${[0]}       | ${{C: 0}}             | ${{c: 1, C: 1}} | ${{}}           | ${undefined}
    ${' 6. underfunded -> 1 channel'}      | ${{c: 1}}  | ${{C: 2}}             | ${[0]}       | ${{C: 1}}             | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${' 7. -> 2 EOA         1 index'}      | ${{c: 2}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}}       | ${{c: 1}}       | ${{A: 1}}       | ${undefined}
    ${' 8. -> 2 EOA         1 index'}      | ${{c: 1}}  | ${{A: 1, B: 1}}       | ${[0]}       | ${{A: 0, B: 1}}       | ${{c: 0}}       | ${{A: 1}}       | ${undefined}
    ${' 9. -> 2 EOA         partial'}      | ${{c: 3}}  | ${{A: 2, B: 2}}       | ${[1]}       | ${{A: 2, B: 1}}       | ${{c: 2}}       | ${{B: 1}}       | ${undefined}
    ${'10. -> 2 chan             no'}      | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[1]}       | ${{C: 1, X: 1}}       | ${{c: 1}}       | ${{}}           | ${undefined}
    ${'11. -> 2 chan           full'}      | ${{c: 1}}  | ${{C: 1, X: 1}}       | ${[0]}       | ${{C: 0, X: 1}}       | ${{c: 0, C: 1}} | ${{}}           | ${undefined}
    ${'12. -> 2 chan        partial'}      | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1]}       | ${{C: 2, X: 1}}       | ${{c: 2, X: 1}} | ${{}}           | ${undefined}
    ${'13. -> 2 indices'}                  | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[0, 1]}    | ${{C: 0, X: 1}}       | ${{c: 0, X: 1}} | ${{C: 2}}       | ${undefined}
    ${'14. -> 3 indices'}                  | ${{c: 5}}  | ${{A: 1, C: 2, X: 2}} | ${[0, 1, 2]} | ${{A: 0, C: 0, X: 0}} | ${{c: 0, X: 2}} | ${{A: 1, C: 2}} | ${undefined}
    ${'15. -> reverse order (see 13)'}     | ${{c: 3}}  | ${{C: 2, X: 2}}       | ${[1, 0]}    | ${{C: 2, X: 1}}       | ${{c: 2, X: 1}} | ${{}}           | ${reason1}
    ${'16. incorrect fingerprint        '} | ${{c: 1}}  | ${{}}                 | ${[0]}       | ${{}}                 | ${{}}           | ${{A: 1}}       | ${reason2}
  `(
    `$name: heldBefore: $heldBefore, setOutcome: $setOutcome, newOutcome: $newOutcome, heldAfter: $heldAfter, payouts: $payouts`,
    async ({name, heldBefore, setOutcome, indices, newOutcome, heldAfter, reason}) => {
      // Compute channelId
      const nonce = getRandomNonce(name);
      addresses.c = randomChannelId(nonce);
      const channelId = addresses.c;
      addresses.C = randomChannelId(nonce + 1);
      addresses.X = randomChannelId(nonce + 2);
      // Transform input data (unpack addresses and BigNumberify amounts)
      heldBefore = replaceAddressesAndBigNumberify(heldBefore, addresses);
      setOutcome = replaceAddressesAndBigNumberify(setOutcome, addresses);
      newOutcome = replaceAddressesAndBigNumberify(newOutcome, addresses);
      heldAfter = replaceAddressesAndBigNumberify(heldAfter, addresses);

      // Deposit into channels

      await Promise.all(
        Object.keys(heldBefore).map(async key => {
          // Key must be either in heldBefore or heldAfter or both
          const amount = heldBefore[key];
          await (
            await testNitroAdjudicator.deposit(MAGIC_ADDRESS_INDICATING_ETH, key, 0, amount, {
              value: amount,
            })
          ).wait();
          expect(
            (await testNitroAdjudicator.holdings(MAGIC_ADDRESS_INDICATING_ETH, key)).eq(amount)
          ).toBe(true);
        })
      );

      // Compute an appropriate allocation.
      const allocation = [];
      Object.keys(setOutcome).forEach(key =>
        allocation.push({destination: key, amount: setOutcome[key]})
      );
      const outcomeHash = hashOutcome([
        {asset: MAGIC_ADDRESS_INDICATING_ETH, allocationItems: allocation},
      ]);
      const outcomeBytes = encodeOutcome([
        {asset: MAGIC_ADDRESS_INDICATING_ETH, allocationItems: allocation},
      ]);

      // Set adjudicator status
      const stateHash = constants.HashZero; // not realistic, but OK for purpose of this test
      const challengerAddress = constants.AddressZero; // not realistic, but OK for purpose of this test
      const finalizesAt = 42;
      const turnNumRecord = 7;

      if (reason != 'Channel not finalized') {
        await (
          await testNitroAdjudicator.setStatusFromChannelData(channelId, {
            turnNumRecord,
            finalizesAt,
            stateHash,
            challengerAddress,
            outcomeHash,
          })
        ).wait();
      }

      const tx = testNitroAdjudicator.transfer(
        MAGIC_ADDRESS_INDICATING_ETH,
        channelId,
        reason == 'incorrect fingerprint' ? '0xdeadbeef' : outcomeBytes,
        stateHash,
        challengerAddress,
        indices
      );

      // Call method in a slightly different way if expecting a revert
      if (reason) {
        await expectRevert(() => tx, reason);
      } else {
        const {events: eventsFromTx} = await (await tx).wait();
        // Check new holdings
        await Promise.all(
          Object.keys(heldAfter).map(async key =>
            expect(await testNitroAdjudicator.holdings(MAGIC_ADDRESS_INDICATING_ETH, key)).toEqual(
              heldAfter[key]
            )
          )
        );

        // Check new status
        const allocationAfter = [];
        Object.keys(newOutcome).forEach(key => {
          allocationAfter.push({destination: key, amount: newOutcome[key]});
        });
        const outcomeAfter: Outcome = [
          {asset: MAGIC_ADDRESS_INDICATING_ETH, allocationItems: allocationAfter},
        ];
        const expectedStatusAfter = channelDataToStatus({
          turnNumRecord,
          finalizesAt,
          // stateHash will be set to HashZero by this helper fn
          // if state property of this object is undefined
          challengerAddress,
          outcome: outcomeAfter,
        });
        expect(await testNitroAdjudicator.statusOf(channelId)).toEqual(expectedStatusAfter);

        const expectedEvents = [
          {
            event: 'AllocationUpdated',
            args: {
              channelId,
              assetIndex: BigNumber.from(0),
              initialHoldings: heldBefore[addresses.c],
            },
          },
        ];

        expect(eventsFromTx).toMatchObject(expectedEvents);

        // TODO check payouts are executed properly
      }
    }
  );
});
