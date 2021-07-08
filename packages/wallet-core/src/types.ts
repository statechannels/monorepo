import {FundingStrategy} from '@statechannels/client-api-schema';
import {utils} from 'ethers';

export type Uint256 = string & {_isUint256: void};
// These "integers" have "type-safe" addition:
// const a: Uint256 = '0xa' as Uint256;
// const b: Uint256 = '0xb' as Uint256;
// const s: Uint256 = a + b; // Type error: Type 'string' is not assignable to type 'Uint256'

export interface DomainBudget {
  domain: string;
  hubAddress: string;
  forAsset: Record<string, AssetBudget | undefined>;
}

interface ChannelBudgetEntry {
  amount: Uint256;
}
export interface AssetBudget {
  asset: string;
  availableReceiveCapacity: Uint256;
  availableSendCapacity: Uint256;
  channels: Record<string, ChannelBudgetEntry>;
}
export interface Participant {
  participantId: string;
  signingAddress: Address;
  destination: Destination;
}
// signers

export interface StateVariables {
  outcome: Outcome;
  turnNum: number;
  appData: string;
  isFinal: boolean;
}
export type StateVariablesWithHash = StateVariables & Hashed;
export type Destination = string & {_isDestination: void};
export interface AllocationItem {
  destination: Destination;
  amount: Uint256;
}
export interface SimpleAllocation {
  type: 'SimpleAllocation';
  asset: Address;
  allocationItems: AllocationItem[];
}
export interface SimpleGuarantee {
  type: 'SimpleGuarantee';
  targetChannelId: string;
  asset: Address;
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
  channelNonce: number;
  appDefinition: Address;
  challengeDuration: number;
}

export interface State extends ChannelConstants, StateVariables {}

export interface Signed {
  signatures: SignatureEntry[];
}
export interface Hashed {
  stateHash: string;
}
export type StateWithHash = State & Hashed;
export type SignedState = State & Signed;
export type SignedStateWithHash = SignedState & Hashed;

export type SignedStateVariables = StateVariables & Signed;
export type SignedStateVarsWithHash = SignedStateVariables & Hashed;

type _Objective<Name, Data> = {
  participants: Participant[];
  type: Name;
  data: Data;
};
export type OpenChannel = _Objective<
  'OpenChannel',
  {
    targetChannelId: string;
    fundingStrategy: FundingStrategy;
    role?: 'app' | 'ledger'; // Default should be app
    fundingLedgerChannelId?: string;
  }
>;
export type CloseChannel = _Objective<
  'CloseChannel',
  {
    targetChannelId: string;
    fundingStrategy: FundingStrategy;
    /**
     * Collaboratively concluding a channel on-chain involves the following:
     * 1. Submit a conclusion proof to the NitroAdjudicator.
     * 2. Push the outcome to all AssetHolders.
     * 3. Transfer out of the channel for all asset holders.
     *
     * Steps 1 and 2 require one or two transactions that are submitted by one participant
     * but affect (and block) both participants. txSubmitterOrder defines the order in which
     * participants will try to submit the collaborative transactions.
     *
     * CAVEAT:
     * Let's say 2 participants are concluding a channel with:
     * - txSubmitterOrder of [0, 1]
     * - participant 0 has no funds in the channel.
     * In the above, participant 0 is expected to NOT submit any collaborative transactions.
     */
    txSubmitterOrder: number[];
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

export type SubmitChallenge = _Objective<
  'SubmitChallenge',
  {
    targetChannelId: string;
  }
>;

export type DefundChannel = _Objective<
  'DefundChannel',
  {
    targetChannelId: string;
  }
>;

export type SharedObjective =
  | OpenChannel
  | CloseChannel
  | VirtuallyFund
  | FundGuarantor
  | FundLedger
  | CloseLedger;

export type Objective = SharedObjective | SubmitChallenge | DefundChannel;

const guard = <T extends Objective>(name: Objective['type']) => (o: Objective): o is T =>
  o.type === name;
export const isOpenChannel = guard<OpenChannel>('OpenChannel');
export const isCloseChannel = guard<CloseChannel>('CloseChannel');
export const isVirtuallyFund = guard<VirtuallyFund>('VirtuallyFund');
export const isFundGuarantor = guard<FundGuarantor>('FundGuarantor');
export const isFundLedger = guard<FundLedger>('FundLedger');
export const isCloseLedger = guard<CloseLedger>('CloseLedger');
export const isSubmitChallenge = guard<SubmitChallenge>('SubmitChallenge');
export const isDefundChannel = guard<DefundChannel>('DefundChannel');

export function calculateObjectiveId(objectiveType: Objective['type'], channelId: string): string {
  return `${objectiveType}-${channelId}`;
}

export function objectiveId(objective: Objective): string {
  switch (objective.type) {
    case 'OpenChannel':
    case 'CloseChannel':
    case 'VirtuallyFund':
    case 'SubmitChallenge':
    case 'DefundChannel':
      return calculateObjectiveId(objective.type, objective.data.targetChannelId);
    case 'FundGuarantor':
      return calculateObjectiveId(objective.type, objective.data.guarantorId);
    case 'FundLedger':
    case 'CloseLedger':
      return calculateObjectiveId(objective.type, objective.data.ledgerId);
  }
}

type GetChannel = {type: 'GetChannel'; channelId: string};
export type ChannelRequest = GetChannel;

export interface Payload {
  walletVersion: string;
  signedStates?: SignedState[];
  objectives?: SharedObjective[];
  requests?: ChannelRequest[];
}

export type ChannelStoredData = {
  stateVariables: Array<SignedStateVarsWithHash>;
  channelConstants: ChannelConstants;
  funding: Funding | undefined;
  applicationDomain: string | undefined;
  myIndex: number;
};

export interface SignatureEntry {
  signature: string;
  signer: Address;
}

interface DirectFunding {
  type: 'Direct';
}

interface IndirectFunding {
  type: 'Indirect';
  ledgerId: string;
}

export interface VirtualFunding {
  type: 'Virtual';
  jointChannelId: string;
}

interface Guarantee {
  type: 'Guarantee';
  guarantorChannelId: string;
}

interface Guarantees {
  type: 'Guarantees';
  guarantorChannelIds: [string, string];
}

export type Funding = DirectFunding | IndirectFunding | VirtualFunding | Guarantees | Guarantee;
export function isIndirectFunding(funding?: Funding): funding is IndirectFunding {
  return funding?.type === 'Indirect';
}

export function isVirtualFunding(funding?: Funding): funding is VirtualFunding {
  return funding?.type === 'Virtual';
}

export function isGuarantee(funding?: Funding): funding is Guarantee {
  return funding?.type === 'Guarantee';
}
export function isGuarantees(funding?: Funding): funding is Guarantees {
  return funding?.type === 'Guarantees';
}

function makeBytes<T extends string>(length: number, bytes: string) {
  const bytesRegex = new RegExp(`^0x[0-9a-fA-F]{${length}}$`);
  if (!bytesRegex.test(bytes)) {
    throw new Error(`Invalid byte string ${bytes}`);
  }
  return bytes.toLowerCase() as T;
}
const makeBytesCurried: <T extends string>(length: number) => (bytes: string) => T = (
  length: number
) => (bytes: string) => makeBytes(length, bytes);

export type PrivateKey = string & {_isPrivateKey: void};
export const makePrivateKey: (input: string) => PrivateKey = makeBytesCurried<PrivateKey>(64);

export type Address = string & {_isAddressKey: void};
export function makeAddress(input: string): Address {
  return utils.getAddress(input) as Address;
}
