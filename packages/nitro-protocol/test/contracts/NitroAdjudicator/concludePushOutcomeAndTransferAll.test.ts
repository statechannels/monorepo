import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet, ethers, BigNumber} from 'ethers';

import AssetHolderArtifact1 from '../../../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';
import AssetHolderArtifact2 from '../../../artifacts/contracts/test/TESTAssetHolder2.sol/TESTAssetHolder2.json';
import ERC20AssetHolderArtifact from '../../../artifacts/contracts/test/TestErc20AssetHolder.sol/TestErc20AssetHolder.json';
import TokenArtifact from '../../../artifacts/contracts/Token.sol/Token.json';
import NitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {channelDataToFingerprint} from '../../../src/contract/channel-storage';
import {AllocationAssetOutcome} from '../../../src/contract/outcome';
import {State} from '../../../src/contract/state';
import {concludePushOutcomeAndTransferAllArgs} from '../../../src/contract/transaction-creators/nitro-adjudicator';
import {
  checkMultipleAssetOutcomeHashes,
  checkMultipleHoldings,
  compileEventsFromLogs,
  computeOutcome,
  getPlaceHolderContractAddress,
  getRandomNonce,
  getTestProvider,
  OutcomeShortHand,
  randomChannelId,
  randomExternalDestination,
  replaceAddressesAndBigNumberify,
  resetMultipleHoldings,
  setupContracts,
  writeGasConsumption,
} from '../../test-helpers';
import {signStates} from '../../../src';
import {NITRO_MAX_GAS} from '../../../src/transactions';

const provider = getTestProvider();
let NitroAdjudicator: Contract;
let AssetHolder1: Contract;
let AssetHolder2: Contract;
let ERC20AssetHolder: Contract;
let Token: Contract;
const chainId = process.env.CHAIN_NETWORK_ID;
const participants = ['', '', ''];
const wallets = new Array(3);
const challengeDuration = 0x1000;

let appDefinition;

const addresses = {
  // Channels
  c: undefined,
  C: randomChannelId(),
  X: randomChannelId(),
  // Externals
  A: randomExternalDestination(),
  B: randomExternalDestination(),
  // // Externals preloaded with TOK (cheaper to pay to)
  At: randomExternalDestination(),
  Bt: randomExternalDestination(),
  // Asset Holders
  ETH: undefined,
  ETH2: undefined,
  ERC20: undefined,
};

const tenPayouts = {ERC20: {}};
const fiftyPayouts = {ERC20: {}};
const oneHundredPayouts = {ERC20: {}};

for (let i = 0; i < 100; i++) {
  const destination = randomExternalDestination();
  addresses[i.toString()] = destination;
  if (i < 10) tenPayouts.ERC20[i.toString()] = 1;
  if (i < 50) fiftyPayouts.ERC20[i.toString()] = 1;
  if (i < 100) oneHundredPayouts.ERC20[i.toString()] = 1;
}

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}
beforeAll(async () => {
  NitroAdjudicator = await setupContracts(
    provider,
    NitroAdjudicatorArtifact,
    process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
  );
  AssetHolder1 = await setupContracts(
    provider,
    AssetHolderArtifact1,
    process.env.TEST_ASSET_HOLDER_ADDRESS
  );
  AssetHolder2 = await setupContracts(
    provider,
    AssetHolderArtifact2,
    process.env.TEST_ASSET_HOLDER2_ADDRESS
  );
  ERC20AssetHolder = await setupContracts(
    provider,
    ERC20AssetHolderArtifact,
    process.env.TEST_TOKEN_ASSET_HOLDER_ADDRESS
  );
  Token = await setupContracts(provider, TokenArtifact, process.env.TEST_TOKEN_ADDRESS);
  addresses.ETH = AssetHolder1.address;
  addresses.ETH2 = AssetHolder2.address;
  addresses.ERC20 = ERC20AssetHolder.address;
  appDefinition = getPlaceHolderContractAddress();
  // Preload At and Bt with TOK
  await (await Token.transfer('0x' + addresses.At.slice(26), BigNumber.from(1))).wait();
  await (await Token.transfer('0x' + addresses.Bt.slice(26), BigNumber.from(1))).wait();
});

const accepts1 = '{ETH: {A: 1}}';
const accepts2 = '{ETH: {A: 1}, ETH2: {A: 2}}';
const accepts3 = '{ETH2: {A: 1, B: 1}}';
const accepts4 = '{ERC20: {A: 1, B: 1}}';
const accepts5 = '{ERC20: {At: 1, Bt: 1}} (At and Bt already have some TOK)';
const accepts6 = '10 TOK payouts';
const accepts7 = '50 TOK payouts';
const accepts8 = '100 TOK payouts';

const oneState = {
  whoSignedWhat: [0, 0, 0],
  appData: [ethers.constants.HashZero],
};
const turnNumRecord = 5;
let channelNonce = getRandomNonce('concludePushOutcomeAndTransferAll');
describe('concludePushOutcomeAndTransferAll', () => {
  beforeEach(() => (channelNonce += 1));
  it.each`
    description | outcomeShortHand               | heldBefore                     | heldAfter                      | newOutcome | payouts                        | reasonString
    ${accepts1} | ${{ETH: {A: 1}}}               | ${{ETH: {c: 1}}}               | ${{ETH: {c: 0}}}               | ${{}}      | ${{ETH: {A: 1}}}               | ${undefined}
    ${accepts2} | ${{ETH: {A: 1}, ETH2: {A: 2}}} | ${{ETH: {c: 1}, ETH2: {c: 2}}} | ${{ETH: {c: 0}, ETH2: {c: 0}}} | ${{}}      | ${{ETH: {A: 1}, ETH2: {A: 2}}} | ${undefined}
    ${accepts3} | ${{ETH2: {A: 1, B: 1}}}        | ${{ETH2: {c: 2}}}              | ${{ETH2: {c: 0}}}              | ${{}}      | ${{ETH2: {A: 1, B: 1}}}        | ${undefined}
    ${accepts4} | ${{ERC20: {A: 1, B: 1}}}       | ${{ERC20: {c: 2}}}             | ${{ERC20: {c: 0}}}             | ${{}}      | ${{ERC20: {A: 1, B: 1}}}       | ${undefined}
    ${accepts5} | ${{ERC20: {At: 1, Bt: 1}}}     | ${{ERC20: {c: 2}}}             | ${{ERC20: {c: 0}}}             | ${{}}      | ${{ERC20: {At: 1, Bt: 1}}}     | ${undefined}
    ${accepts6} | ${tenPayouts}                  | ${{ERC20: {c: 10}}}            | ${{ERC20: {c: 0}}}             | ${{}}      | ${tenPayouts}                  | ${undefined}
    ${accepts7} | ${fiftyPayouts}                | ${{ERC20: {c: 50}}}            | ${{ERC20: {c: 0}}}             | ${{}}      | ${fiftyPayouts}                | ${undefined}
    ${accepts8} | ${oneHundredPayouts}           | ${{ERC20: {c: 100}}}           | ${{ERC20: {c: 0}}}             | ${{}}      | ${oneHundredPayouts}           | ${undefined}
  `(
    '$description', // For the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({
      description,
      outcomeShortHand,
      heldBefore,
      heldAfter,
      newOutcome,
      payouts,
      reasonString,
    }: {
      description: string;
      outcomeShortHand: OutcomeShortHand;
      initialFingerprint;
      heldBefore: OutcomeShortHand;
      heldAfter: OutcomeShortHand;
      newOutcome: OutcomeShortHand;
      payouts: OutcomeShortHand;
      reasonString;
    }) => {
      const channel: Channel = {chainId, participants, channelNonce};
      const channelId = getChannelId(channel);
      addresses.c = channelId;
      const support = oneState;
      const {appData, whoSignedWhat} = support;
      const numStates = appData.length;
      const largestTurnNum = turnNumRecord + 1;
      const initialFingerprint = ethers.constants.HashZero;

      // Transfer some tokens into ERC20AssetHolder
      // Do this step before transforming input data (easier)
      if ('ERC20' in heldBefore) {
        await (
          await Token.transfer(ERC20AssetHolder.address, BigNumber.from(heldBefore.ERC20.c))
        ).wait(); // if the tx is mined, we know we the transfer succeeded
      }

      // Transform input data (unpack addresses and BigNumberify amounts)
      [heldBefore, outcomeShortHand, newOutcome, heldAfter, payouts] = [
        heldBefore,
        outcomeShortHand,
        newOutcome,
        heldAfter,
        payouts,
      ].map(object => replaceAddressesAndBigNumberify(object, addresses) as OutcomeShortHand);

      // Set holdings on multiple asset holders
      resetMultipleHoldings(heldBefore, [AssetHolder1, AssetHolder2, ERC20AssetHolder]);

      // Compute the outcome.
      const outcome: AllocationAssetOutcome[] = computeOutcome(outcomeShortHand);

      // Construct states
      const states: State[] = [];
      for (let i = 1; i <= numStates; i++) {
        states.push({
          isFinal: true,
          channel,
          outcome,
          appDefinition,
          appData: appData[i - 1],
          challengeDuration,
          turnNum: largestTurnNum + i - numStates,
        });
      }

      // Call public wrapper to set state (only works on test contract)
      await (await NitroAdjudicator.setFingerprint(channelId, initialFingerprint)).wait();
      expect(await NitroAdjudicator.fingerprints(channelId)).toEqual(initialFingerprint);

      // Sign the states
      const sigs = await signStates(states, wallets, whoSignedWhat);

      // Form transaction
      const tx = NitroAdjudicator.concludePushOutcomeAndTransferAll(
        ...concludePushOutcomeAndTransferAllArgs(states, sigs, whoSignedWhat),
        {gasLimit: 3000000}
      );

      // Switch on overall test expectation
      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const receipt = await (await tx).wait();

        expect(BigNumber.from(receipt.gasUsed).lt(BigNumber.from(NITRO_MAX_GAS))).toBe(true);

        await writeGasConsumption(
          './concludePushOutcomeAndTransferAll.gas.md',
          description,
          receipt.gasUsed
        );

        // Compute expected ChannelDataHash
        const blockTimestamp = (await provider.getBlock(receipt.blockNumber)).timestamp;
        const expectedFingerprint = channelDataToFingerprint({
          turnNumRecord: 0,
          finalizesAt: blockTimestamp,
          outcome,
        });

        // Check fingerprint against the expected value
        expect(await NitroAdjudicator.fingerprints(channelId)).toEqual(expectedFingerprint);

        // Extract logs
        const {logs} = await (await tx).wait();

        // Compile events from logs
        const events = compileEventsFromLogs(logs, [
          AssetHolder1,
          AssetHolder2,
          ERC20AssetHolder,
          NitroAdjudicator,
        ]);

        // Compile event expectations

        const expectedEvents = [];

        // Add Conclude event to expectations
        expectedEvents.push({
          contract: NitroAdjudicator.address,
          name: 'Concluded',
          args: {channelId},
        });

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
        checkMultipleHoldings(heldAfter, [AssetHolder1, AssetHolder2, ERC20AssetHolder]);

        // Check new assetOutcomeHash on each AssetHolder
        checkMultipleAssetOutcomeHashes(channelId, newOutcome, [
          AssetHolder1,
          AssetHolder2,
          ERC20AssetHolder,
        ]);
      }
    }
  );
});
