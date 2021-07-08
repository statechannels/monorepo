import {
  SignedState as SignedStateWire,
  Outcome as OutcomeWire,
  Objective as ObjectiveWire,
  AllocationItem as AllocationItemWire,
  Allocation as AllocationWire,
  Message as WireMessage,
  isAllocations,
  validateMessage
} from '@statechannels/wire-format';
import {State as NitroState, hashState} from '@statechannels/nitro-protocol';

import {
  SignedState,
  Outcome,
  AllocationItem,
  SimpleAllocation,
  Participant,
  makeAddress,
  Payload,
  SharedObjective
} from '../../types';
import {BN} from '../../bignumber';
import {makeDestination} from '../../utils';
import {convertToNitroOutcome, getSignerAddress} from '../../state-utils';

export function convertToInternalParticipant(participant: {
  destination: string;
  signingAddress: string;
  participantId: string;
}): Participant {
  return {
    ...participant,
    signingAddress: makeAddress(participant.signingAddress),
    destination: makeDestination(participant.destination)
  };
}

type WirePayload = WireMessage['data'];

export function validatePayload(rawPayload: unknown): WirePayload {
  // TODO: wire-format should export a validator specially for the payload
  return validateMessage({recipient: '', sender: '', data: rawPayload}).data;
}

export function deserializeMessage(message: WireMessage): Payload {
  const signedStates = message?.data?.signedStates?.map(ss => deserializeState(ss));
  const objectives = message?.data?.objectives?.map(objective => deserializeObjective(objective));
  const requests = message?.data?.requests;
  const walletVersion = message.data.walletVersion;

  return {
    walletVersion,
    signedStates,
    objectives,
    requests
  };
}

export function wireStateToNitroState(state: SignedStateWire): NitroState {
  return {
    turnNum: state.turnNum,
    isFinal: state.isFinal,
    channel: {
      channelNonce: state.channelNonce,
      participants: state.participants.map(s => s.signingAddress),
      chainId: state.chainId
    },
    challengeDuration: state.challengeDuration,
    outcome: convertToNitroOutcome(deserializeOutcome(state.outcome)),
    appDefinition: state.appDefinition,
    appData: state.appData
  };
}
export function hashWireState(state: SignedStateWire): string {
  return hashState(wireStateToNitroState(state));
}

export function deserializeState(state: SignedStateWire): SignedState {
  const deserializedState = {
    ...state,
    channelId: undefined,
    appDefinition: makeAddress(state.appDefinition),
    outcome: deserializeOutcome(state.outcome),
    participants: state.participants.map(convertToInternalParticipant)
  };

  return {
    ...deserializedState,
    signatures: state.signatures.map(sig => ({
      signature: sig,
      signer: getSignerAddress(deserializedState, sig)
    }))
  };
}

export function deserializeObjective(objective: ObjectiveWire): SharedObjective {
  const participants = objective.participants.map(p => ({
    ...p,
    signingAddress: makeAddress(p.signingAddress),
    destination: makeDestination(p.destination)
  }));

  return {...objective, participants};
}
// where do I move between token and asset holder?
// I have to have asset holder between the wallets, otherwise there is ambiguity
// I don't want asset holders in the json rpc layer, as the client shouldn't care

export function deserializeOutcome(outcome: OutcomeWire): Outcome {
  if (isAllocations(outcome)) {
    switch (outcome.length) {
      case 0:
        // TODO: specify in wire format
        throw new Error('Empty allocation');
      case 1:
        return deserializeAllocation(outcome[0]);
      default:
        return {
          type: 'MixedAllocation',
          simpleAllocations: outcome.map(deserializeAllocation)
        };
    }
  } else {
    if (outcome.length !== 1) {
      throw new Error('Currently only supporting guarantees of length 1.');
    } else {
      return {
        type: 'SimpleGuarantee',
        ...outcome[0],
        asset: makeAddress(outcome[0].asset)
      };
    }
  }

  // either an outcome is all guarantees or all
}

function deserializeAllocation(allocation: AllocationWire): SimpleAllocation {
  const {asset, allocationItems} = allocation;
  return {
    type: 'SimpleAllocation',
    asset: makeAddress(asset),
    allocationItems: allocationItems.map(deserializeAllocationItem)
  };
}

function deserializeAllocationItem(allocationItem: AllocationItemWire): AllocationItem {
  const {amount, destination} = allocationItem;
  return {amount: BN.from(amount), destination: makeDestination(destination)};
}
