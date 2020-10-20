import {State} from '@statechannels/wallet-core';
import {Transaction} from 'knex';

import {Store} from '../wallet/store';
import {Bytes32} from '../type-aliases';

import {Protocol, ProtocolResult, ChannelState, stage, Stage} from './state';
import {signState, noAction, CompleteObjective, completeObjective} from './actions';

export type ProtocolState = {app: ChannelState};

const stageGuard = (guardStage: Stage) => (s: State | undefined): s is State =>
  !!s && stage(s) === guardStage;

const isFinal = stageGuard('Final');

const signFinalState = (ps: ProtocolState): ProtocolResult | false =>
  !!ps.app.supported &&
  !isFinal(ps.app.latestSignedByMe) &&
  signState({
    channelId: ps.app.channelId,
    ...ps.app.supported,
    turnNum: ps.app.supported.turnNum + (isFinal(ps.app.supported) ? 0 : 1),
    isFinal: true,
  });

const completeCloseChannel = (ps: ProtocolState): CompleteObjective | false =>
  (ps.app.support || []).every(isFinal) &&
  isFinal(ps.app.latestSignedByMe) &&
  completeObjective({channelId: ps.app.channelId});

export const protocol: Protocol<ProtocolState> = (ps: ProtocolState): ProtocolResult =>
  completeCloseChannel(ps) || signFinalState(ps) || noAction;

/**
 * Helper method to retrieve scoped data needed for CloseChannel protocol.
 */
export const getCloseChannelProtocolState = async (
  store: Store,
  channelId: Bytes32,
  tx: Transaction
): Promise<ProtocolState> => {
  const app = await store.getChannel(channelId, tx);
  switch (app.fundingStrategy) {
    case 'Direct':
    case 'Unfunded':
      return {app};
    case 'Ledger':
    case 'Unknown':
    case 'Virtual':
    default:
      throw new Error('getCloseChannelProtocolState: Unimplemented funding strategy');
  }
};
