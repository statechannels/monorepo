import {
  SignedState,
  Objective,
  SignedStateWithHash,
  SignedStateVarsWithHash,
  Message,
  hashState,
  State,
  calculateChannelId,
  StateVariables,
  ChannelConstants,
} from '@statechannels/wallet-core';
import _ from 'lodash';
import {Either, right} from 'fp-ts/lib/Either';
import {Bytes32, ChannelResult} from '@statechannels/client-api-schema';

import {Channel, SyncState, RequiredColumns} from '../models/channel';
import {SigningWallet} from '../models/signing-wallet';
import {addHash} from '../state-utils';
import {ChannelState} from '../protocols/state';
import knex from '../db/connection';

export const Store = {
  transaction: knex.transaction,
  signState: async function(
    channelId: Bytes32,
    vars: StateVariables
  ): Promise<{outgoing: SyncState; channelResult: ChannelResult}> {
    let channel = await Channel.forId(channelId);

    const state: State = {...channel.channelConstants, ...vars};

    validateStateFreshness(state, channel);

    const signatureEntry = channel.signingWallet.signState(state);
    const signedState = {...state, signatures: [signatureEntry]};

    await this.addSignedState(signedState);

    channel = await Channel.forId(channelId);

    const sender = channel.participants[channel.myIndex].participantId;
    const data = {signedStates: [addHash(signedState)]};
    const notMe = (_p: any, i: number): boolean => i !== channel.myIndex;

    const outgoing = state.participants.filter(notMe).map(({participantId: recipient}) => ({
      type: 'NotifyApp' as 'NotifyApp',
      notice: {
        method: 'MessageQueued' as 'MessageQueued',
        params: {sender, recipient, data},
      },
    }));

    const {channelResult} = channel;

    return {outgoing, channelResult};
  },
  getChannel: async function(channelId: Bytes32): Promise<ChannelState | undefined> {
    return (await Channel.forId(channelId))?.protocolState;
  },

  pushMessage: async function(message: Message): Promise<Bytes32[]> {
    for (const ss of message.signedStates || []) {
      await this.addSignedState(ss);
    }

    for (const o of message.objectives || []) {
      await this.addObjective(o);
    }

    const stateChannelIds = message.signedStates?.map(ss => calculateChannelId(ss)) || [];
    // TODO: generate channelIds from objectives
    const objectiveChannelIds: Bytes32[] = [];
    return stateChannelIds.concat(objectiveChannelIds);
  },

  addObjective: async function(_objective: Objective): Promise<Either<StoreError, undefined>> {
    // TODO: Implement this
    return Promise.resolve(right(undefined));
  },
  addSignedState: async function(signedState: SignedState): Promise<number> {
    validateSignatures(signedState);

    const {address: signingAddress} = await getSigningWallet(signedState);

    const channel = await getOrCreateChannel(signedState, signingAddress);
    let channelVars = channel.vars;

    channelVars = addState(channelVars, signedState);

    channelVars = clearOldStates(channelVars, channel.isSupported ? channel.support : undefined);

    validateInvariants(channelVars, channel.myAddress);
    const cols = {...channel.channelConstants, vars: channelVars, signingAddress};

    return await Channel.query().update(cols);
  },
};

class StoreError extends Error {
  readonly type = 'InvariantError';
  constructor(reason: StoreErrors, public readonly data: any = undefined) {
    super(reason);
  }
}

enum StoreErrors {
  duplicateTurnNums = 'multiple states with same turn number',
  notSorted = 'states not sorted',
  multipleSignedStates = 'Store signed multiple states for a single turn',
  invalidSignature = 'Invalid signature',
  notInChannel = 'Not in channel',
  staleState = 'Stale state',
}

async function getOrCreateChannel(
  constants: ChannelConstants,
  signingAddress: string
): Promise<Channel> {
  const channelId = calculateChannelId(constants);
  let channel = await Channel.query()
    .where('channelId', channelId)
    .first();

  if (!channel) {
    const cols: RequiredColumns = {...constants, vars: [], signingAddress};
    channel = Channel.fromJson(cols);
    await Channel.query().insert(channel);
  }
  return channel;
}
async function getSigningWallet(signedState: SignedState): Promise<SigningWallet> {
  const addresses = signedState.participants.map(p => p.signingAddress);
  const signingWallet = await SigningWallet.query()
    .whereIn('address', addresses)
    .first();

  if (!signingWallet) {
    throw new StoreError(StoreErrors.notInChannel);
  }
  return signingWallet;
}
/*
 * Validator functions
 */

function validateSignatures(signedState: SignedState): void {
  const {participants} = signedState;

  signedState.signatures.map(sig => {
    const signerIndex = participants.findIndex(p => p.signingAddress === sig.signer);
    if (signerIndex === -1) {
      throw new StoreError(StoreErrors.invalidSignature, {signedState, signature: sig});
    }
  });
}

function validateStateFreshness(signedState: State, channel: Channel): void {
  if (
    channel.isSupportedByMe &&
    channel.latestSignedByMe &&
    channel.latestSignedByMe.turnNum >= signedState.turnNum
  ) {
    throw new StoreError(StoreErrors.staleState);
  }
}

function validateInvariants(stateVars: SignedStateVarsWithHash[], myAddress: string): void {
  const signedByMe = stateVars.filter(s => s.signatures.some(sig => sig.signer === myAddress));
  const groupedByTurnNum = _.groupBy(signedByMe, s => s.turnNum.toString());
  const multipleSignedByMe = _.map(groupedByTurnNum, s => s.length)?.find(num => num > 1);

  if (multipleSignedByMe) {
    throw new StoreError(StoreErrors.multipleSignedStates);
  }

  const turnNums = _.map(stateVars, s => s.turnNum);

  const duplicateTurnNums = turnNums.some((t, i) => turnNums.indexOf(t) != i);
  if (duplicateTurnNums) {
    throw new StoreError(StoreErrors.duplicateTurnNums);
  }
  if (!isReverseSorted(turnNums)) {
    throw new StoreError(StoreErrors.notSorted);
  }
}

function isReverseSorted(arr: number[]): boolean {
  const len = arr.length - 1;
  for (let i = 0; i < len; ++i) {
    if (arr[i] < arr[i + 1]) {
      return false;
    }
  }
  return true;
}

/**
 * State variable modifiers
 */
function addState(
  vars: SignedStateVarsWithHash[],
  signedState: SignedState
): SignedStateVarsWithHash[] {
  validateSignatures(signedState);

  const clonedVariables = _.cloneDeep(vars);
  const stateHash = hashState(signedState);
  const existingStateIndex = clonedVariables.findIndex(v => v.stateHash === stateHash);
  if (existingStateIndex > -1) {
    const mergedSignatures = _.uniq(
      signedState.signatures.concat(clonedVariables[existingStateIndex].signatures)
    );

    clonedVariables[existingStateIndex].signatures = mergedSignatures;
    return clonedVariables;
  } else {
    return clonedVariables.concat({...signedState, stateHash});
  }
}

function clearOldStates(
  signedStates: SignedStateVarsWithHash[],
  support: SignedStateWithHash[] | undefined
): SignedStateVarsWithHash[] {
  const sorted = _.reverse(_.sortBy(signedStates, s => s.turnNum));
  // If we don't have a supported state we don't clean anything out
  if (support && support.length > 0) {
    // The support is returned in descending turn number so we need to grab the last element to find the earliest state
    const {stateHash: firstSupportStateHash} = support[support.length - 1];

    // Find where the first support state is in our current state array
    const supportIndex = sorted.findIndex(sv => sv.stateHash === firstSupportStateHash);
    // Take everything before that
    return sorted.slice(0, supportIndex + 1);
  } else {
    return sorted;
  }
}
