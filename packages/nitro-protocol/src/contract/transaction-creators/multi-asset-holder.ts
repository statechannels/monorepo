import {ethers, constants} from 'ethers';

import NitroAdjudicatorArtifact from '../../../artifacts/contracts/NitroAdjudicator.sol/NitroAdjudicator.json';

export const NitroAdjudicatorContractInterface = new ethers.utils.Interface(
  NitroAdjudicatorArtifact.abi
);

export function createETHDepositTransaction(
  destination: string,
  expectedHeld: string,
  amount: string
): ethers.providers.TransactionRequest {
  const data = NitroAdjudicatorContractInterface.encodeFunctionData('deposit', [
    constants.AddressZero, // Magic constant indicating ETH
    destination,
    expectedHeld,
    amount,
  ]);
  return {data};
}

export function createERC20DepositTransaction(
  tokenAddress: string,
  destination: string,
  expectedHeld: string,
  amount: string
): ethers.providers.TransactionRequest {
  const data = NitroAdjudicatorContractInterface.encodeFunctionData('deposit', [
    tokenAddress,
    destination,
    expectedHeld,
    amount,
  ]);
  return {data};
}
