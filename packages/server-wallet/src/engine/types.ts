import {
  UpdateChannelParams,
  CreateChannelParams,
  SyncChannelParams,
  CloseChannelParams,
  GetStateParams,
  ChannelId,
  ChannelResult,
} from '@statechannels/client-api-schema';

import {WalletObjective} from '../models/objective';
import {Outgoing} from '../protocols/actions';
import {Bytes32, WireMessage} from '../type-aliases';

export type SingleChannelOutput = {
  outbox: Outgoing[];
  channelResult: ChannelResult;
  newObjective: WalletObjective | undefined;
};
export type MultipleChannelOutput = {
  outbox: Outgoing[];
  channelResults: ChannelResult[];
  newObjectives: WalletObjective[];
  messagesByObjective: Record<string, WireMessage[]>;
};

export type SyncObjectiveResult = {
  messagesByObjective: Record<string, WireMessage[]>;
  outbox: Outgoing[];
};
export type Output = SingleChannelOutput | MultipleChannelOutput;

type ChannelUpdatedEvent = {
  type: 'channelUpdated';
  value: SingleChannelOutput;
};

export type EngineEvent = ChannelUpdatedEvent;

export interface EngineInterface {
  // App utilities
  registerAppDefinition(appDefinition: string): Promise<void>;
  registerAppBytecode(appDefinition: string, bytecode: string): Promise<void>;
  // App channel management
  createChannels(
    args: CreateChannelParams,
    numberOfChannels: number
  ): Promise<MultipleChannelOutput>;

  joinChannels(channelIds: ChannelId[]): Promise<MultipleChannelOutput>;
  updateChannel(args: UpdateChannelParams): Promise<SingleChannelOutput>;
  closeChannel(args: CloseChannelParams): Promise<SingleChannelOutput>;
  getChannels(): Promise<MultipleChannelOutput>;
  getState(args: GetStateParams): Promise<SingleChannelOutput>;

  syncChannels(chanelIds: Bytes32[]): Promise<MultipleChannelOutput>;
  syncChannel(args: SyncChannelParams): Promise<SingleChannelOutput>;

  challenge(channelId: string): Promise<SingleChannelOutput>;

  // Engine <-> Engine communication
  pushMessage(m: unknown): Promise<MultipleChannelOutput>;
  pushUpdate(m: unknown): Promise<SingleChannelOutput>;
}

export function hasNewObjective(
  response: SingleChannelOutput
): response is SingleChannelOutput & {newObjective: WalletObjective} {
  return !!response.newObjective;
}
