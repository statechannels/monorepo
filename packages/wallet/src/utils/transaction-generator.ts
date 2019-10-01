import {TransactionRequest} from "ethers/providers";
import {getAdjudicatorInterface} from "./contract-utils";
import {splitSignature, BigNumberish} from "ethers/utils";
import {Commitment, SignedCommitment, signCommitment2} from "../domain";
import {asEthersObject} from "fmg-core";
import {
  createDepositTransaction as createNitroDepositTransaction,
  Transactions as nitroTrans,
  SignedState,
  createPushOutcomeTransaction
} from "@statechannels/nitro-protocol";
import {convertAddressToBytes32, convertCommitmentToState} from "./nitro-converter";

export function createForceMoveTransaction(
  fromCommitment: SignedCommitment,
  toCommitment: SignedCommitment,
  privateKey: string
): TransactionRequest {
  const signedStates = [fromCommitment.signedState, toCommitment.signedState];
  return nitroTrans.createForceMoveTransaction(signedStates, privateKey);
}

export function createRespondWithMoveTransaction(
  challengeCommitment: Commitment,
  responseCommitment: Commitment,
  privateKey: string
): TransactionRequest {
  const signedState = signCommitment2(responseCommitment, privateKey).signedState;
  return nitroTrans.createRespondTransaction(convertCommitmentToState(challengeCommitment), signedState);
}

export function createRefuteTransaction(refuteState: Commitment, signature: string): TransactionRequest {
  const adjudicatorInterface = getAdjudicatorInterface();
  const data = adjudicatorInterface.functions.refute.encode([asEthersObject(refuteState), splitSignature(signature)]);
  return {
    data
  };
}

export interface ConcludeAndWithdrawArgs {
  fromCommitment: Commitment;
  toCommitment: Commitment;
  fromSignature: string;
  toSignature: string;
  participant: string;
  destination: string;
  amount: string;
  verificationSignature: string;
}
export function createConcludeAndWithdrawTransaction(args: ConcludeAndWithdrawArgs): TransactionRequest {
  const adjudicatorInterface = getAdjudicatorInterface();
  const splitFromSignature = splitSignature(args.fromSignature);
  const splitToSignature = splitSignature(args.toSignature);
  const conclusionProof = {
    penultimateCommitment: asEthersObject(args.fromCommitment),
    ultimateCommitment: asEthersObject(args.toCommitment),
    penultimateSignature: splitFromSignature,
    ultimateSignature: splitToSignature
  };
  const {v, r, s} = splitSignature(args.verificationSignature);
  const {participant, destination, amount} = args;
  const data = adjudicatorInterface.functions.concludeAndWithdraw.encode([
    conclusionProof,
    participant,
    destination,
    amount,
    v,
    r,
    s
  ]);

  return {
    data,
    gasLimit: 3000000
  };
}

export function createConcludeTransaction(
  signedFromCommitment: SignedCommitment,
  signedToCommitment: SignedCommitment
): TransactionRequest {
  const signedStates: SignedState[] = [signedFromCommitment.signedState, signedToCommitment.signedState];
  return nitroTrans.createConcludeTransaction(signedStates);
}



export function pushOutcomeTransaction(
  finalCommitment: Commitment,
  finalizesAt: BigNumberish
): TransactionRequest {
  const state = convertCommitmentToState(finalCommitment);
  return createPushOutcomeTransaction(
    finalCommitment.turnNum,
    finalizesAt,
    state
  )
}



// FIXME: This function no longer exists
// export function createWithdrawTransaction(
//   amount: string,
//   participant: string,
//   destination: string,
//   verificationSignature: string
// ) {
//   const adjudicatorInterface = getAdjudicatorInterface();
//   const {v, r, s} = splitSignature(verificationSignature);
//   const data = adjudicatorInterface.functions.withdraw.encode([participant, destination, amount, v, r, s]);

//   return {
//     data,
//     gasLimit: 3000000
//   };
// }

// FIXME: This function no longer exists
// export function createTransferAndWithdrawTransaction(
//   channelId: string,
//   participant: string,
//   destination: string,
//   amount: string,
//   verificationSignature: string
// ) {
//   const adjudicatorInterface = getAdjudicatorInterface();
//   const {v, r, s} = splitSignature(verificationSignature);
//   const encodedAllocationBytes = encodeAllocation([{destination, amount}]);
//   const data = adjudicatorInterface.functions.transferAll.encode([
//     channelId,
//     participant,
//     destination,
//     amount,
//     v,
//     r,
//     s
//   ]);

//   return {
//     data,
//     gasLimit: 3000000
//   };
// }

export function createDepositTransaction(destination: string, depositAmount: string, expectedHeld: string) {
  return createNitroDepositTransaction(convertAddressToBytes32(destination), expectedHeld, depositAmount);
}
