/* eslint-disable tsdoc/syntax */ // because @pattern is used by ts-json-schema-generator
/**
 * Ethereum Address
 * @pattern  ^0x([a-fA-F0-9]{40})|0$
 */
export type Address = string;

/**
 * Nitro ChannelId
 * @pattern  ^0x([a-fA-F0-9]{64})$
 */
export type ChannelId = string;

/**
 * Nitro ChannelId
 * @pattern  ^0x(0{24})([a-fA-F0-9]{40})$
 */
export type ExternalDestination = string; // currently unused in this schema

/**
 * Bytes32
 * @pattern  ^0x([a-fA-F0-9]{64})$
 */
export type Bytes32 = string;

export type Uint48 = number;

/**
 * Uint256
 * @pattern  ^0x([a-fA-F0-9]{64})$
 */
export type Uint256 = string;

/**
 * Container for data specific to a single state channel participant
 */
export interface Participant {
  /**
   * App allocated id, used for relaying messages to the participant
   */
  participantId: string;
  /**
   * Address used to sign channel updates
   */
  signingAddress: Address;
  /**
   * Address of EOA to receive channel proceeds (the account that'll get the funds).
   */
  destination: Address;
}

/**
 * Assigns some amount of an unspecified asset to a destination
 */
export interface AllocationItem {
  /**
   * Address of EOA to receive channel proceeds.
   */
  destination: Address;
  /**
   * How much funds will be transferred to the destination address.
   */
  amount: Uint256;
}

/**
 * Array of destination-amount pairings for a given token
 */
export interface Allocation {
  /**
   * The contract address of the asset
   */
  asset: Address;
  /**
   * Array of destination-amount pairings
   */
  allocationItems: AllocationItem[];
}

/**
 * Included for backwards compatibility
 */
export type Allocations = Allocation[];

export interface ChannelBudget {
  channelId: Bytes32;
  amount: Uint256;
}

export interface TokenBudget {
  asset: Address;
  availableReceiveCapacity: Uint256;
  availableSendCapacity: Uint256;
  channels: ChannelBudget[];
}
export interface DomainBudget {
  domain: string;
  hubAddress: string;
  budgets: TokenBudget[];
}

export interface Funds {
  asset: Address;
  amount: Uint256;
}

export type ChannelStatus =
  | 'proposed' // The wallet is storing this channel, but you have not joined it -- ie. you have not yet signed a state.
  | 'opening' // You have joined the channel, but it's not ready to use.
  | 'funding' // Same as 'opening'?
  | 'running' // You are free to use the channel.
  | 'challenging' // You cannot use the channel right now. There is a challenge ongoing, but you do not need to do anything.
  | 'responding' // There is a challenge ongoing, and you must call `updateChannel` in order for the wallet to respond to the challenge.
  | 'closing' // You cannot use the channel anymore, but your funds are still locked up.
  | 'closed'; // Your funds have been released from the channel.

/*
At the moment, the following caveats apply:
- Only works with Outcomes with one AssetHolder
- For any funding other than 'Direct', 'Uncategorized' is always returned
*/
export type FundingStatus =
  | 'Uncategorized' // Does not fit into any categories below
  /*
  Means the following conditions hold:
   - AssetHolder has A deposited.
   - Participants before me should deposit B.
   - I should deposit M
   - B <= A < A+M
   */
  | 'ReadyToFund'
  | 'Funded' // AssetHolder holds funds from all participants
  | 'Defunded'; // MY funds have been withdrawn from AssetHolder

export interface ChannelResult {
  participants: Participant[];
  allocations: Allocation[];
  appData: string;
  appDefinition: Address;
  channelId: ChannelId;
  status: ChannelStatus;
  turnNum: Uint48;
  adjudicatorStatus: 'Challenge' | 'Open' | 'Finalized';
  fundingStatus?: FundingStatus;
}

/**
 * Format of message sent from the wallet to the app
 *
 * @remarks The app relays it to another participant.
 */
export interface Message {
  /**
   * Identifier of user that the message should be relayed to
   */
  recipient: string;
  /**
   * Identifier of user that the message is from
   */
  sender?: string;
  /**
   * Message payload. Format defined by wallet and opaque to app.
   */
  data: unknown;
}
