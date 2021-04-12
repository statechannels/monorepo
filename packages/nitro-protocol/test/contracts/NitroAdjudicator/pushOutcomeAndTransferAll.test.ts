import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet, ethers} from 'ethers';

import AssetHolderArtifact from '../../../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';
import NitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {AllocationAssetOutcome, encodeOutcome} from '../../../src/contract/outcome';
import {hashState, State} from '../../../src/contract/state';
import {
  checkMultipleAssetOutcomeHashes,
  checkMultipleHoldings,
  compileEventsFromLogs,
  computeOutcome,
  finalizedFingerprint,
  getRandomNonce,
  getTestProvider,
  OutcomeShortHand,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  resetMultipleHoldings,
  setupContracts,
} from '../../test-helpers';

const provider = getTestProvider();
let NitroAdjudicator: Contract;
let AssetHolder1: Contract;
let AssetHolder2: Contract;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
  ETH: undefined,
  ETH2: undefined,
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
beforeAll(async () => {
  NitroAdjudicator = setupContracts(
    provider,
    NitroAdjudicatorArtifact,
    process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  AssetHolder1 = setupContracts(
    provider,
    AssetHolderArtifact,
    process.env.TEST_ASSET_HOLDER_ADDRESS
  );
  AssetHolder2 = setupContracts(
    provider,
    AssetHolderArtifact,
    process.env.TEST_ASSET_HOLDER2_ADDRESS
  );
  addresses.ETH = AssetHolder1.address;
  addresses.ETH2 = AssetHolder2.address;
});

// Scenarios are synonymous with channelNonce:

// Const description1 =
//   'NitroAdjudicator accepts a pushOutcomeAndTransferAll tx for a finalized channel, and 1x Asset types transferred';
const description2 =
  'NitroAdjudicator accepts a pushOutcomeAndTransferAll tx for a finalized channel, and 2x Asset types transferred';
const channelNonce = getRandomNonce('pushOutcomeAndTransferAll');
const storedTurnNumRecord = 5;
const declaredTurnNumRecord = storedTurnNumRecord;
const finalized = true;

describe('pushOutcomeAndTransferAll', () => {
  it.each`
    description     | setOutcome                     | heldBefore                     | newOutcome | heldAfter                      | payouts                        | reasonString
    ${description2} | ${{ETH: {A: 1}, ETH2: {A: 2}}} | ${{ETH: {c: 1}, ETH2: {c: 2}}} | ${{}}      | ${{ETH: {c: 0}, ETH2: {c: 0}}} | ${{ETH: {A: 1}, ETH2: {A: 2}}} | ${undefined}
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
      const finalizesAt = finalized ? 1 : 1e12; // Either 1 second after unix epoch, or ~ 31000 years after

      // Transform input data (unpack addresses and BigNumberify amounts)
      [heldBefore, setOutcome, newOutcome, heldAfter, payouts] = [
        heldBefore,
        setOutcome,
        newOutcome,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses) as OutcomeShortHand);

      // Set holdings on multiple asset holders
      resetMultipleHoldings(heldBefore, [AssetHolder1, AssetHolder2]);

      // Compute the outcome.
      const outcome: AllocationAssetOutcome[] = computeOutcome(setOutcome);

      // We don't care about the actual values in the state
      const state: State = {
        turnNum: 0,
        isFinal: false,
        channel,
        outcome,
        appDefinition: ethers.constants.AddressZero,
        appData: '0x00',
        challengeDuration: 0x1,
      };

      const challengerAddress = participants[state.turnNum % participants.length];

      const initialFingerprint = finalizedFingerprint(
        storedTurnNumRecord,
        finalizesAt,
        outcome,
        state,
        challengerAddress
      );

      // Call public wrapper to set state (only works on test contract)
      const tx0 = await NitroAdjudicator.setStatus(channelId, initialFingerprint);
      await tx0.wait();
      expect(await NitroAdjudicator.statusOf(channelId)).toEqual(initialFingerprint);

      const stateHash = hashState(state);
      const encodedOutcome = encodeOutcome(outcome);

      const tx1 = NitroAdjudicator.pushOutcomeAndTransferAll(
        channelId,
        declaredTurnNumRecord,
        finalizesAt,
        stateHash,
        challengerAddress,
        encodedOutcome,
        {gasLimit: 300000}
      );

      // Call method in a slightly different way if expecting a revert
      if (reasonString) {
        const regex = new RegExp(
          '^' + 'VM Exception while processing transaction: revert ' + reasonString + '$'
        );
        await expectRevert(() => tx1, regex);
      } else {
        const {logs} = await (await tx1).wait();

        // Compile events from logs
        const events = compileEventsFromLogs(logs, [AssetHolder1, AssetHolder2, NitroAdjudicator]);

        // Build up event expectations
        const expectedEvents = [];

        // Add an AllocationUpdated event to expectations
        Object.keys(heldBefore).forEach(key => {
          expectedEvents.push({
            name: 'AllocationUpdated',
            contract: key,
            args: {
              channelId,
              initialHoldings: heldBefore[key][channelId], // initialHoldings
            },
          });
        });

        // Check that each expectedEvent is contained as a subset of the properies of each *corresponding* event: i.e. the order matters!
        expect(events).toMatchObject(expectedEvents);

        // Check new holdings on each AssetHolder
        checkMultipleHoldings(heldAfter, [AssetHolder1, AssetHolder2]);

        // Check new assetOutcomeHash on each AssetHolder
        checkMultipleAssetOutcomeHashes(channelId, newOutcome, [AssetHolder1, AssetHolder2]);
      }
    }
  );
});
