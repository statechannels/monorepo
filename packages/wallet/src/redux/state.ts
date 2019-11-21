import {
  OutboxState,
  emptyDisplayOutboxState,
  SideEffects,
  queueMessage as queueMessageOutbox,
  queueTransaction as queueTransactionOutbox
} from "./outbox/state";
import {
  ChannelStore,
  ChannelState,
  setChannel as setChannelInStore,
  setChannels as setChannelsInStore,
  checkAndStore as checkAndStoreChannelStore,
  checkAndInitialize as checkAndInitializeChannelStore,
  signAndStore as signAndStoreChannelStore,
  signAndInitialize as signAndInitializeChannelStore,
  emptyChannelStore,
  SignFailureReason,
  ChannelParticipant
} from "./channel-store";
import {Properties} from "./utils";
import * as NewLedgerChannel from "./protocols/new-ledger-channel/states";
import {accumulateSideEffects} from "./outbox";
import {WalletEvent} from "../magmo-wallet-client";
import {TransactionRequest} from "ethers/providers";
import {AdjudicatorState} from "./adjudicator-state/state";
import {ProcessProtocol, ProtocolLocator} from "../communication";
import {
  TerminalApplicationState,
  isTerminalApplicationState,
  isApplicationState
} from "./protocols/application/states";
import {
  TerminalFundingState,
  isFundingState,
  isTerminalFundingState
} from "./protocols/funding/states";
import {ProtocolState} from "./protocols";
import {
  isDefundingState,
  isTerminalDefundingState,
  TerminalDefundingState
} from "./protocols/defunding/states";
import {
  TerminalConcludingState,
  isConcludingState,
  isTerminalConcludingState
} from "./protocols/concluding/states";
import {SignedState, State} from "@statechannels/nitro-protocol";

export type WalletState = Initialized;

// -----------
// State types
// -----------
export const WALLET_INITIALIZED = "WALLET.INITIALIZED";

// ------
// States
// ------

export interface SharedData {
  channelStore: ChannelStore;
  outboxState: OutboxState;
  channelSubscriptions: ChannelSubscriptions;
  adjudicatorState: AdjudicatorState;
  fundingState: FundingState;
  currentProcessId?: string;
}

export interface ChannelSubscriptions {
  [channelId: string]: ChannelSubscriber[];
}
export interface ChannelSubscriber {
  protocolLocator: ProtocolLocator;
  processId: string;
}

export interface Initialized extends SharedData {
  type: typeof WALLET_INITIALIZED;

  processStore: ProcessStore;

  address: string;
  privateKey: string;
}

// TODO: Once these are fleshed out they should be moved to their own file.
export function registerChannelToMonitor(
  data: SharedData,
  processId: string,
  channelId: string,
  protocolLocator: ProtocolLocator
): SharedData {
  const subscribers = data.channelSubscriptions[channelId]
    ? [...data.channelSubscriptions[channelId]]
    : [];
  subscribers.push({processId, protocolLocator});
  return {
    ...data,
    channelSubscriptions: {
      ...data.channelSubscriptions,
      [channelId]: subscribers
    }
  };
}

export function registerBytecodeForChannel(
  data: SharedData,
  channelId: string,
  bytecode: string
): SharedData {
  return {
    ...data,
    channelStore: {
      ...data.channelStore,
      [channelId]: {
        ...data.channelStore[channelId],
        bytecode
      }
    }
  };
}

export function unregisterAllChannelToMonitor(
  data: SharedData,
  processId: string,
  protocolLocator: ProtocolLocator
): SharedData {
  const modifiedSubscriptions = {};
  for (const channelId of Object.keys(data.channelSubscriptions)) {
    const subscribers = data.channelSubscriptions[channelId].filter(
      s => s.processId !== processId && s.protocolLocator !== protocolLocator
    );
    modifiedSubscriptions[channelId] = subscribers;
  }
  return {
    ...data,
    channelSubscriptions: modifiedSubscriptions
  };
}

export interface ProcessStore {
  [processId: string]: ProcessState;
}
export interface ProcessState {
  processId: string;
  protocol: ProcessProtocol;
  protocolState: any;
  channelsToMonitor: string[];
}

export interface FundingState {
  [channelId: string]: ChannelFundingState;
}

export interface ChannelFundingState {
  directlyFunded: boolean;
  fundingChannel?: string;
  guarantorChannel?: string;
}

// ------------
// Constructors
// ------------
export const EMPTY_SHARED_DATA: SharedData = {
  outboxState: emptyDisplayOutboxState(),
  channelStore: emptyChannelStore(),
  channelSubscriptions: {},
  adjudicatorState: {},
  fundingState: {}
};

export function sharedData(params: SharedData): SharedData {
  const {
    outboxState,
    channelStore: channelState,
    adjudicatorState,
    fundingState,
    channelSubscriptions
  } = params;
  return {
    outboxState,
    channelStore: channelState,
    adjudicatorState,
    fundingState,
    channelSubscriptions
  };
}

export function initialized(params: Properties<Initialized>): Initialized {
  return {
    ...params,
    ...sharedData(params),
    type: WALLET_INITIALIZED
  };
}

// -------------------
// Getters and setters
// -------------------

export function getChannelStatus(state: SharedData, channelId: string): ChannelState {
  return state.channelStore[channelId];
}

export function setSideEffects(state: Initialized, sideEffects: SideEffects): Initialized {
  return {...state, outboxState: accumulateSideEffects(state.outboxState, sideEffects)};
}

export function setChannel(state: SharedData, channel: ChannelState): SharedData {
  return {...state, channelStore: setChannelInStore(state.channelStore, channel)};
}

export function setChannels(state: SharedData, channels: ChannelState[]): SharedData {
  return {...state, channelStore: setChannelsInStore(state.channelStore, channels)};
}

export function getChannel(state: SharedData, channelId: string): ChannelState | undefined {
  return state.channelStore[channelId];
}

export function getExistingChannel(state: SharedData, channelId: string) {
  if (!state.channelStore[channelId]) {
    throw new Error(`Channel ${channelId} not found`);
  }
  return state.channelStore[channelId];
}

export function queueMessage(state: SharedData, message: WalletEvent): SharedData {
  return {...state, outboxState: queueMessageOutbox(state.outboxState, message)};
}

export function setChannelStore(state: SharedData, channelStore: ChannelStore): SharedData {
  return {...state, channelStore};
}

export function setFundingState(
  state: SharedData,
  channelId: string,
  fundingState: ChannelFundingState
) {
  return {...state, fundingState: {...state.fundingState, [channelId]: fundingState}};
}

export function getPrivatekey(state: SharedData, channelId: string): string {
  const channel = getChannel(state, channelId);
  if (!channel) {
    throw new Error(`Channel ${channelId} missing`);
  } else {
    return channel.privateKey;
  }
}

export function signAndInitialize(
  sharedDataState: SharedData,
  state: State,
  privateKey: string,
  participants: ChannelParticipant[],
  bytecode: string
): SignResult {
  const result = signAndInitializeChannelStore(
    sharedDataState.channelStore,
    state,
    privateKey,
    participants,
    bytecode
  );
  if (result.isSuccess) {
    return {
      isSuccess: result.isSuccess,
      signedState: result.signedState,
      store: setChannelStore(sharedDataState, result.store)
    };
  } else {
    return result;
  }
}

export function checkAndInitialize(
  state: SharedData,
  signedState: SignedState,
  privateKey: string,
  participants: ChannelParticipant[],
  bytecode: string
): CheckResult {
  const result = checkAndInitializeChannelStore(
    state.channelStore,
    signedState,
    privateKey,
    participants,
    bytecode
  );
  if (result.isSuccess) {
    return {...result, store: setChannelStore(state, result.store)};
  } else {
    return result;
  }
}

export function checkAndStore(state: SharedData, signedState: SignedState): CheckResult {
  const result = checkAndStoreChannelStore(state.channelStore, signedState);
  if (result.isSuccess) {
    return {...result, store: setChannelStore(state, result.store)};
  } else {
    return result;
  }
}

type CheckResult = CheckSuccess | CheckFailure;
interface CheckSuccess {
  isSuccess: true;
  store: SharedData;
}
interface CheckFailure {
  isSuccess: false;
}

export function signAndStore(sharedDataState: SharedData, state: State): SignResult {
  const result = signAndStoreChannelStore(sharedDataState.channelStore, state);
  if (result.isSuccess) {
    return {
      isSuccess: result.isSuccess,
      signedState: result.signedState,
      store: setChannelStore(sharedDataState, result.store)
    };
  } else {
    return result;
  }
}

type SignResult = SignSuccess | SignFailure;
interface SignSuccess {
  isSuccess: true;
  signedState: SignedState;
  store: SharedData;
}
interface SignFailure {
  isSuccess: false;
  reason: SignFailureReason;
}

export function queueTransaction(
  state: SharedData,
  transaction: TransactionRequest,
  processId: string
): SharedData {
  return {
    ...state,
    outboxState: queueTransactionOutbox(state.outboxState, transaction, processId)
  };
}

export {NewLedgerChannel};

export function isTerminalProtocolState(
  protocolState: ProtocolState
): protocolState is
  | TerminalApplicationState
  | TerminalFundingState
  | TerminalDefundingState
  | TerminalConcludingState {
  return (
    (isApplicationState(protocolState) && isTerminalApplicationState(protocolState)) ||
    (isFundingState(protocolState) && isTerminalFundingState(protocolState)) ||
    (isDefundingState(protocolState) && isTerminalDefundingState(protocolState)) ||
    (isConcludingState(protocolState) && isTerminalConcludingState(protocolState))
  );
}
