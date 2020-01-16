import { AnyEventObject, ConditionPredicate, Machine, MachineConfig } from 'xstate';
import { MachineFactory, IStore } from '../..';

const PROTOCOL = 'advance-channel';
/*
Fully determined: true

In the current wallet, the post-fund-setup version of advance-channel is responsible for
storing state updates as they come in.
In this spec, the store itself is responsible for that, so you can wait to spin up an
advance-channel protocol once app funding is confirmed.

Additionally, waiting until it's your turn isn't necessary once the channel is funded.
An app should refrain from taking an app move until the entire post-fund round is supported,
since their application updates are otherwise unenforcable.

Therefore, we send on entry into the protocol.
*/

export interface Init {
  channelId: string;
  targetTurnNum: number; // should either be numParticipants-1 or 2*numParticipants-1
}

const toSuccess = {
  target: 'success',
  cond: 'advanced',
};
const sendingState = {
  invoke: {
    src: 'sendState',
    onDone: 'waiting',
  },
};
const waiting = {
  on: {
    CHANNEL_UPDATED: toSuccess,
    '': toSuccess,
  },
};

export const config: MachineConfig<Init, any, AnyEventObject> = {
  key: PROTOCOL,
  initial: 'sendingState',
  states: {
    sendingState,
    waiting,
    success: { type: 'final' },
  },
};

export type Guards = {
  advanced: ConditionPredicate<Init, AnyEventObject>;
};

export type Actions = {};
export type Services = {
  sendState(ctx: Init): Promise<void>;
};

export const mockOptions = {
  guards: { advanced: context => true },
  services: async () => true,
};

export const machine: MachineFactory<Init, any> = (store: IStore, context?: Init) => {
  const guards: Guards = {
    advanced: ({ channelId, targetTurnNum }: Init, event, { state: s }) => {
      const latestEntry = store.getEntry(channelId);
      if (!latestEntry.hasSupportedState) {
        return false;
      }
      return latestEntry.latestSupportedState.turnNum >= targetTurnNum;
    },
  };

  const actions: Actions = {};

  const services: Services = {
    sendState: async ({ channelId, targetTurnNum }: Init) => {
      const turnNum = targetTurnNum;
      /*
      TODO: the actual turnNum is calculated below. However, to determine whether
      a state is supported requires us to implement signature checking.
      const turnNum =
        targetTurnNum - channel.participants.length + ourIndex + 1;
      */

      try {
        const { latestSupportedState } = store.getEntry(channelId);
        if (latestSupportedState.turnNum < targetTurnNum) {
          store.sendState({ ...latestSupportedState, turnNum });
        }
      } catch (e) {
        // TODO: Check error
        const { latestState } = store.getEntry(channelId);
        store.sendState({ ...latestState, turnNum });
      }
    },
  };
  const options = { guards, actions, services };
  return Machine(config).withConfig(options, context);
};
