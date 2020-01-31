import { assign, DoneInvokeEvent } from 'xstate';

import { Participant, Store } from '../../store';
import { connectToStore } from '../../machine-utils';
import { Channel } from '../..';
import { CHAIN_ID } from '../../constants';

import { CreateNullChannel } from '..';

export interface Init {
  participants: Participant[];
}

const assignLedgerChannelId = assign(
  (ctx: Init, { data }: DoneInvokeEvent<{ channelId: string }>) => ({
    ...ctx,
    ledgerChannelId: data.channelId,
  })
);

/*
My wallet's rule is to have at most one (directly funded) ledger channel open with any given peer.
Therefore, two correct wallets should agree on which existing ledger channel, if any, to use
in order to fund the target channel.

A peer is identified by their participantId.
*/

const lookForExistingChannel = {
  invoke: {
    src: 'findLedgerChannelId',
    onDone: [
      {
        target: 'success',
        cond: 'channelFound',
        actions: assignLedgerChannelId,
      },
      { target: 'determineLedgerChannel' },
    ],
  },
};

const determineLedgerChannel = {
  invoke: {
    src: 'getNullChannelArgs',
    onDone: 'createNewLedger',
  },
};

const createNewLedger = {
  invoke: {
    src: 'createNullChannel',
    data: (_, { data }: DoneInvokeEvent<CreateNullChannel.Init>) => data,
    onDone: { target: 'success', actions: assignLedgerChannelId },
  },
};
type LedgerExists = Init & { ledgerChannelId: string };

export type DoneData = { ledgerChannelId: string };
const config = {
  initial: 'lookForExistingChannel',
  states: {
    lookForExistingChannel,
    determineLedgerChannel,
    createNewLedger,
    success: {
      type: 'final' as 'final',
      data: ({ ledgerChannelId }: LedgerExists): DoneData => ({ ledgerChannelId }),
    },
  },
};

type LedgerLookup = { type: 'FOUND'; channelId: string } | { type: 'NOT_FOUND' };
const guards = {
  channelFound: (_, { data }: DoneInvokeEvent<LedgerLookup>) => data.type === 'FOUND',
};

const getNullChannelArgs = (store: Store) => async ({
  participants,
}: Init): Promise<CreateNullChannel.Init> => {
  const channel: Channel = {
    participants: participants.map(p => p.signingAddress),
    channelNonce: store.getNextNonce(participants.map(p => p.signingAddress)),
    chainId: CHAIN_ID,
  };

  return { channel };
};

const options = (store: Store) => ({
  services: {
    createNullChannel: CreateNullChannel.machine(store),
    findLedgerChannelId: () => Promise.resolve('NOT_FOUND'),
    getNullChannelArgs: getNullChannelArgs(store),
  },
  guards,
});
export const machine = connectToStore(config, options);
