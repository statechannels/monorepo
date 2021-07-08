import {DomainBudget, unreachable, Uint256} from '@statechannels/wallet-core';
import {Interpreter} from 'xstate';

import {zeroAddress} from '../config';
import {
  WorkflowState as AppWorkflowState,
  StateValue as AppStateValue
} from '../workflows/application';

export function getApplicationStateValue(
  applicationWorkflowState: AppWorkflowState
): AppStateValue {
  if (typeof applicationWorkflowState.value === 'string') {
    return applicationWorkflowState.value as AppStateValue;
  } else {
    return Object.keys(applicationWorkflowState.value)[0] as AppStateValue;
  }
}

export function getConfirmCreateChannelService(
  applicationWorkflowState: AppWorkflowState
): Interpreter<any> {
  return applicationWorkflowState.children.invokeCreateChannelConfirmation as any;
}

export function getChallengeChannelService(
  applicationWorkflowState: AppWorkflowState
): Interpreter<any> {
  return applicationWorkflowState.children.invokeChallengingProtocol as any;
}

// TODO:Ideally this should be a type guard
export function isConfirmCreateChannel(applicationWorkflowState: AppWorkflowState): boolean {
  return applicationWorkflowState.value === 'confirmingWithUser';
}

export function isApplicationChallenging(applicationWorkflowState: AppWorkflowState): boolean {
  const stateValue = getApplicationStateValue(applicationWorkflowState);
  return stateValue === 'sendChallenge';
}

export function isApplicationOpening(applicationWorkflowState: AppWorkflowState): boolean {
  const stateValue = getApplicationStateValue(applicationWorkflowState);
  return (
    stateValue === 'joiningChannel' ||
    stateValue === 'creatingChannel' ||
    stateValue === 'openChannelAndFundProtocol'
  );
}

export function getApplicationOpenProgress(applicationWorkflowState: AppWorkflowState): number {
  const stateValue = getApplicationStateValue(applicationWorkflowState);
  switch (stateValue) {
    case 'confirmingWithUser':
      return 0.25;
    case 'joiningChannel':
    case 'creatingChannel':
    case 'fundingChannel':
      return 0.5;

    case 'openChannelAndFundProtocol':
      return 0.75;
    case 'running':
      return 1;
    case 'closing':
    case 'sendChallenge':
    case 'done':
    case 'failure':
    case 'branchingOnFundingStrategy':
      throw Error('Should not be in this state');
    default:
      return unreachable(stateValue);
  }
}

export function getAmountsFromBudget(
  budget: DomainBudget
): {playerAmount: Uint256; hubAmount: Uint256} {
  const pending = budget.forAsset[zeroAddress];
  if (!pending) throw new Error('No eth budget found');
  const {availableReceiveCapacity, availableSendCapacity} = pending;
  return {playerAmount: availableSendCapacity, hubAmount: availableReceiveCapacity};
}
