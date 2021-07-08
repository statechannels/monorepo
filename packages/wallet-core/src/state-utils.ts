import {
  State as NitroState,
  SignedState as NitroSignedState,
  Outcome as NitroOutcome,
  AllocationItem as NitroAllocationItem,
  signState as signNitroState,
  hashState as hashNitroState,
  getStateSignerAddress as getNitroSignerAddress,
  getChannelId,
  convertAddressToBytes32
} from '@statechannels/nitro-protocol';
import * as _ from 'lodash';
import {Wallet, utils} from 'ethers';

import {
  State,
  ChannelConstants,
  Outcome,
  AllocationItem,
  SignedState,
  Destination,
  SimpleAllocation,
  SignatureEntry,
  makeAddress,
  Address,
  Hashed
} from './types';
import {BN} from './bignumber';

import {makeDestination} from './';

export function toNitroState(state: State): NitroState {
  const {channelNonce, participants, chainId} = state;
  const channel = {
    channelNonce,
    chainId,
    participants: participants.map(x => x.signingAddress)
  };

  return {
    ..._.pick(state, 'appData', 'isFinal', 'challengeDuration', 'appDefinition', 'turnNum'),
    outcome: convertToNitroOutcome(state.outcome),
    channel
  };
}

export function fromNitroSignedState(nitroSignedState: NitroSignedState): SignedState {
  const state = fromNitroState(nitroSignedState.state);
  const signature = utils.joinSignature(nitroSignedState.signature);
  const signatures: SignatureEntry[] = [
    {
      signature,
      signer: getSignerAddress(state, signature)
    }
  ];

  return {...state, signatures};
}

export function fromNitroState(state: NitroState): State {
  const {appData, isFinal, outcome, challengeDuration, appDefinition, channel, turnNum} = state;

  return {
    appDefinition: makeAddress(appDefinition),
    isFinal,
    appData,
    outcome: fromNitroOutcome(outcome),
    turnNum: turnNum,
    challengeDuration: challengeDuration,
    channelNonce: Number(channel.channelNonce),
    chainId: channel.chainId,
    participants: channel.participants.map(x => ({
      signingAddress: makeAddress(x),
      // FIXME: Get real values
      participantId: x,
      destination: x.padStart(64, '0') as Destination
    }))
  };
}

// Since the nitro signed state only contains one signature we may get multiple
// NitroSignedStates for a signed state with multiple signatures
export function toNitroSignedState(signedState: SignedState): NitroSignedState[] {
  const state = toNitroState(signedState);
  const {signatures} = signedState;
  return signatures.map(sig => ({state, signature: utils.splitSignature(sig.signature)}));
}

export function calculateChannelId(channelConstants: ChannelConstants): string {
  const {chainId, channelNonce, participants} = channelConstants;
  const addresses = participants.map(p => p.signingAddress);
  return getChannelId({chainId, channelNonce, participants: addresses});
}

export function createSignatureEntry(state: State, privateKey: string): SignatureEntry {
  const {address} = new Wallet(privateKey);
  const nitroState = toNitroState(state);
  const {signature} = signNitroState(nitroState, privateKey);
  return {signature: utils.joinSignature(signature), signer: makeAddress(address)};
}
export function signState(state: State, privateKey: string): string {
  const nitroState = toNitroState(state);
  const {signature} = signNitroState(nitroState, privateKey);
  return utils.joinSignature(signature);
}

export function hashState(state: State): string {
  const nitroState = toNitroState(state);
  return hashNitroState(nitroState);
}

export function getSignerAddress(state: State, signature: string): Address {
  const nitroState = toNitroState(state);
  return makeAddress(
    getNitroSignerAddress({state: nitroState, signature: utils.splitSignature(signature)})
  );
}

export function statesEqual(left: State, right: State): boolean {
  return hashState(left) === hashState(right);
}

function simpleAllocationsEqual(left: SimpleAllocation, right: SimpleAllocation) {
  return (
    left.asset === right.asset &&
    left.allocationItems.length === right.allocationItems.length &&
    _.every(
      left.allocationItems,
      (value, index) =>
        value.destination === right.allocationItems[index].destination &&
        BN.eq(value.amount, right.allocationItems[index].amount)
    )
  );
}

export function outcomesEqual(left: Outcome, right?: Outcome): boolean {
  if (left.type === 'SimpleAllocation' && right?.type === 'SimpleAllocation') {
    return simpleAllocationsEqual(left, right);
  }
  if (left.type === 'SimpleGuarantee' && right?.type === 'SimpleGuarantee') {
    return _.isEqual(left, right);
  }
  if (left.type === 'MixedAllocation' && right?.type === 'MixedAllocation') {
    return (
      left.simpleAllocations.length === right.simpleAllocations.length &&
      _.every(left.simpleAllocations, (_, index) =>
        simpleAllocationsEqual(left.simpleAllocations[index], right.simpleAllocations[index])
      )
    );
  }
  return false;
}

export const firstState = (
  outcome: Outcome,
  {channelNonce, chainId, challengeDuration, appDefinition, participants}: ChannelConstants,
  appData?: string
): State => ({
  appData: appData || '0x',
  isFinal: false,
  turnNum: 0,
  chainId: chainId || '0x01',
  channelNonce,
  challengeDuration,
  appDefinition,
  participants,
  outcome
});

function convertToNitroAllocationItems(allocationItems: AllocationItem[]): NitroAllocationItem[] {
  return allocationItems.map(a => ({
    amount: a.amount,
    destination:
      a.destination.length === 42 ? convertAddressToBytes32(a.destination) : a.destination
  }));
}

function convertFromNitroAllocationItems(allocationItems: NitroAllocationItem[]): AllocationItem[] {
  return allocationItems.map(a => ({
    amount: BN.from(a.amount),
    destination: makeDestination(a.destination)
  }));
}

export function convertToNitroOutcome(outcome: Outcome): NitroOutcome {
  switch (outcome.type) {
    case 'SimpleAllocation':
      return [
        {
          asset: outcome.asset,
          allocationItems: convertToNitroAllocationItems(outcome.allocationItems)
        }
      ];
    case 'SimpleGuarantee':
      return [
        {
          asset: outcome.asset,
          guarantee: {
            targetChannelId: outcome.targetChannelId,
            destinations: outcome.destinations
          }
        }
      ];
    case 'MixedAllocation':
      // TODO: Update NitroOutcome to support multiple asset holders
      console.warn('NOTE: MixedAllocation is using 0th-indexed allocation only');
      return outcome.simpleAllocations.map(convertToNitroOutcome)[0];
  }
}

export function fromNitroOutcome(outcome: NitroOutcome): Outcome {
  const [singleOutcomeItem] = outcome;

  if (typeof singleOutcomeItem['allocationItems'] !== 'undefined') {
    return {
      type: 'SimpleAllocation',
      asset: makeAddress(singleOutcomeItem.asset),
      allocationItems: convertFromNitroAllocationItems(singleOutcomeItem['allocationItems'])
    };
  }

  if (typeof singleOutcomeItem['guarantee'] !== 'undefined') {
    return {
      type: 'SimpleGuarantee',
      asset: makeAddress(singleOutcomeItem.asset),
      targetChannelId: singleOutcomeItem['guarantee'].targetChannelId,
      destinations: singleOutcomeItem['guarantee'].destinations
    };
  }

  return {
    type: 'MixedAllocation',
    // FIXME: Figure out what needs to be here
    simpleAllocations: []
    // simpleAllocations: outcome.map(fromNitroOutcome)
  };
}

export function nextState(state: State, outcome: Outcome): State {
  if (state.outcome.type !== outcome.type) {
    throw new Error('Attempting to change outcome type');
  }

  return {...state, turnNum: state.turnNum + 1, outcome};
}

export const addHash = <T extends State = State>(s: T): T & Hashed => ({
  ...s,
  stateHash: hashState(s)
});
