import {ethers, Wallet} from 'ethers';

import {Channel, State} from '../../src';
import {requireValidProtocolTransition, Status} from '../../src/valid-transition';

const walletA = Wallet.createRandom();
const walletB = Wallet.createRandom();

const channel: Channel = {
  chainId: '0x1',
  channelNonce: 0,
  participants: [walletA.address, walletB.address], // 2 participants is the most common usecase
};

const baseFromState: State = {
  turnNum: 0,
  isFinal: false,
  appDefinition: ethers.constants.AddressZero,
  appData: '0x00',
  outcome: [{asset: ethers.constants.AddressZero, allocationItems: []}],
  channel,
  challengeDuration: 1,
};

const baseToState: State = {...baseFromState, turnNum: baseFromState.turnNum + 1};

type TestCase = [Partial<State>, Partial<State>];
type TestCaseWithError = [RegExp, Partial<State>, Partial<State>];

//prettier-ignore
const valid: TestCase[] = [
    [baseFromState, baseToState]
];
//prettier-ignore
const incorrectTurnNumCases: TestCaseWithError[] = [
    [/turnNum must increment by one/, {}, {turnNum: baseToState.turnNum + 2}],
    [/turnNum must increment by one/, {}, {turnNum: baseToState.turnNum + 3}],
]
//prettier-ignore
const changedAConstantCases: TestCaseWithError[] = [
  [/chainId must not change/, {}, { channel: {...baseToState.channel, chainId: '0x2'}}],
  [/participants must not change/, {}, { channel: {...baseToState.channel, participants: [baseToState.channel[0]]}}],
  [/channelNonce must not change/, {}, { channel: {... baseToState.channel, channelNonce: baseToState.channel.channelNonce + 1}} ],
  [/appDefinition must not change/, {}, { appDefinition: channel.participants[0]} ],
  [/challengeDuration must not change/, {}, { challengeDuration: baseToState.challengeDuration + 1}],
];
//prettier-ignore
const changedOutcomeWhenToIsFinal: TestCaseWithError[] = [
    [/Outcome change verboten/, {}, { isFinal:true, outcome: []}],
]
//prettier-ignore
const fromFinalToNotFinal: TestCaseWithError[] = [
    [/isFinal retrograde/, {isFinal:true}, {}],
]
//prettier-ignore
const changedOutcomeDuringSetup: TestCaseWithError[] = [
    [/Outcome change forbidden/, {turnNum:1}, { turnNum:2, outcome:[]}, ],
]
//prettier-ignore
const changedAppDataDuringSetup: TestCaseWithError[] = [
    [/appData change forbidden/, {turnNum:1}, { turnNum:2, appData:'0x02'}],
]
//prettier-ignore
const commonCase: TestCase[] = [
    [{turnNum:6}, {turnNum:7}],
]

function expectStatus(fromOverrides: Partial<State>, toOverrides: Partial<State>, status: Status) {
  const from = {...baseFromState, ...fromOverrides};
  const to = {...baseToState, ...toOverrides};
  expect(requireValidProtocolTransition(from, to)).toEqual(status);
}

function expectError(fromOverrides: Partial<State>, toOverrides: Partial<State>, pattern: RegExp) {
  const from = {...baseFromState, ...fromOverrides};
  const to = {...baseToState, ...toOverrides};
  expect(() => requireValidProtocolTransition(from, to)).toThrow(pattern);
}

describe('getValidProtocolTransitionStatus', () => {
  it.each(valid)('Returns Status.True for valid cases ', (from: State, to: State) => {
    expectStatus(from, to, Status.True);
  });
  it.each([
    ...incorrectTurnNumCases,
    ...changedAConstantCases,
    ...changedOutcomeWhenToIsFinal,
    ...fromFinalToNotFinal,
    ...changedOutcomeDuringSetup,
    ...changedAppDataDuringSetup,
  ])(
    'Correctly throws error matching %p',
    (pattern: RegExp, from: Partial<State>, to: Partial<State>) => {
      expectError(from, to, pattern);
    }
  );
  it.each([...commonCase])(
    'Returns Status.NeedToCheckApp for otherwise valid cases ',
    (from: State, to: State) => {
      expectStatus(from, to, Status.NeedToCheckApp);
    }
  );
});
