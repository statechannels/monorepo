import {SignedState, getChannelId} from '@statechannels/nitro-protocol';
import {ChannelParticipant} from '@statechannels/wallet/lib/src/redux/channel-store';

export interface BaseProcessAction {
  processId: string;
  type: string;
}

// FUNDING

export const signedStatesReceived = (p: {
  protocolLocator: ProtocolLocator;
  signedStates: SignedState[];
  processId: string;
}): SignedStatesReceived => ({
  ...p,
  type: 'WALLET.COMMON.SIGNED_STATES_RECEIVED'
});

export const strategyApproved: ActionConstructor<StrategyApproved> = p => ({
  ...p,
  type: 'WALLET.FUNDING_STRATEGY_NEGOTIATION.STRATEGY_APPROVED'
});

// -------
// Actions
// -------

export interface ChannelOpen {
  type: 'Channel.Open';
  signedState: SignedState;
  participants: ChannelParticipant[];
}

export interface ChannelJoined {
  type: 'Channel.Joined';
  signedState: SignedState;
  participants: ChannelParticipant[];
}

export interface CloseLedgerChannel {
  type: 'WALLET.NEW_PROCESS.CLOSE_LEDGER_CHANNEL';
  channelId: string;
  protocol: ProcessProtocol.CloseLedgerChannel;
}

export interface MultipleRelayableActions {
  type: 'WALLET.MULTIPLE_RELAYABLE_ACTIONS';
  actions: RelayableAction[];
}

export interface StrategyProposed extends BaseProcessAction {
  type: 'WALLET.FUNDING_STRATEGY_NEGOTIATION.STRATEGY_PROPOSED';
  strategy: FundingStrategy;
}

export interface StrategyApproved extends BaseProcessAction {
  type: 'WALLET.FUNDING_STRATEGY_NEGOTIATION.STRATEGY_APPROVED';
  strategy: FundingStrategy;
}
export interface ConcludeInstigated {
  type: 'WALLET.NEW_PROCESS.CONCLUDE_INSTIGATED';
  protocol: ProcessProtocol.Concluding;
  channelId: string;
}

export interface SignedStatesReceived extends BaseProcessAction {
  type: 'WALLET.COMMON.SIGNED_STATES_RECEIVED';
  protocolLocator: ProtocolLocator;
  signedStates: SignedState[];
}

export type RelayableAction =
  | ChannelOpen
  | ChannelJoined
  | StrategyProposed
  | StrategyApproved
  | ConcludeInstigated
  | SignedStatesReceived
  | CloseLedgerChannel
  | MultipleRelayableActions
  | ConcludeInstigated;

export type ActionConstructor<T> = (p: Pick<T, Exclude<keyof T, 'type' | 'protocol'>>) => T;

export interface RelayActionWithMessage {
  type: 'WALLET.RELAY_ACTION_WITH_MESSAGE';
  toParticipantId: string;
  fromParticipantId: string;
  actionToRelay: RelayableAction;
}

export const relayActionWithMessage: ActionConstructor<RelayActionWithMessage> = p => ({
  ...p,

  type: 'WALLET.RELAY_ACTION_WITH_MESSAGE'
});

// These protocols are precisely those that run at the top-level
export const enum ProcessProtocol {
  Application = 'Application',
  Funding = 'Funding',
  Concluding = 'Concluding',
  CloseLedgerChannel = 'CloseLedgerChannel'
}

export const enum EmbeddedProtocol {
  AdvanceChannel = 'AdvanceChannel',
  ConsensusUpdate = 'ConsensusUpdate',
  DirectFunding = 'DirectFunding', // TODO: Post-fund-setup exchange will be removed from direct funding, so this should be removed
  ExistingLedgerFunding = 'ExistingLedgerFunding',
  LedgerDefunding = 'LedgerDefunding',
  LedgerFunding = 'LedgerFunding',
  LedgerTopUp = 'LedgerTopUp',
  NewLedgerChannel = 'NewLedgerChannel',
  VirtualFunding = 'VirtualFunding',
  FundingStrategyNegotiation = 'FundingStrategyNegotiation',
  VirtualDefunding = 'VirtualDefunding',
  Defunding = 'Defunding'
}

export type ProtocolLocator = EmbeddedProtocol[];
export type FundingStrategy = 'IndirectFundingStrategy' | 'VirtualFundingStrategy';

export type StartProcessAction = ConcludeInstigated;

export function isStartProcessAction(a: {type: string}): a is StartProcessAction {
  return a.type === 'WALLET.NEW_PROCESS.CONCLUDE_INSTIGATED';
}

export function getProcessId(action: ChannelOpen) {
  const processId = 'Funding-' + getChannelId(action.signedState.state.channel);
  return `Funding-${processId}`;
}
