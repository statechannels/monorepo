import {
  UpdateChannelParams,
  CreateChannelParams,
  SyncChannelParams,
  CloseChannelParams,
  GetStateParams,
  ChannelId,
  ChannelResult,
} from '@statechannels/client-api-schema';
import {Address as CoreAddress} from '@statechannels/wallet-core';

import {DBObjective} from '../models/objective';
import {Outgoing} from '../protocols/actions';
import {Bytes32, Uint256} from '../type-aliases';

export interface UpdateChannelFundingParams {
  channelId: ChannelId;
  assetHolderAddress?: CoreAddress;
  amount: Uint256;
}

export type SingleChannelOutput = {
  outbox: Outgoing[];
  channelResult: ChannelResult;
  newObjective: DBObjective | undefined;
};
export type MultipleChannelOutput = {
  outbox: Outgoing[];
  channelResults: ChannelResult[];
  newObjectives: DBObjective[];
};

export type Output = SingleChannelOutput | MultipleChannelOutput;

type ChannelUpdatedEvent = {
  type: 'channelUpdated';
  value: SingleChannelOutput;
};

type ObjectiveStarted = {
  type: 'objectiveStarted';
  value: DBObjective;
};
type ObjectiveSucceeded = {
  type: 'objectiveSucceeded';
  value: DBObjective;
};

export type WalletEvent = ChannelUpdatedEvent | ObjectiveStarted | ObjectiveSucceeded;

export interface WalletInterface {
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

  updateFundingForChannels(args: UpdateChannelFundingParams[]): Promise<MultipleChannelOutput>;
  // Wallet <-> Wallet communication
  pushMessage(m: unknown): Promise<MultipleChannelOutput>;
  pushUpdate(m: unknown): Promise<SingleChannelOutput>;
}
