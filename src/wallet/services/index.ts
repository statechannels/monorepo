import { Address, Channel, Commitment, Signature, Uint256, Uint32 } from 'fmg-core';
import AllocatorChannelCommitment from '../models/allocatorChannelCommitment';
import { Blockchain } from './blockchain';
import { LedgerCommitment } from './ledger-commitment';
import * as LedgerChannelManager from './ledgerChannelManager';

export interface IAllocatorChannel extends Channel {
  id: number;
  holdings: Uint32;
}

export interface IAllocatorChannelCommitment extends Commitment {
  id: number;
  allocator_channel_id: number;
}

export interface SignedCommitment {
  commitment: Commitment;
  signature: Signature;
}

export const updateLedgerChannel: (
  currentC: AllocatorChannelCommitment,
  theirC: LedgerCommitment,
  s: Signature,
) => Promise<SignedCommitment> = LedgerChannelManager.updateLedgerChannel;
export const fund: (id: Address, expectedHeld: Uint256, amount: Uint256) => Promise<Uint256> =
  Blockchain.fund;
