import { Machine, MachineConfig } from 'xstate';

import { AllocationAssetOutcome } from '@statechannels/nitro-protocol';

import { MachineFactory } from '../../machine-utils';
import { Store, success } from '../..';

import { Participant } from '../../store';

import { AdvanceChannel, DirectFunding } from '..';

const PROTOCOL = 'create-and-direct-fund';

export enum Indices {
  Left = 0,
  Right = 0,
}

export type Init = {
  participants: Participant[];
  allocations: AllocationAssetOutcome[];
  appDefinition: string;
  appData: string;
  channelId: string;
  challengeDuration: number;
  index: Indices;
};

export type FirstStateConstructed = Init & { type: 'FIRST_STATE_CONSTRUCTED' };

export const advanceChannelArgs = (i: 1 | 3) => ({ channelId }: Init): AdvanceChannel.Init => ({
  channelId,
  targetTurnNum: i,
});

const constructFirstState = {
  invoke: {
    id: 'constructFirstState',
    src: 'constructFirstState',
    onDone: 'preFundSetup',
  },
};

const preFundSetup = {
  invoke: {
    id: 'preFundSetup',
    src: 'advanceChannel',
    data: advanceChannelArgs(1),
    onDone: 'directFunding',
  },
  on: { CHANNEL_CLOSED: 'abort' },
};

// FIXME: Abort should not be success
const abort = success;

const directFunding = {
  invoke: {
    src: 'directFunding',
    data: ({ allocations, channelId }: FirstStateConstructed): DirectFunding.Init => {
      return {
        channelId,
        // TODO: Error handling on non-0 case ... also multi-asset
        minimalAllocation: allocations[0].allocationItems,
      };
    },
    onDone: 'postFundSetup',
  },
};

const postFundSetup = {
  invoke: {
    id: 'postFundSetup',
    src: 'advanceChannel',
    data: advanceChannelArgs(3),
    onDone: 'success',
  },
};

type Context = Init;
export const config: MachineConfig<Context, any, any> = {
  key: PROTOCOL,
  initial: 'constructFirstState',
  states: {
    constructFirstState,
    preFundSetup,
    abort,
    directFunding,
    postFundSetup,
    success: {
      type: 'final' as 'final',
    },
  },
};

export const machine: MachineFactory<Init, any> = (store: Store, init: Init) => {
  async function constructFirstState(ctx: Init): Promise<FirstStateConstructed> {
    const { appData, appDefinition, channelId, challengeDuration } = ctx;

    store.sendState({
      channel: store.getEntry(channelId).channel,
      appData,
      appDefinition,
      isFinal: false,
      turnNum: 0,
      outcome: [],
      challengeDuration,
    });

    return { ...ctx, type: 'FIRST_STATE_CONSTRUCTED' };
  }

  const services = {
    constructFirstState,
    directFunding: DirectFunding.machine(store),
    advanceChannel: AdvanceChannel.machine(store),
  };

  const options = { services };

  return Machine(config).withConfig(options, init);
};
