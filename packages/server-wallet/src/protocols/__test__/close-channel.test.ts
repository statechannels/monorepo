import {simpleEthAllocation, BN, State} from '@statechannels/wallet-core';
import matchers from '@pacote/jest-either';

import {protocol} from '../close-channel';
import {alice} from '../../wallet/__test__/fixtures/participants';
import {SignState} from '../actions';

import {applicationProtocolState} from './fixtures/protocol-state';

expect.extend(matchers);

const outcome = simpleEthAllocation([{amount: BN.from(5), destination: alice().destination}]);

const postFundState = {outcome, turnNum: 3};
const closingState = {outcome, turnNum: 4, isFinal: true};

const runningState = {outcome, turnNum: 7};
const closingState2 = {outcome, turnNum: 8, isFinal: true};

const signState = (state: Partial<State>): Partial<SignState> => ({type: 'SignState', ...state});

// TODO: (Stored Objectives) write a test to confirm it signs a new isFinal state if you tell it to

test.each`
  supported        | latestSignedByMe | latest           | action                      | cond                                                                  | result
  ${closingState}  | ${postFundState} | ${closingState}  | ${signState(closingState)}  | ${'when the postfund state is supported, and the channel is closing'} | ${'signs the final state'}
  ${closingState2} | ${runningState}  | ${closingState2} | ${signState(closingState2)} | ${'when the postfund state is supported, and the channel is closing'} | ${'signs the final state'}
`('$result $cond', ({supported, latest, latestSignedByMe, action}) => {
  const ps = applicationProtocolState({app: {supported, latest, latestSignedByMe}});
  expect(protocol(ps)).toMatchObject(action);
});

// todo: add the following test case once https://github.com/statechannels/the-graph/issues/80 is resolved
//
test.each`
  supported       | latestSignedByMe | latest          | cond
  ${closingState} | ${closingState}  | ${closingState} | ${'when I have signed a final state'}
`('takes no action $cond', ({supported, latest, latestSignedByMe}) => {
  const ps = applicationProtocolState({app: {supported, latest, latestSignedByMe}});
  expect(protocol(ps)).toMatchObject({
    type: 'CompleteObjective',
    channelId: ps.app.channelId,
  });
});
