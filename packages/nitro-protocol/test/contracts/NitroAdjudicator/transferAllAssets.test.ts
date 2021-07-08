import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet, constants} from 'ethers';

import {Channel, getChannelId} from '../../../src/contract/channel';
import {
  AllocationAssetOutcome,
  encodeOutcome,
  hashOutcome,
  Outcome,
} from '../../../src/contract/outcome';
import {
  computeOutcome,
  getRandomNonce,
  getTestProvider,
  OutcomeShortHand,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  setupContract,
} from '../../test-helpers';
import {TESTNitroAdjudicator} from '../../../typechain/TESTNitroAdjudicator';
import {Token} from '../../../typechain/Token';
import TokenArtifact from '../../../artifacts/contracts/Token.sol/Token.json';
// eslint-disable-next-line import/order
import TESTNitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import {channelDataToStatus, convertBytes32ToAddress} from '../../../src';
import {MAGIC_ADDRESS_INDICATING_ETH} from '../../../src/transactions';

const testNitroAdjudicator = (setupContract(
  getTestProvider(),
  TESTNitroAdjudicatorArtifact,
  process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
) as unknown) as TESTNitroAdjudicator & Contract;

const token = (setupContract(
  getTestProvider(),
  TokenArtifact,
  process.env.TEST_TOKEN_ADDRESS
) as unknown) as Token & Contract;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
  ETH: MAGIC_ADDRESS_INDICATING_ETH,
  ERC20: token.address,
};

// Constants for this test suite

const chainId = process.env.CHAIN_NETWORK_ID;
const participants = ['', '', ''];
const wallets = new Array(3);

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}

const description =
  'testNitroAdjudicator accepts a transferAllAssets tx for a finalized channel, and 2x Asset types transferred';
const channelNonce = getRandomNonce('transferAllAssets');

describe('transferAllAssets', () => {
  it.each`
    description    | setOutcome                      | heldBefore                      | newOutcome                      | heldAfter                       | payouts                         | reasonString
    ${description} | ${{ETH: {A: 1}, ERC20: {A: 2}}} | ${{ETH: {c: 1}, ERC20: {c: 2}}} | ${{ETH: {A: 0}, ERC20: {A: 0}}} | ${{ETH: {c: 0}, ERC20: {c: 0}}} | ${{ETH: {A: 1}, ERC20: {A: 2}}} | ${undefined}
  `(
    '$description', // For the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({
      setOutcome,
      heldBefore,
      newOutcome,
      heldAfter,
      payouts,
      reasonString,
    }: {
      setOutcome: OutcomeShortHand;
      heldBefore: OutcomeShortHand;
      newOutcome: OutcomeShortHand;
      heldAfter: OutcomeShortHand;
      payouts: OutcomeShortHand;
      reasonString: string;
    }) => {
      const channel: Channel = {chainId, channelNonce, participants};
      const channelId = getChannelId(channel);
      addresses.c = channelId;

      // Transform input data (unpack addresses and BigNumberify amounts)
      [heldBefore, setOutcome, newOutcome, heldAfter, payouts] = [
        heldBefore,
        setOutcome,
        newOutcome,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses) as OutcomeShortHand);

      // Deposit into channels
      await Promise.all(
        // For each asset
        Object.keys(heldBefore).map(async asset => {
          await Promise.all(
            Object.keys(heldBefore[asset]).map(async destination => {
              // for each channel
              const amount = heldBefore[asset][destination];
              if (asset != MAGIC_ADDRESS_INDICATING_ETH) {
                // Increase allowance
                await (await token.increaseAllowance(testNitroAdjudicator.address, amount)).wait(); // Approve enough for setup and main test
              }
              await (
                await testNitroAdjudicator.deposit(asset, destination, 0, amount, {
                  value: asset == MAGIC_ADDRESS_INDICATING_ETH ? amount : 0,
                })
              ).wait();
              expect((await testNitroAdjudicator.holdings(asset, destination)).eq(amount)).toBe(
                true
              );
            })
          );
        })
      );

      // Compute the outcome.
      const outcome: AllocationAssetOutcome[] = computeOutcome(setOutcome);
      const outcomeHash = hashOutcome(outcome);
      // Call public wrapper to set state (only works on test contract)
      const stateHash = constants.HashZero;
      const challengerAddress = constants.AddressZero;
      const finalizesAt = 42;
      const turnNumRecord = 7;
      await (
        await testNitroAdjudicator.setStatusFromChannelData(channelId, {
          turnNumRecord,
          finalizesAt,
          stateHash,
          challengerAddress,
          outcomeHash,
        })
      ).wait();
      const encodedOutcome = encodeOutcome(outcome);

      const tx1 = testNitroAdjudicator.transferAllAssets(
        channelId,
        encodedOutcome,
        stateHash,
        challengerAddress
      );

      // Call method in a slightly different way if expecting a revert
      if (reasonString) {
        const regex = new RegExp(
          '^' + 'VM Exception while processing transaction: revert ' + reasonString + '$'
        );
        await expectRevert(() => tx1, regex);
      } else {
        const {events: eventsFromTx} = await (await tx1).wait();

        // we expect a single FingerprintUpdated event.
        expect(eventsFromTx[0].event).toEqual('FingerprintUpdated');

        // Check new status
        const outcomeAfter: Outcome = computeOutcome(newOutcome);
        const expectedStatusAfter = channelDataToStatus({
          turnNumRecord,
          finalizesAt,
          // stateHash will be set to HashZero by this helper fn
          // if state property of this object is undefined
          challengerAddress,
          outcome: outcomeAfter,
        });
        expect(await testNitroAdjudicator.statusOf(channelId)).toEqual(expectedStatusAfter);

        // Check payouts
        await Promise.all(
          // For each asset
          Object.keys(payouts).map(async asset => {
            await Promise.all(
              Object.keys(payouts[asset]).map(async destination => {
                const address = convertBytes32ToAddress(destination);
                // for each channel
                const amount = payouts[asset][destination];
                if (asset != MAGIC_ADDRESS_INDICATING_ETH) {
                  expect((await token.balanceOf(address)).eq(amount)).toBe(true);
                } else {
                  expect((await getTestProvider().getBalance(address)).eq(amount)).toBe(true);
                }
              })
            );
          })
        );

        // Check new holdings
        await Promise.all(
          // For each asset
          Object.keys(heldAfter).map(async asset => {
            await Promise.all(
              Object.keys(heldAfter[asset]).map(async destination => {
                // for each channel
                const amount = heldAfter[asset][destination];
                expect((await testNitroAdjudicator.holdings(asset, destination)).eq(amount)).toBe(
                  true
                );
              })
            );
          })
        );
      }
    }
  );
});
