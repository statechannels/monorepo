import {expectRevert} from '@statechannels/devtools';
import {constants, Contract, Wallet} from 'ethers';

import xInJArtifact from '../../../../artifacts/contracts/examples/XinJ.sol/XinJ.json';
import {convertAddressToBytes32, getChannelId, signState} from '../../../../src';
import {AllocationAssetOutcome, encodeOutcome} from '../../../../src/contract/outcome';
import {getFixedPart, getVariablePart, State, VariablePart} from '../../../../src/contract/state';
import {AlreadyMoved, encodeXinJData, SupportProof} from '../../../../src/contract/X-in-J';
import {getTestProvider, setupContract} from '../../../test-helpers';

type RevertReason =
  // each reason represents a distinct code path that we should check in this test
  | 'destinations may not change'
  | 'p2.amt constant'
  | 'incorrect move from ABC'
  | 'inferior support proof'
  | 'incorrect move from A'
  | 'incorrect move from B'
  | 'move from ABC,A,B only'
  | 'X / J outcome mismatch'
  | 'appDefinition changed'
  | 'challengeDuration changed'
  | '1 or 2 states required'
  | 'whoSignedWhat.length must be 2'
  | 'sig0 !by participant0'
  | 'sig1 !by participant1'
  | 'sig0 on state0 !by participant0'
  | 'sig0 on state1 !by participant1'
  | 'sig0 on state1 !by participant0'
  | 'sig0 on state0 !by participant1'
  | 'invalid whoSignedWhat'
  | 'invalid transition in X';

// We also want to check each transition:
//    AB
//    ^^
//   /  \
// A      B
// ^      ^
//  \    /
//    ABC

// AND we want to check various ways to support a state in X
// i.e. whoSignedWhat = [0,1], [0,0] and [1,0]
// TODO we will need to have something more interesting than the null app in order to test [0,1] and [1,0] cases

// Utilities
// TODO: move to a src file

function absorbOutcomeOfXIntoJ(xOutcome: [AllocationAssetOutcome]) {
  return [
    {
      assetHolderAddress: xOutcome[0].assetHolderAddress,
      allocationItems: [
        {
          destination: xOutcome[0].allocationItems[0].destination,
          amount: xOutcome[0].allocationItems[0].amount,
        },
        {
          destination: xOutcome[0].allocationItems[1].destination,
          amount: xOutcome[0].allocationItems[1].amount,
        },
        {
          destination: convertAddressToBytes32(Irene.address),
          amount: '0xa',
        },
      ],
    },
  ];
}

// *****

let xInJ: Contract;

const Alice = Wallet.createRandom();
const Bob = Wallet.createRandom();
const Irene = Wallet.createRandom();

const stateForX: State = {
  turnNum: 4,
  isFinal: false,
  channel: {
    chainId: '0x1',
    participants: [Alice.address, Bob.address],
    channelNonce: 87,
  },
  challengeDuration: 0,
  outcome: [
    {
      assetHolderAddress: process.env.ETH_ASSET_HOLDER_ADDRESS,
      allocationItems: [
        {destination: convertAddressToBytes32(Alice.address), amount: '0x6'},
        {destination: convertAddressToBytes32(Bob.address), amount: '0x4'},
      ],
    },
  ],
  appDefinition: constants.AddressZero, // We will run the null app in X (for demonstration purposes)
  appData: '0x',
};

const greaterStateForX: State = {
  turnNum: 5,
  isFinal: false,
  channel: {
    chainId: '0x1',
    participants: [Alice.address, Bob.address],
    channelNonce: 87,
  },
  challengeDuration: 0,
  outcome: [
    {
      assetHolderAddress: process.env.ETH_ASSET_HOLDER_ADDRESS,
      allocationItems: [
        {destination: convertAddressToBytes32(Alice.address), amount: '0x4'},
        {destination: convertAddressToBytes32(Bob.address), amount: '0x6'},
      ],
    },
  ],
  appDefinition: constants.AddressZero, // We will run the null app in X (for demonstration purposes)
  appData: '0x',
};

const supportProofForX: (stateForX: State) => SupportProof = stateForX => ({
  fixedPart: getFixedPart(stateForX),
  variableParts: [getVariablePart(stateForX)],
  turnNumTo: stateForX.turnNum,
  sigs: [
    signState(stateForX, Alice.privateKey).signature,
    signState(stateForX, Bob.privateKey).signature,
  ],
  whoSignedWhat: [0, 0],
});

const ABCvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])), // TOOD we should have a different outcome here
  appData: encodeXinJData({
    alreadyMoved: AlreadyMoved.ABC,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX), // TODO this is awkward. We would like to use a null value here
  }),
};

const AvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])),
  appData: encodeXinJData({
    alreadyMoved: AlreadyMoved.A,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX),
  }),
};

const BvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])),
  appData: encodeXinJData({
    alreadyMoved: AlreadyMoved.B,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX),
  }),
};

const ABvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(
    absorbOutcomeOfXIntoJ(greaterStateForX.outcome as [AllocationAssetOutcome])
  ),
  appData: encodeXinJData({
    alreadyMoved: AlreadyMoved.AB,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(greaterStateForX),
  }),
};

const provider = getTestProvider();

beforeAll(async () => {
  xInJ = setupContract(provider, xInJArtifact, process.env.X_IN_J_ADDRESS);
});

describe('XinJ', () => {
  const turnNumTo = 0; // TODO this is unused, but presumably it _should_ be used
  const nParticipants = 0; // TODO this is unused
  const signedByFrom = 0b00; // TODO this is unused
  it('returns true / reverts for a correct / incorrect ABC => A transition', async () => {
    const result = await xInJ.validTransition(
      ABCvariablePartForJ,
      AvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b01 // signedByTo = just Alice
    );
    expect(result).toBe(true);
    const reason: RevertReason = 'incorrect move from ABC';
    await expectRevert(
      () =>
        xInJ.validTransition(
          ABCvariablePartForJ,
          AvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b10 // signedByTo = just Bob
        ),
      reason
    );
  });
  it('returns true / reverts for a correct / incorrect ABC => B transition', async () => {
    const result = await xInJ.validTransition(
      ABCvariablePartForJ,
      BvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b10 // signedByTo = just Bob
    );
    expect(result).toBe(true);
    const reason: RevertReason = 'incorrect move from ABC';
    await expectRevert(
      () =>
        xInJ.validTransition(
          ABCvariablePartForJ,
          BvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      reason
    );
  });
  // eslint-disable-next-line jest/expect-expect
  it('reverts if destinations change', async () => {
    const maliciousOutcome = absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome]);
    maliciousOutcome[0].allocationItems[2].destination = convertAddressToBytes32(Alice.address);
    const reason: RevertReason = 'destinations may not change';
    await expectRevert(
      () =>
        xInJ.validTransition(
          ABCvariablePartForJ,
          {...AvariablePartForJ, outcome: encodeOutcome(maliciousOutcome)},
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      reason
    );
  });
  it('returns true / reverts for a correct / incorrect A => AB transition', async () => {
    const result = await xInJ.validTransition(
      AvariablePartForJ,
      ABvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b10 // signedByTo = just Bob
    );
    expect(result).toBe(true);
    const reason: RevertReason = 'incorrect move from A';
    await expectRevert(
      () =>
        xInJ.validTransition(
          AvariablePartForJ,
          ABvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      reason
    );
  });
  it('returns true / reverts for a correct / incorrect B => AB transition', async () => {
    const result = await xInJ.validTransition(
      AvariablePartForJ,
      ABvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b10 // signedByTo = just Bob
    );
    expect(result).toBe(true);
    const reason: RevertReason = 'incorrect move from A';
    await expectRevert(
      () =>
        xInJ.validTransition(
          AvariablePartForJ,
          ABvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      reason
    );
  });
});
