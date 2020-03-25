import {BigNumber} from 'ethers/utils';
import {MemoryChannelStoreEntry} from './memory-channel-storage';

export interface SiteBudget {
  site: string;
  hubAddress: string;
  forAsset: Record<string, AssetBudget | undefined>;
}
export interface BudgetItem {
  playerAmount: BigNumber;
  hubAmount: BigNumber;
}
export interface AssetBudget {
  assetHolderAddress: string;
  pending: BudgetItem; // Approved by user, but not yet funded
  free: BudgetItem; // Funded, and ready to be allocated
  inUse: BudgetItem; // Funded, but currently allocated
  direct: BudgetItem;
}
export interface Participant {
  participantId: string;
  signingAddress: string;
  destination: string;
}
// signers

export interface StateVariables {
  outcome: Outcome;
  turnNum: BigNumber;
  appData: string;
  isFinal: boolean;
}

export interface AllocationItem {
  destination: string;
  amount: BigNumber;
}
export interface SimpleAllocation {
  type: 'SimpleAllocation';
  assetHolderAddress: string;
  allocationItems: AllocationItem[];
}
export interface SimpleGuarantee {
  type: 'SimpleGuarantee';
  targetChannelId: string;
  assetHolderAddress: string;
  destinations: string[];
}
export interface MixedAllocation {
  type: 'MixedAllocation';
  simpleAllocations: SimpleAllocation[];
}

// Should we even have these two different types??
export type Allocation = SimpleAllocation | MixedAllocation;
export type Outcome = Allocation | SimpleGuarantee;

export function isAllocation(outcome: Outcome): outcome is Allocation {
  return outcome.type !== 'SimpleGuarantee';
}

export interface ChannelConstants {
  chainId: string;
  participants: Participant[];
  channelNonce: BigNumber;
  appDefinition: string;
  challengeDuration: BigNumber;
}

export interface State extends ChannelConstants, StateVariables {}

interface Signed {
  signatures: string[];
}

export interface SignedState extends State, Signed {}
export interface SignedStateVariables extends StateVariables, Signed {}

type _Objective<Name, Data> = {
  participants: Participant[];
  type: Name;
  data: Data;
};
export type OpenChannel = _Objective<
  'OpenChannel',
  {
    targetChannelId: string;
  }
>;
export type VirtuallyFund = _Objective<
  'VirtuallyFund',
  {
    targetChannelId: string;
    jointChannelId: string;
  }
>;
export type FundGuarantor = _Objective<
  'FundGuarantor',
  {
    jointChannelId: string;
    ledgerId: string;
    guarantorId: string;
  }
>;
export type FundLedger = _Objective<
  'FundLedger',
  {
    ledgerId: string;
  }
>;
export type CloseLedger = _Objective<
  'CloseLedger',
  {
    ledgerId: string;
  }
>;
export type Objective = OpenChannel | VirtuallyFund | FundGuarantor | FundLedger | CloseLedger;

const guard = <T extends Objective>(name: Objective['type']) => (o: Objective): o is T =>
  o.type === name;
export const isOpenChannel = guard<OpenChannel>('OpenChannel');
export const isVirtuallyFund = guard<VirtuallyFund>('VirtuallyFund');
export const isFundGuarantor = guard<FundGuarantor>('FundGuarantor');
export const isFundLedger = guard<FundLedger>('FundLedger');
export const isCloseLedger = guard<CloseLedger>('CloseLedger');

export interface Message {
  signedStates?: SignedState[];
  objectives?: Objective[];
}

export type ToRelease = {inUse: BudgetItem; assetHolderAddress: string};

export interface DBBackend {
  initialize(cleanSlate?: boolean): Promise<any>;
  privateKeys(): Promise<Record<string, string | undefined>>;
  ledgers(): Promise<Record<string, string | undefined>>;
  nonces(): Promise<Record<string, BigNumber | undefined>>;
  objectives(): Promise<Objective[]>;
  channels(): Promise<Record<string, MemoryChannelStoreEntry | undefined>>;

  setPrivateKey(key: string, value: string): Promise<string>;
  getPrivateKey(key: string): Promise<string | undefined>;
  setChannel(key: string, value: MemoryChannelStoreEntry): Promise<MemoryChannelStoreEntry>;
  addChannel(key: string, value: MemoryChannelStoreEntry): Promise<MemoryChannelStoreEntry>;
  getChannel(key: string): Promise<MemoryChannelStoreEntry | undefined>;
  getBudget(key: string): Promise<SiteBudget | undefined>;
  setBudget(key: string, budget: SiteBudget): Promise<SiteBudget>;
  setLedger(key: string, value: string): Promise<string>;
  getLedger(key: string): Promise<string | undefined>;
  setNonce(key: string, value: BigNumber): Promise<BigNumber>;
  getNonce(key: string): Promise<BigNumber | undefined>;
  setObjective(key: number, value: Objective): Promise<Objective>;
  getObjective(key: number): Promise<Objective | undefined>;
  setReplaceObjectives(values: Objective[]): Promise<Objective[]>;
}
