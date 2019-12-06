/* tslint:disable */
/**
 * This file was automatically generated by json-schema-to-typescript.
 * DO NOT MODIFY IT BY HAND. Instead, modify the source JSONSchema file,
 * and run json-schema-to-typescript to regenerate this file.
 */

/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "AddressOrEmpty".
 */
export type AddressOrEmpty = string;
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "Address".
 */
export type Address = string;
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "ChannelId".
 */
export type ChannelId = string;
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "Amount".
 */
export type Amount = string;
export type ParticipantId = string;
export type SigningAddress = string;
export type Destination = string;
export type Destination1 = string;
export type Amount1 = string;
export type Token = string;
export type AllocationItems = AllocationItem[];

export interface Definitions {
  [k: string]: any;
}
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "Participant".
 */
export interface Participant {
  participantId: ParticipantId;
  signingAddress: SigningAddress;
  destination: Destination;
  [k: string]: any;
}
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "AllocationItem".
 */
export interface AllocationItem {
  destination: Destination1;
  amount: Amount1;
  [k: string]: any;
}
/**
 * This interface was referenced by `Definitions`'s JSON-Schema
 * via the `definition` "Allocation".
 */
export interface Allocation {
  token: Token;
  allocationItems: AllocationItems;
  [k: string]: any;
}
