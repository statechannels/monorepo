import {utils} from 'ethers';

import {Contract} from 'ethers';
import ForceMoveAppArtifact from '../../build/contracts/ForceMoveApp.json';
import {State, getVariablePart} from '../contract/state';

// @ts-ignore https://github.com/ethers-io/ethers.js/issues/602#issuecomment-574671078
export const ForceMoveAppContractInterface = new utils.Interface(ForceMoveAppArtifact.abi);

export async function validTransition(
  fromState: State,
  toState: State,
  appContract: Contract
): Promise<boolean> {
  const numberOfParticipants = toState.channel.participants.length;
  const fromVariablePart = getVariablePart(fromState);
  const toVariablePart = getVariablePart(toState);
  const turnNumB = toState.turnNum;

  return await appContract.functions.validTransition(
    fromVariablePart,
    toVariablePart,
    turnNumB,
    numberOfParticipants
  );
}
