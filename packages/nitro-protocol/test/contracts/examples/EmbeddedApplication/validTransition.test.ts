/* eslint-disable jest/expect-expect */
import {expectRevert as innerExpectRevert} from '@statechannels/devtools';
import {constants, Contract, Wallet} from 'ethers';

import embeddedApplicationArtifact from '../../../../artifacts/contracts/examples/EmbeddedApplication.sol/EmbeddedApplication.json';
import {convertAddressToBytes32, getChannelId, signState} from '../../../../src';
import {AllocationAssetOutcome, encodeOutcome} from '../../../../src/contract/outcome';
import {getFixedPart, getVariablePart, State, VariablePart} from '../../../../src/contract/state';
import {
  AlreadyMoved,
  encodeEmbeddedApplicationData,
  SupportProof,
} from '../../../../src/contract/embedded-application';
import {getTestProvider, setupContract} from '../../../test-helpers';
import {MAGIC_ADDRESS_INDICATING_ETH} from '../../../../lib/test/test-helpers';

type RevertReason =
  // each reason represents a distinct code path that we should check in this test
  | 'destinations may not change' // tested
  | 'p2.amt !constant' // tested
  | 'total allocation changed' // tested
  | 'incorrect move from None' // tested
  | 'inferior support proof' // tested
  | 'incorrect move from A' // tested
  | 'incorrect move from B' // tested
  | 'move from None,A,B only' //tested
  | 'X / J outcome mismatch' // tested
  | 'X.appDefinition changed' // tested
  | 'X.challengeDuration changed' // tested
  | '1 or 2 states required' // tested
  | 'sig0 !by participant0' // tested
  | 'sig1 !by participant1' // tested
  | 'sig0 on state0 !by participant0'
  | 'sig0 on state1 !by participant1'
  | 'sig0 on state1 !by participant0'
  | 'sig0 on state0 !by participant1'
  | 'invalid whoSignedWhat' // tested
  | 'invalid transition in X';

async function expectRevert(fn: () => void, reason: RevertReason) {
  return innerExpectRevert(fn, reason);
}

// We also want to check each transition:
//    AB
//    ^^
//   /  \
// A      B
// ^      ^
//  \    /
//   None

// AND we want to check various ways to support a state in X
// i.e. whoSignedWhat = [0,1], [0,0] and [1,0]
// TODO we will need to have something more interesting than the null app in order to test [0,1] and [1,0] cases

// Utilities
function absorbOutcomeOfXIntoJ(xOutcome: [AllocationAssetOutcome]) {
  return [
    {
      asset: xOutcome[0].asset,
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

let embeddedApplication: Contract;

const Alice = Wallet.createRandom();
const Bob = Wallet.createRandom();
const Irene = Wallet.createRandom();

const sixFour: [AllocationAssetOutcome] = [
  {
    asset: MAGIC_ADDRESS_INDICATING_ETH,
    allocationItems: [
      {destination: convertAddressToBytes32(Alice.address), amount: '0x6'},
      {destination: convertAddressToBytes32(Bob.address), amount: '0x4'},
    ],
  },
];
const fourSix: [AllocationAssetOutcome] = [
  {
    asset: process.env.MAGIC_ADDRESS_INDICATING_ETH,
    allocationItems: [
      {destination: convertAddressToBytes32(Alice.address), amount: '0x4'},
      {destination: convertAddressToBytes32(Bob.address), amount: '0x6'},
    ],
  },
];

const stateForX: State = {
  turnNum: 4,
  isFinal: false,
  channel: {
    chainId: '0x1',
    participants: [Alice.address, Bob.address],
    channelNonce: 87,
  },
  challengeDuration: 0,
  outcome: sixFour,
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
  outcome: fourSix,
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

const NoneVariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])), // TOOD we should have a different outcome here
  appData: encodeEmbeddedApplicationData({
    alreadyMoved: AlreadyMoved.None,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX), // TODO this is awkward. We would like to use a null value here
  }),
};

const AvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])),
  appData: encodeEmbeddedApplicationData({
    alreadyMoved: AlreadyMoved.A,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX),
  }),
};

const BvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome])),
  appData: encodeEmbeddedApplicationData({
    alreadyMoved: AlreadyMoved.B,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(stateForX),
  }),
};

const ABvariablePartForJ: VariablePart = {
  outcome: encodeOutcome(
    absorbOutcomeOfXIntoJ(greaterStateForX.outcome as [AllocationAssetOutcome])
  ),
  appData: encodeEmbeddedApplicationData({
    alreadyMoved: AlreadyMoved.AB,
    channelIdForX: getChannelId(stateForX.channel),
    supportProofForX: supportProofForX(greaterStateForX),
  }),
};

const provider = getTestProvider();

beforeAll(async () => {
  embeddedApplication = setupContract(
    provider,
    embeddedApplicationArtifact,
    process.env.EMBEDDED_APPLICATION_ADDRESS
  );
});

const turnNumTo = 0; // TODO this is unused, but presumably it _should_ be used
const nParticipants = 0; // TODO this is unused
const signedByFrom = 0b00; // TODO this is unused

describe('EmbeddedApplication: named state transitions', () => {
  it('returns true / reverts for a correct / incorrect None => A transition', async () => {
    const result = await embeddedApplication.validTransition(
      NoneVariablePartForJ,
      AvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b01 // signedByTo = just Alice
    );
    expect(result).toBe(true);
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          AvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b10 // signedByTo = just Bob
        ),
      'incorrect move from None'
    );
  });
  it('returns true / reverts for a correct / incorrect None => B transition', async () => {
    const result = await embeddedApplication.validTransition(
      NoneVariablePartForJ,
      BvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b10 // signedByTo = just Bob
    );
    expect(result).toBe(true);
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          BvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'incorrect move from None'
    );
  });
  it('returns true / reverts for a correct / incorrect A => AB transition', async () => {
    const result = await embeddedApplication.validTransition(
      AvariablePartForJ,
      ABvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b10 // signedByTo = just Bob
    );
    expect(result).toBe(true);
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          AvariablePartForJ,
          ABvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'incorrect move from A'
    );
  });
  it('returns true / reverts for a correct / incorrect B => AB transition', async () => {
    const result = await embeddedApplication.validTransition(
      BvariablePartForJ,
      ABvariablePartForJ,
      turnNumTo,
      nParticipants,
      signedByFrom,
      0b01 // signedByTo = just Alice
    );
    expect(result).toBe(true);
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          BvariablePartForJ,
          ABvariablePartForJ,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b10 // signedByTo = just Bob
        ),
      'incorrect move from B'
    );
  });
  it('reverts when trying to move from AB', async () => {
    const evenGreaterSupportProofForX = {
      ...ABvariablePartForJ,
      appData: encodeEmbeddedApplicationData({
        alreadyMoved: AlreadyMoved.A,
        channelIdForX: getChannelId(stateForX.channel),
        supportProofForX: supportProofForX({...greaterStateForX, turnNum: 99}),
      }),
    };
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          ABvariablePartForJ,
          evenGreaterSupportProofForX,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b10 // signedByTo = just Bob
        ),
      'move from None,A,B only'
    );
  });
});

describe('EmbeddedApplication: reversions', () => {
  it('reverts if destinations change', async () => {
    const maliciousOutcome = absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome]);
    maliciousOutcome[0].allocationItems[2].destination = convertAddressToBytes32(Alice.address);
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          {...AvariablePartForJ, outcome: encodeOutcome(maliciousOutcome)},
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'destinations may not change'
    );
  });
  it('reverts if Irene`s balance changes', async () => {
    const maliciousOutcome = absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome]);
    maliciousOutcome[0].allocationItems[2].amount = '0x0';
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          {...AvariablePartForJ, outcome: encodeOutcome(maliciousOutcome)},
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'p2.amt !constant'
    );
  });
  it('reverts if the total amount allocated changes', async () => {
    const maliciousOutcome = absorbOutcomeOfXIntoJ(stateForX.outcome as [AllocationAssetOutcome]);
    maliciousOutcome[0].allocationItems[1].amount = '0xaaa';
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          {...AvariablePartForJ, outcome: encodeOutcome(maliciousOutcome)},
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'total allocation changed'
    );
  });
  it('reverts if an inferior support proof is provided', async () => {
    const inferiorSupportProof = {...ABvariablePartForJ};
    (inferiorSupportProof.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.AB,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: supportProofForX(stateForX),
    })),
      await expectRevert(
        () =>
          embeddedApplication.validTransition(
            AvariablePartForJ,
            inferiorSupportProof,
            turnNumTo,
            nParticipants,
            signedByFrom,
            0b10 // signedByTo = just Bob
          ),
        'inferior support proof'
      );
  });
  it('reverts if J does not absorb X', async () => {
    const notProperlyAbsorbed = {...AvariablePartForJ};
    notProperlyAbsorbed.outcome = encodeOutcome(absorbOutcomeOfXIntoJ(fourSix));
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          notProperlyAbsorbed,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'X / J outcome mismatch'
    );
  });
  it('reverts if X.appDefinition changes', async () => {
    const appDefinitionChanged = {...AvariablePartForJ};
    appDefinitionChanged.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: supportProofForX({...stateForX, appDefinition: Alice.address}),
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          appDefinitionChanged,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'X.appDefinition changed'
    );
  });
  it('reverts if X.challengeDuration changes', async () => {
    const challengeDurationChanged = {...AvariablePartForJ};
    challengeDurationChanged.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: supportProofForX({...stateForX, challengeDuration: 7}),
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          challengeDurationChanged,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'X.challengeDuration changed'
    );
  });
  it('reverts if no states in support proof', async () => {
    const malicious = {...AvariablePartForJ};
    malicious.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: {...supportProofForX(stateForX), variableParts: [] as any}, // type system is trying to stop us hacking
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          malicious,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      '1 or 2 states required'
    );
  });
  it('reverts if whoSignedWhat is invalid', async () => {
    const malicious = {...AvariablePartForJ};
    malicious.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: {...supportProofForX(stateForX), whoSignedWhat: [9, 9]}, // type system is trying to stop us hacking
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          malicious,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'invalid whoSignedWhat'
    );
  });
  it('reverts if sig0 is corrupted', async () => {
    const malicious = {...AvariablePartForJ};
    malicious.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: {
        ...supportProofForX(stateForX),
        sigs: [supportProofForX(stateForX).sigs[1], supportProofForX(stateForX).sigs[1]],
      }, // type system is trying to stop us hacking
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          malicious,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'sig0 !by participant0'
    );
  });
  it('reverts if sig1 is corrupted', async () => {
    const malicious = {...AvariablePartForJ};
    malicious.appData = encodeEmbeddedApplicationData({
      alreadyMoved: AlreadyMoved.A,
      channelIdForX: getChannelId(stateForX.channel),
      supportProofForX: {
        ...supportProofForX(stateForX),
        sigs: [supportProofForX(stateForX).sigs[0], supportProofForX(stateForX).sigs[0]],
      }, // type system is trying to stop us hacking
    });
    await expectRevert(
      () =>
        embeddedApplication.validTransition(
          NoneVariablePartForJ,
          malicious,
          turnNumTo,
          nParticipants,
          signedByFrom,
          0b01 // signedByTo = just Alice
        ),
      'sig1 !by participant1'
    );
  });
});
