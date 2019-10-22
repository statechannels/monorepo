import {Contract, Signer} from 'ethers';
import {Interface} from 'ethers/utils';
import ConsensusAppArtifact from '../../build/contracts/ConsensusApp.json';
import {ConsensusData, encodeConsensusData} from './consensus-data';
import {encodeOutcome, Outcome} from './outcome';
import {VariablePart} from './state';

const ConsensusAppContractInterface = new Interface(ConsensusAppArtifact.abi);

export function getVariablePart(consensusData: ConsensusData, outcome: Outcome): VariablePart {
  const appData = encodeConsensusData(consensusData);
  return {appData, outcome: encodeOutcome(outcome)};
}

// validTransition is a pure function so using this method will not use gas
// This should be used over createValidTransitionTransaction
export async function validTransition(
  fromConsensusData: ConsensusData,
  fromOutcome: Outcome,
  toConsensusData: ConsensusData,
  toOutcome: Outcome,
  numberOfParticipants: number,
  signer: Signer,
  contractAddress: string
): Promise<boolean> {
  const fromVariablePart = getVariablePart(fromConsensusData, fromOutcome);
  const toVariablePart = getVariablePart(toConsensusData, toOutcome);
  const turnNumB = 0; // This isn't actually used by the contract so any value works

  const contract = new Contract(contractAddress, ConsensusAppContractInterface.abi, signer);
  return await contract.functions.validTransition(
    fromVariablePart,
    toVariablePart,
    turnNumB,
    numberOfParticipants
  );
}
