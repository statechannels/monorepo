import {ethers} from 'ethers';

import EthAssetHolderArtifact from '../../../artifacts/contracts/ETHAssetHolder.sol/ETHAssetHolder.json';
import {Allocation, Guarantee, Outcome} from '../outcome';

import * as assetHolderTransactionCreator from './asset-holder';

const EthAssetHolderContractInterface = new ethers.utils.Interface(EthAssetHolderArtifact.abi);

export function createTransferAllTransaction(
  channelId: string,
  allocation: Allocation
): ethers.providers.TransactionRequest {
  return assetHolderTransactionCreator.createTransferAllTransaction(
    EthAssetHolderContractInterface,
    channelId,
    allocation
  );
}

export function createClaimAllTransaction(
  channelId: string,
  guarantee: Guarantee,
  allocation: Allocation
): ethers.providers.TransactionRequest {
  return assetHolderTransactionCreator.createClaimAllTransaction(
    EthAssetHolderContractInterface,
    channelId,
    guarantee,
    allocation
  );
}
export function createSetOutcomeTransaction(
  channelId: string,
  outcome: Outcome
): ethers.providers.TransactionRequest {
  return assetHolderTransactionCreator.createSetOutcomeTransaction(
    EthAssetHolderContractInterface,
    channelId,
    outcome
  );
}

export function createDepositTransaction(
  destination: string,
  expectedHeld: string,
  amount: string
): ethers.providers.TransactionRequest {
  const data = EthAssetHolderContractInterface.encodeFunctionData('deposit', [
    destination,
    expectedHeld,
    amount,
  ]);
  return {data};
}
