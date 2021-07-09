import {Allocation, AssetOutcome} from '@statechannels/nitro-protocol';
import {Address, PrivateKey, SignedState, State, Uint256} from '@statechannels/wallet-core';
import {providers} from 'ethers';
import {Logger} from 'pino';

import {Bytes32} from '../type-aliases';

export type HoldingUpdatedArg = {
  channelId: Bytes32;
  asset: Address;
  amount: Uint256;
};

export type AllocationUpdatedArg = {
  channelId: Bytes32;
  asset: Address;
  newHoldings: Uint256;
  externalPayouts: Allocation;
  internalPayouts: Allocation;
  newAssetOutcome: AssetOutcome;
};

export type FundChannelArg = {
  channelId: Bytes32;
  asset: Address;
  expectedHeld: Uint256;
  amount: Uint256;
};

export type ChannelFinalizedArg = {
  channelId: Bytes32;
  blockNumber: number;
  blockTimestamp: number;
  finalizedAt: number;
};

export type ChallengeRegisteredArg = {
  channelId: string;
  finalizesAt: number;
  challengeStates: SignedState[];
};

export interface ChainEventSubscriberInterface<T extends void = void> {
  holdingUpdated(arg: HoldingUpdatedArg): T;
  allocationUpdated(arg: AllocationUpdatedArg): T;
  channelFinalized(arg: ChannelFinalizedArg): T;
  challengeRegistered(arg: ChallengeRegisteredArg): T;
}

interface ChainEventEmitterInterface {
  checkChainId(networkChainId: number): Promise<void>;
  registerChannel(
    channelId: Bytes32,
    assets: Address[],
    listener: ChainEventSubscriberInterface
  ): void;
  unregisterChannel(channelId: Bytes32): void;
  destructor(): void;
}

export type FundChannelRequest = {type: 'FundChannel'} & FundChannelArg;
export type ConcludeAndWithdrawRequest = {
  type: 'ConcludeAndWithdraw';
  finalizationProof: SignedState[];
};
export type WithdrawRequest = {
  type: 'Withdraw';
  state: State;
  challengerAddress: Address;
};

export type ChallengeRequest = {
  type: 'Challenge';
  challengeStates: SignedState[];
  privateKey: PrivateKey;
};

export type ChainRequest =
  | FundChannelRequest
  | ConcludeAndWithdrawRequest
  | WithdrawRequest
  | ChallengeRequest;
interface ChainModifierInterface {
  handleChainRequests(chainRequests: ChainRequest[]): Promise<providers.TransactionResponse[]>;
  fetchBytecode(address: string): Promise<string>;
}

export type ChainServiceInterface = ChainModifierInterface & ChainEventEmitterInterface;

export type AllowanceMode = 'PerDeposit' | 'MaxUint';
export type ChainServiceArgs = {
  provider: string;
  pk: string;
  pollingInterval?: number;
  allowanceMode: AllowanceMode;
  logger?: Logger;
  blockConfirmations?: number;
};
