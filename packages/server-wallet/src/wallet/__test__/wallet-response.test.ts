import {ChannelResult} from '@statechannels/client-api-schema';
import _ from 'lodash';

import {channelWithVars} from '../../models/__test__/fixtures/channel';
import {Notice} from '../../protocols/actions';
import {addHash} from '../../state-utils';
import {WalletResponse} from '../wallet-response';

import {stateSignedBy} from './fixtures/states';

describe('mergeChannelResults', () => {
  test('it merges channel results with multiple channel id entries', () => {
    const duplicateChannelResult: ChannelResult[] = [
      channelWithVars({vars: [addHash(stateSignedBy()({turnNum: 1}))]}).channelResult,
      channelWithVars({vars: [addHash(stateSignedBy()({turnNum: 2}))]}).channelResult,
    ];
    const response = WalletResponse.initialize();
    for (const channelResult of duplicateChannelResult) {
      response.queueChannelResult(channelResult);
    }
    const result = response.channelResults;
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({turnNum: 2});
  });

  test("it doesn't merge different channels", () => {
    const duplicateChannelResult: ChannelResult[] = [
      channelWithVars({channelId: '0x123'}).channelResult,
      channelWithVars({channelId: '0xabc'}).channelResult,
    ];
    const response = WalletResponse.initialize();
    for (const channelResult of duplicateChannelResult) {
      response.queueChannelResult(channelResult);
    }
    const result = response.channelResults;
    expect(result).toHaveLength(2);
  });
});

describe('mergeOutgoing', () => {
  const USER1 = 'Recipient1';
  const USER2 = 'Recipient2';

  test('it merges two messages with the same recipient', () => {
    const state1 = stateSignedBy()({turnNum: 1});
    const state2 = stateSignedBy()({turnNum: 2});

    const message1: Notice = {
      method: 'MessageQueued',
      params: {recipient: USER1, sender: USER2, data: {signedStates: [state1]}},
    };
    const message2: Notice = {
      method: 'MessageQueued',
      params: {recipient: USER1, sender: USER2, data: {signedStates: [state2]}},
    };

    const merged = WalletResponse.mergeOutgoing([message2, message1]);
    expect(merged).toHaveLength(1);

    expect((merged[0] as any).params.data.signedStates).toHaveLength(2);
    // Merging should sort the states by ascending turnNum
    expect(
      (merged[0] as any).params.data.signedStates.map((s: {turnNum: number}) => s.turnNum)
    ).toEqual([1, 2]);
  });

  test('it handles duplicate states', () => {
    const state = stateSignedBy()({turnNum: 1});

    const message: Notice = {
      method: 'MessageQueued',
      params: {recipient: USER1, sender: USER2, data: {signedStates: [state]}},
    };
    // We perform a deep clone to avoid things passing due to object references being the same
    const merged = WalletResponse.mergeOutgoing([message, _.cloneDeep(message)]);
    expect(merged).toHaveLength(1);

    expect((merged[0] as any).params.data.signedStates).toHaveLength(1);
  });
});
