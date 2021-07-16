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

type RevertReason =
  // each reason represents a distinct code path that we should check in this test
  | 'None->B: from not signed by AI' // tested
  | 'None->B: to not signed by B' // tested
  | 'None->A: from not signed by BI' // tested
  | 'None->A: to not signed by A' // tested
  | 'A->AB: to not signed by B' // tested
  | 'A->AB: from not signed by A' // tested
  | 'B->AB: to not signed by A' // tested
  | 'B->AB: from not signed by B' // tested
  | 'must transition to AB' // tested
  | 'AB->? not allowed' // tested
  | 'destinations may not change' // tested
  | 'p2.amt !constant' // tested
  | 'total allocation changed' // tested
  | 'inferior support proof' // tested
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

let embeddedApplication: Contract;

const Alice = Wallet.createRandom();
const Bob = Wallet.createRandom();
const Irene = Wallet.createRandom();

const sixFour: [AllocationAssetOutcome] = [
  {
    assetHolderAddress: process.env.ETH_ASSET_HOLDER_ADDRESS,
    allocationItems: [
      {destination: convertAddressToBytes32(Alice.address), amount: '0x6'},
      {destination: convertAddressToBytes32(Bob.address), amount: '0x4'},
    ],
  },
];
const fourSix: [AllocationAssetOutcome] = [
  {
    assetHolderAddress: process.env.ETH_ASSET_HOLDER_ADDRESS,
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

const signedBy = {
  none: 0b000,
  alice: 0b001,
  bob: 0b010,
  irene: 0b100,
  ab: 0b011,
  ai: 0b101,
  bi: 0b110,
  all: 0b111,
};

describe('EmbeddedApplication: named state transitions', () => {
  type State = 'none' | 'a' | 'b' | 'ab';
  const variables: Record<State, any> = {
    none: NoneVariablePartForJ,
    a: AvariablePartForJ,
    b: BvariablePartForJ,
    ab: ABvariablePartForJ,
  };
  const tx = (from: State, to: State, signedByFrom, signedByTo) =>
    embeddedApplication.validTransition(
      variables[from],
      variables[to],
      turnNumTo,
      nParticipants,
      signedByFrom,
      signedByTo
    );

  describe('transitions from None state', () => {
    test('None->A: reverts when from is not signed by BI', async () => {
      const msg: RevertReason = 'None->A: from not signed by BI';
      await expectRevert(() => tx('none', 'a', signedBy.alice, signedBy.alice), msg);
      await expectRevert(() => tx('none', 'a', signedBy.bob, signedBy.alice), msg);
      await expectRevert(() => tx('none', 'a', signedBy.ai, signedBy.alice), msg);
      await expectRevert(() => tx('none', 'a', signedBy.none, signedBy.alice), msg);
    });

    test('None->A: reverts when to is not signed by A', async () => {
      const msg: RevertReason = 'None->A: to not signed by A';
      await expectRevert(() => tx('none', 'a', signedBy.bi, signedBy.bob), msg);
      await expectRevert(() => tx('none', 'a', signedBy.bi, signedBy.irene), msg);
      await expectRevert(() => tx('none', 'a', signedBy.all, signedBy.none), msg);
    });

    test('None->B: reverts when to is not signed by B', async () => {
      const msg: RevertReason = 'None->B: to not signed by B';
      await expectRevert(() => tx('none', 'b', signedBy.all, signedBy.irene), msg);
      await expectRevert(() => tx('none', 'b', signedBy.all, signedBy.alice), msg);
      await expectRevert(() => tx('none', 'b', signedBy.all, signedBy.ai), msg);
      await expectRevert(() => tx('none', 'b', signedBy.all, signedBy.none), msg);
    });

    test('None->B: reverts when from is not signed by AI', async () => {
      const msg: RevertReason = 'None->B: from not signed by AI';
      await expectRevert(() => tx('none', 'b', signedBy.bi, signedBy.all), msg);
      await expectRevert(() => tx('none', 'b', signedBy.irene, signedBy.all), msg);
      await expectRevert(() => tx('none', 'b', signedBy.none, signedBy.ai), msg);
    });

    test('valid transitions', async () => {
      await expect(tx('none', 'a', signedBy.all, signedBy.alice)).resolves.toEqual(true);
      await expect(tx('none', 'a', signedBy.bi, signedBy.alice)).resolves.toEqual(true);
      await expect(tx('none', 'b', signedBy.all, signedBy.bob)).resolves.toEqual(true);
      await expect(tx('none', 'b', signedBy.ai, signedBy.bob)).resolves.toEqual(true);
    });
  });

  describe('transitions from A', () => {
    test('valid signatures', async () => {
      await expect(tx('a', 'ab', signedBy.alice, signedBy.bob)).resolves.toEqual(true);
      await expect(tx('a', 'ab', signedBy.ai, signedBy.bob)).resolves.toEqual(true);
    });

    let msg: RevertReason = 'A->AB: from not signed by A';
    test('A->AB: from not signed from A', async () => {
      msg = 'A->AB: from not signed by A';
      await expectRevert(() => tx('a', 'ab', signedBy.bi, signedBy.all), msg);
    });

    test('A->AB: to not signed by B', async () => {
      msg = 'A->AB: to not signed by B';
      await expectRevert(() => tx('a', 'ab', signedBy.all, signedBy.alice), msg);
      await expectRevert(() => tx('a', 'ab', signedBy.all, signedBy.ai), msg);
    });

    test('A->invalid transition', async () => {
      msg = 'must transition to AB';
      await expectRevert(() => tx('a', 'none', signedBy.all, signedBy.all), msg);
      await expectRevert(() => tx('a', 'a', signedBy.all, signedBy.all), msg);
      await expectRevert(() => tx('a', 'b', signedBy.all, signedBy.all), msg);
    });
  });

  describe('transitions from B', () => {
    test('valid signatures', async () => {
      await expect(tx('b', 'ab', signedBy.bob, signedBy.alice)).resolves.toEqual(true);
      await expect(tx('b', 'ab', signedBy.bi, signedBy.alice)).resolves.toEqual(true);
    });

    let msg: RevertReason = 'B->AB: from not signed by B';

    test('B->AB: from not signed by B', async () => {
      msg = 'B->AB: from not signed by B';
      await expectRevert(() => tx('b', 'ab', signedBy.ai, signedBy.all), msg);
    });

    test('B->AB: to not signed by A', async () => {
      msg = 'B->AB: to not signed by A';
      await expectRevert(() => tx('b', 'ab', signedBy.all, signedBy.bob), msg);
      await expectRevert(() => tx('b', 'ab', signedBy.all, signedBy.bi), msg);
    });

    test('B->invalid transition', async () => {
      msg = 'must transition to AB';
      await expectRevert(() => tx('b', 'none', signedBy.all, signedBy.all), msg);
      await expectRevert(() => tx('b', 'a', signedBy.all, signedBy.all), msg);
      await expectRevert(() => tx('b', 'b', signedBy.all, signedBy.all), msg);
    });
  });

  test('transitions from AB always revert', async () => {
    const msg: RevertReason = 'AB->? not allowed';

    await expectRevert(() => tx('ab', 'none', signedBy.all, signedBy.all), msg);
    await expectRevert(() => tx('ab', 'a', signedBy.all, signedBy.all), msg);
    await expectRevert(() => tx('ab', 'b', signedBy.all, signedBy.all), msg);
    await expectRevert(() => tx('ab', 'ab', signedBy.all, signedBy.all), msg);
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
            signedBy.all,
            signedBy.bob
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
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
          signedBy.all,
          signedBy.alice
        ),
      'sig1 !by participant1'
    );
  });
});
