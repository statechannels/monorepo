import {
  SignedState as SignedStateWire,
  Outcome as OutcomeWire,
  AllocationItem as AllocationItemWire,
  Allocation as AllocationWire,
  Guarantee as GuaranteeWire,
  Message as WireMessage
} from '@statechannels/wire-format';

import {
  SignedState,
  Outcome,
  AllocationItem,
  SimpleAllocation,
  Payload,
  SimpleGuarantee
} from '../../types';
import {calculateChannelId} from '../../state-utils';
import {formatAmount} from '../../utils';

export function serializeMessage(
  walletVersion: string,
  message: Payload,
  recipient: string,
  sender?: string,
  channelId?: string
): WireMessage {
  const signedStates = (message.signedStates || []).map(s => serializeState(s, channelId));
  const {objectives, requests} = message;
  return {
    recipient,
    sender,
    data: {walletVersion, signedStates, objectives, requests}
  };
}

export function serializeState(state: SignedState, channelId?: string): SignedStateWire {
  const {
    chainId,
    participants,
    channelNonce,
    appDefinition,
    challengeDuration,
    turnNum,
    appData,
    isFinal
  } = state;

  return {
    chainId,
    participants,
    channelNonce,
    appDefinition,
    challengeDuration,
    turnNum,
    appData,
    isFinal,
    outcome: serializeOutcome(state.outcome),
    channelId: channelId || calculateChannelId(state),
    signatures: state.signatures.map(s => s.signature)
  };
}

export function serializeOutcome(outcome: Outcome): OutcomeWire {
  switch (outcome.type) {
    case 'SimpleAllocation':
      return [serializeSimpleAllocation(outcome)];
    case 'MixedAllocation':
      return outcome.simpleAllocations.map(serializeSimpleAllocation);
    case 'SimpleGuarantee':
      return [serializeSimpleGuarantee(outcome)];
  }
}

function serializeSimpleAllocation(allocation: SimpleAllocation): AllocationWire {
  return {
    asset: allocation.asset,
    allocationItems: allocation.allocationItems.map(serializeAllocationItem)
  };
}

function serializeSimpleGuarantee(guarantee: SimpleGuarantee): GuaranteeWire {
  return {
    asset: guarantee.asset,
    targetChannelId: guarantee.targetChannelId,
    destinations: guarantee.destinations
  };
}

function serializeAllocationItem(allocationItem: AllocationItem): AllocationItemWire {
  const {destination, amount} = allocationItem;
  return {destination, amount: formatAmount(amount)};
}
