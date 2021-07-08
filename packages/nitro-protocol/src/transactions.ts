import {constants, providers, Signature} from 'ethers';

import {State} from './contract/state';
import * as forceMoveTrans from './contract/transaction-creators/force-move';
import * as nitroAdjudicatorTrans from './contract/transaction-creators/nitro-adjudicator';
import {getStateSignerAddress, SignedState} from './signatures';

// CONSTANTS
export const MAGIC_ADDRESS_INDICATING_ETH = constants.AddressZero;
export const MAX_TX_DATA_SIZE = 128 * 1024; // (bytes) https://github.com/ethereum/go-ethereum/blob/f59ed3565d18c1fa676fd34f4fd41ecccad707e8/core/tx_pool.go#L51
export const NITRO_MAX_GAS = 6_000_000; // should be below the block gas limit, which can change over time and is generally different on mainnet, testnet and ganache.
// sampling some recent blocks on 26/11/2020:
// mainnet  12505858
// ropsten:  8000029
// rinkeby: 10000000
// ganache:  6721975 (hardcoded but can be overriden via config)

export function createChallengeTransaction(
  signedStates: SignedState[],
  challengePrivateKey: string
): providers.TransactionRequest {
  const {states, signatures, whoSignedWhat} = createSignatureArguments(signedStates);

  return forceMoveTrans.createChallengeTransaction(
    states,
    signatures,
    whoSignedWhat,
    challengePrivateKey
  );
}

export function createRespondTransaction(
  challengeState: State,
  response: SignedState
): providers.TransactionRequest {
  if (!challengeState) {
    throw new Error('No active challenge in challenge state');
  }
  return forceMoveTrans.createRespondTransaction({
    challengeState,
    responseState: response.state,
    responseSignature: response.signature,
  });
}

export function createCheckpointTransaction(
  signedStates: SignedState[]
): providers.TransactionRequest {
  const {states, signatures, whoSignedWhat} = createSignatureArguments(signedStates);
  return forceMoveTrans.createCheckpointTransaction({
    states,
    signatures,
    whoSignedWhat,
  });
}

export function createConcludeAndTransferAllAssetsTransaction(
  signedStates: SignedState[]
): providers.TransactionRequest {
  const {states, signatures, whoSignedWhat} = createSignatureArguments(signedStates);
  return nitroAdjudicatorTrans.createConcludeAndTransferAllAssetsTransaction(
    states,
    signatures,
    whoSignedWhat
  );
}

export function createConcludeTransaction(
  conclusionProof: SignedState[]
): providers.TransactionRequest {
  const {states, signatures, whoSignedWhat} = createSignatureArguments(conclusionProof);
  return forceMoveTrans.createConcludeTransaction(states, signatures, whoSignedWhat);
}

// Currently we assume each signedState is a unique combination of state/signature
// So if multiple participants sign a state we expect a SignedState for each participant
export function createSignatureArguments(
  signedStates: SignedState[]
): {states: State[]; signatures: Signature[]; whoSignedWhat: number[]} {
  const {participants} = signedStates[0].state.channel;
  const states = [];
  const whoSignedWhat = new Array<number>(participants.length);

  // Get a list of all unique signed states.
  const uniqueSignedStates = signedStates.filter((s, i, a) => a.indexOf(s) === i);
  // We may receive multiple Signed States which have the same state and different signatures
  // so we get a list of unique states ignoring their signatures
  // which allows us to create a single state with multiple signatures
  const uniqueStates = uniqueSignedStates.map(s => s.state).filter((s, i, a) => a.indexOf(s) === i);
  const signatures = new Array<Signature>(uniqueStates.length);
  for (let i = 0; i < uniqueStates.length; i++) {
    states.push(uniqueStates[i]);
    // Get a list of all signed states that have the state
    const signedStatesForUniqueState = uniqueSignedStates.filter(s => s.state === uniqueStates[i]);
    // Iterate through the signatures and set signatures/whoSignedWhawt
    for (const ss of signedStatesForUniqueState) {
      const participantIndex = participants.indexOf(getStateSignerAddress(ss));

      signatures[participantIndex] = ss.signature;
      whoSignedWhat[participantIndex] = i;
    }
  }

  return {
    states,
    signatures,
    whoSignedWhat,
  };
}
