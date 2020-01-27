import {
  Transaction,
  Interface,
  bigNumberify,
  keccak256,
  defaultAbiCoder,
  Signature,
} from 'ethers/utils';

import NitroAdjudicatorArtifact from '../../build/contracts/NitroAdjudicator.json';
import {Channel, SignedState} from '..';

import {decodeOutcome} from './outcome';
import {FixedPart, hashState, State, VariablePart} from './state';
import {Address, Bytes32, Uint256, Uint8} from './types';

export function hashChallengeMessage(challengeState: State): Bytes32 {
  return keccak256(
    defaultAbiCoder.encode(['bytes32', 'string'], [hashState(challengeState), 'forceMove'])
  );
}

export interface ChallengeRegisteredEvent {
  challengerAddress: string;
  finalizesAt: string;
  challengeStates: SignedState[];
}
export interface ChallengeRegisteredStruct {
  channelId: Bytes32;
  turnNumRecord: Uint256;
  finalizesAt: Uint256;
  challenger: Address;
  isFinal: boolean;
  fixedPart: FixedPart;
  variableParts: VariablePart[];
  sigs: Signature[];
  whoSignedWhat: Uint8[];
}
export function getChallengeRegisteredEvent(eventResult): ChallengeRegisteredEvent {
  const {
    turnNumRecord,
    finalizesAt,
    challenger,
    isFinal,
    fixedPart,
    variableParts: variablePartsUnstructured,
    sigs,
    whoSignedWhat,
  }: ChallengeRegisteredStruct = eventResult.slice(-1)[0].args;

  // Fixed part
  const chainId = bigNumberify(fixedPart[0]).toHexString();
  const participants = fixedPart[1].map(p => bigNumberify(p).toHexString());
  const channelNonce = bigNumberify(fixedPart[2]).toHexString();
  const appDefinition = fixedPart[3];
  const challengeDuration = bigNumberify(fixedPart[4]).toNumber();

  // Variable part
  const variableParts: VariablePart[] = variablePartsUnstructured.map(v => {
    const outcome = v[0];
    const appData = v[1];
    return {outcome, appData};
  });

  const channel: Channel = {chainId, channelNonce, participants};
  const challengeStates: SignedState[] = variableParts.map((v, i) => {
    const turnNum = bigNumberify(turnNumRecord).sub(variableParts.length - i - 1);
    const signature = sigs[i];
    const state: State = {
      turnNum: turnNum.toNumber(), // TODO: this is unsafe is uin256 is > 53 bits
      channel,
      outcome: decodeOutcome(v.outcome),
      appData: v.appData,
      challengeDuration,
      appDefinition,
      isFinal,
    };
    return {state, signature};
  });
  return {challengeStates, finalizesAt, challengerAddress: challenger};
}

export interface ChallengeClearedEvent {
  kind: 'respond' | 'checkpoint';
  newStates: SignedState[];
}
export interface ChallengeClearedStruct {
  channelId: string;
  newTurnNumRecord: string;
}
export interface RespondTransactionArguments {
  challenger: string;
  isFinalAb: [boolean, boolean];
  fixedPart: FixedPart;
  variablePartAB: [VariablePart, VariablePart];
  sig: Signature;
}
export function getChallengeClearedEvent(tx: Transaction, eventResult): ChallengeClearedEvent {
  const {newTurnNumRecord}: ChallengeClearedStruct = eventResult.slice(-1)[0].args;

  const decodedTransaction = new Interface(NitroAdjudicatorArtifact.abi).parseTransaction(tx);

  if (decodedTransaction.name === 'respond') {
    // NOTE: args value is an array of the inputted arguments, not an object with labelled keys
    // ethers.js should change this, and when it does, we can use the commented out type
    const args /* RespondTransactionArguments */ = decodedTransaction.args;
    const [chainId, participants, channelNonce, appDefinition, challengeDuration] = args[2];
    const isFinal = args[1][1];
    const outcome = decodeOutcome(args[3][1][0]);
    const appData = args[3][1][1];
    const signature = {v: args[4][0], r: args[4][1], s: args[4][2]};

    const signedState: SignedState = {
      signature,
      state: {
        challengeDuration,
        appDefinition,
        isFinal,
        outcome,
        appData,
        channel: {
          chainId: bigNumberify(chainId).toHexString(),
          channelNonce: bigNumberify(channelNonce).toHexString(),
          participants,
        },
        turnNum: bigNumberify(newTurnNumRecord).toNumber(),
      },
    };

    return {
      kind: 'respond',
      newStates: [signedState],
    };
  } else if (decodedTransaction.name === 'checkpoint') {
    throw new Error('UnimplementedError');
  } else {
    throw new Error(
      'Unexpected call to getChallengeClearedEvent with invalid or unrelated transaction data'
    );
  }
}
