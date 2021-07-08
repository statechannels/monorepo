import {expectRevert} from '@statechannels/devtools';
import {Contract, Wallet, ethers, Signature, BigNumber} from 'ethers';

const {HashZero} = ethers.constants;
const {defaultAbiCoder} = ethers.utils;

import ForceMoveArtifact from '../../../artifacts/contracts/test/TESTForceMove.sol/TESTForceMove.json';
import {Channel, getChannelId} from '../../../src/contract/channel';
import {channelDataToStatus, ChannelData} from '../../../src/contract/channel-storage';
import {getFixedPart, getVariablePart, State} from '../../../src/contract/state';
import {
  CHALLENGER_NON_PARTICIPANT,
  CHANNEL_FINALIZED,
  INVALID_NUMBER_OF_STATES,
  INVALID_SIGNATURE,
  TURN_NUM_RECORD_DECREASED,
  TURN_NUM_RECORD_NOT_INCREASED,
} from '../../../src/contract/transaction-creators/revert-reasons';
import {Outcome, SignedState} from '../../../src/index';
import {signChallengeMessage, signData, signState, signStates} from '../../../src/signatures';
import {COUNTING_APP_INVALID_TRANSITION} from '../../revert-reasons';
import {
  clearedChallengeFingerprint,
  finalizedFingerprint,
  getPlaceHolderContractAddress,
  getRandomNonce,
  getTestProvider,
  largeOutcome,
  nonParticipant,
  ongoingChallengeFingerprint,
  setupContract,
} from '../../test-helpers';
import {createChallengeTransaction, NITRO_MAX_GAS} from '../../../src/transactions';
import {hashChallengeMessage} from '../../../src/contract/challenge';
import {MAX_OUTCOME_ITEMS} from '../../../src/contract/outcome';

const provider = getTestProvider();

let ForceMove: Contract;

const chainId = process.env.CHAIN_NETWORK_ID;
const participants = ['', '', ''];
const wallets = new Array(3);
const challengeDuration = 86400; // 1 day
const outcome = [{allocationItems: [], asset: Wallet.createRandom().address}];

const appDefinition = getPlaceHolderContractAddress();
const keys = [
  '0x8624ebe7364bb776f891ca339f0aaa820cc64cc9fca6a28eec71e6d8fc950f29',
  '0x275a2e2cd9314f53b42246694034a80119963097e3adf495fbf6d821dc8b6c8e',
  '0x1b7598002c59e7d9131d7e7c9d0ec48ed065a3ed04af56674497d6b0048f2d84',
];

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = new Wallet(keys[i]);
  participants[i] = wallets[i].address;
}

const twoPartyChannel: Channel = {
  chainId: process.env.CHAIN_NETWORK_ID,
  channelNonce: 0x1,
  participants: [wallets[0].address, wallets[1].address],
};

async function createSignedCountingAppState(
  channel: Channel,
  appData: number,
  turnNum: number,
  outcome: Outcome = []
) {
  return await signState(
    {
      turnNum,
      isFinal: false,
      appDefinition: getPlaceHolderContractAddress(),
      appData: defaultAbiCoder.encode(['uint256'], [appData]),
      outcome,
      channel,
      challengeDuration: 0xfff,
    },
    wallets[turnNum % channel.participants.length].privateKey
  );
}
beforeAll(async () => {
  ForceMove = setupContract(provider, ForceMoveArtifact, process.env.TEST_FORCE_MOVE_ADDRESS);
});

// Scenarios are synonymous with channelNonce:

const acceptsWhenOpen = 'It accepts for an open channel, and updates storage correctly, ';
const accepts1 = acceptsWhenOpen + 'when the slot is empty, 1 state submitted';
const accepts2 = acceptsWhenOpen + 'when the slot is empty, 3 states submitted';
const accepts3 = acceptsWhenOpen + 'when the slot is not empty, 3 states submitted';
const accepts4 = acceptsWhenOpen + 'when the slot is not empty, 1 state submitted';

const acceptsWhenChallengePresent =
  'It accepts when a challenge is present, and updates storage correctly, ';
const accepts5 = acceptsWhenChallengePresent + 'when the turnNumRecord increases, 1 state';
const accepts6 = acceptsWhenChallengePresent + 'when the turnNumRecord increases, 3 states';

const revertsWhenOpenIf = 'It reverts for an open channel if ';
const reverts1 = revertsWhenOpenIf + 'the turnNumRecord does not increase';
const reverts2a = revertsWhenOpenIf + 'the challengerSig is incorrect';
const reverts2b = revertsWhenOpenIf + 'the challengerSig is invalid';
const reverts3 = revertsWhenOpenIf + 'the states do not form a validTransition chain';

const reverts4 = 'It reverts when a challenge is present if the turnNumRecord does not increase';
const reverts5 = 'It reverts when the channel is finalized';
const reverts6 = 'It reverts when too many states are submitted';

describe('challenge', () => {
  const threeStates = {appDatas: [0, 1, 2], whoSignedWhat: [0, 1, 2]};
  const fourStates = {appDatas: [0, 1, 2, 3], whoSignedWhat: [0, 1, 2, 0]};
  const oneState = {appDatas: [2], whoSignedWhat: [0, 0, 0]};
  const invalid = {appDatas: [0, 2, 1], whoSignedWhat: [0, 1, 2]};
  const largestTurnNum = 8;
  const isFinalCount = 0;
  const challenger = wallets[2];
  const empty = HashZero; // Equivalent to openAtZero
  const openAtFive = clearedChallengeFingerprint(5);
  const openAtLargestTurnNum = clearedChallengeFingerprint(largestTurnNum);
  const openAtTwenty = clearedChallengeFingerprint(20);
  const challengeAtFive = ongoingChallengeFingerprint(5);
  const challengeAtLargestTurnNum = ongoingChallengeFingerprint(largestTurnNum);
  const challengeAtTwenty = ongoingChallengeFingerprint(20);
  const finalizedAtFive = finalizedFingerprint(5);

  let channelNonce = getRandomNonce('challenge');
  beforeEach(() => (channelNonce += 1));
  it.each`
    description  | initialFingerprint           | stateData      | challengeSignatureType | reasonString
    ${accepts1}  | ${empty}                     | ${oneState}    | ${'correct'}           | ${undefined}
    ${accepts2}  | ${empty}                     | ${threeStates} | ${'correct'}           | ${undefined}
    ${accepts3}  | ${openAtFive}                | ${oneState}    | ${'correct'}           | ${undefined}
    ${accepts3}  | ${openAtLargestTurnNum}      | ${oneState}    | ${'correct'}           | ${undefined}
    ${accepts4}  | ${openAtFive}                | ${threeStates} | ${'correct'}           | ${undefined}
    ${accepts5}  | ${challengeAtFive}           | ${oneState}    | ${'correct'}           | ${undefined}
    ${accepts6}  | ${challengeAtFive}           | ${threeStates} | ${'correct'}           | ${undefined}
    ${reverts1}  | ${openAtTwenty}              | ${oneState}    | ${'correct'}           | ${TURN_NUM_RECORD_DECREASED}
    ${reverts2a} | ${empty}                     | ${oneState}    | ${'incorrect'}         | ${CHALLENGER_NON_PARTICIPANT}
    ${reverts2b} | ${empty}                     | ${oneState}    | ${'invalid'}           | ${INVALID_SIGNATURE}
    ${reverts3}  | ${empty}                     | ${invalid}     | ${'correct'}           | ${COUNTING_APP_INVALID_TRANSITION}
    ${reverts4}  | ${challengeAtTwenty}         | ${oneState}    | ${'correct'}           | ${TURN_NUM_RECORD_NOT_INCREASED}
    ${reverts4}  | ${challengeAtLargestTurnNum} | ${oneState}    | ${'correct'}           | ${TURN_NUM_RECORD_NOT_INCREASED}
    ${reverts5}  | ${finalizedAtFive}           | ${oneState}    | ${'correct'}           | ${CHANNEL_FINALIZED}
    ${reverts6}  | ${finalizedAtFive}           | ${fourStates}  | ${'correct'}           | ${INVALID_NUMBER_OF_STATES}
  `(
    '$description', // For the purposes of this test, chainId and participants are fixed, making channelId 1-1 with channelNonce
    async ({initialFingerprint, stateData, challengeSignatureType, reasonString}) => {
      const {appDatas, whoSignedWhat} = stateData;
      const channel: Channel = {
        chainId,
        participants,
        channelNonce,
      };
      const channelId = getChannelId(channel);

      const states: State[] = appDatas.map((data, idx) => ({
        turnNum: largestTurnNum - appDatas.length + 1 + idx,
        isFinal: idx > appDatas.length - isFinalCount,
        channel,
        challengeDuration,
        outcome,
        appDefinition,
        appData: defaultAbiCoder.encode(['uint256'], [data]),
      }));
      const variableParts = states.map(state => getVariablePart(state));
      const fixedPart = getFixedPart(states[0]);

      // Sign the states
      const signatures = await signStates(states, wallets, whoSignedWhat);
      const challengeState: SignedState = {
        state: states[states.length - 1],
        signature: {v: 0, r: '', s: '', _vs: '', recoveryParam: 0},
      };

      const correctChallengeSignature = signChallengeMessage(
        [challengeState],
        challenger.privateKey
      );
      let challengeSignature: ethers.Signature;

      switch (challengeSignatureType) {
        case 'incorrect':
          challengeSignature = signChallengeMessageByNonParticipant([challengeState]);
          break;
        case 'invalid':
          challengeSignature = {v: 1, s: HashZero, r: HashZero} as ethers.Signature;
          break;
        case 'correct':
        default:
          challengeSignature = correctChallengeSignature;
      }

      // Set current channelStorageHashes value
      await (await ForceMove.setStatus(channelId, initialFingerprint)).wait();

      const tx = ForceMove.challenge(
        fixedPart,
        largestTurnNum,
        variableParts,
        isFinalCount,
        signatures,
        whoSignedWhat,
        challengeSignature
      );
      if (reasonString) {
        await expectRevert(() => tx, reasonString);
      } else {
        const receipt = await (await tx).wait();
        const event = receipt.events.pop();

        // Catch ChallengeRegistered event
        const {
          channelId: eventChannelId,
          turnNumRecord: eventTurnNumRecord,
          finalizesAt: eventFinalizesAt,
          challenger: eventChallenger,
          isFinal: eventIsFinal,
          fixedPart: eventFixedPart,
          variableParts: eventVariableParts,
        } = event.args;

        // Check this information is enough to respond
        expect(eventChannelId).toEqual(channelId);
        expect(eventTurnNumRecord).toEqual(largestTurnNum);
        expect(eventChallenger).toEqual(challenger.address);
        expect(
          ethers.BigNumber.from(eventFixedPart[0]).eq(ethers.BigNumber.from(fixedPart.chainId))
        ).toBe(true);
        expect(eventFixedPart[1]).toEqual(fixedPart.participants);
        expect(eventFixedPart[2]).toEqual(fixedPart.channelNonce);
        expect(eventFixedPart[3]).toEqual(fixedPart.appDefinition);
        expect(eventFixedPart[4]).toEqual(fixedPart.challengeDuration);
        expect(eventIsFinal).toEqual(isFinalCount > 0);
        expect(eventVariableParts[eventVariableParts.length - 1][0]).toEqual(
          variableParts[variableParts.length - 1].outcome
        );
        expect(eventVariableParts[eventVariableParts.length - 1][1]).toEqual(
          variableParts[variableParts.length - 1].appData
        );

        const expectedChannelStorage: ChannelData = {
          turnNumRecord: largestTurnNum,
          finalizesAt: eventFinalizesAt,
          state: states[states.length - 1],
          challengerAddress: challenger.address,
          outcome,
        };
        const expectedFingerprint = channelDataToStatus(expectedChannelStorage);

        // Check channelStorageHash against the expected value
        expect(await ForceMove.statusOf(channelId)).toEqual(expectedFingerprint);
      }
    }
  );
});

describe('challenge with transaction generator', () => {
  beforeEach(async () => {
    await (await ForceMove.setStatus(getChannelId(twoPartyChannel), HashZero)).wait();
  });
  it.each`
    description                                     | appData   | outcome                            | turnNums  | challenger
    ${'challenge(0,1) accepted'}                    | ${[0, 0]} | ${[]}                              | ${[0, 1]} | ${1}
    ${'challenge(1,2) accepted'}                    | ${[0, 0]} | ${[]}                              | ${[1, 2]} | ${0}
    ${'challenge(1,2) accepted, MAX_OUTCOME_ITEMS'} | ${[0, 0]} | ${largeOutcome(MAX_OUTCOME_ITEMS)} | ${[1, 2]} | ${0}
  `('$description', async ({appData, turnNums, challenger}) => {
    const transactionRequest: ethers.providers.TransactionRequest = createChallengeTransaction(
      [
        await createSignedCountingAppState(twoPartyChannel, appData[0], turnNums[0]),
        await createSignedCountingAppState(twoPartyChannel, appData[1], turnNums[1]),
      ],
      wallets[challenger].privateKey
    );
    const signer = provider.getSigner();
    const response = await signer.sendTransaction({
      to: ForceMove.address,
      ...transactionRequest,
    });
    expect(BigNumber.from((await response.wait()).gasUsed).lt(BigNumber.from(NITRO_MAX_GAS))).toBe(
      true
    );
  });
});

function signChallengeMessageByNonParticipant(signedStates: SignedState[]): Signature {
  if (signedStates.length === 0) {
    throw new Error('At least one signed state must be provided');
  }
  const challengeState = signedStates[signedStates.length - 1].state;
  const challengeHash = hashChallengeMessage(challengeState);
  return signData(challengeHash, nonParticipant.privateKey);
}
