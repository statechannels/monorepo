import {MachineConfig, Action, StateSchema, Machine, Condition, StateMachine} from 'xstate';
import {Participant, TokenAllocations} from '@statechannels/client-api-schema';
import {ObsoleteStore} from '@statechannels/wallet-protocols';
import {sendDisplayMessage} from '../messaging';
import {createMockGuard} from '../utils/workflow-utils';

interface WorkflowActions {
  hideUi: Action<WorkflowContext, any>;
  displayUi: Action<WorkflowContext, any>;
}
interface WorkflowGuards {
  noBudget: Condition<WorkflowContext, WorkflowEvent>;
}
// While this context info may not be used by the workflow
// it may be used when displaying a UI
export interface WorkflowContext {
  participants: Participant[];

  allocations: TokenAllocations;
  appDefinition: string;
  appData: string;
  chainId: string;
  challengeDuration: number;
}

interface WorkflowStateSchema extends StateSchema<WorkflowContext> {
  states: {
    needUserConfirmation: {};
    waitForUserConfirmation: {};
    // TODO: Is it possible to type these as type:'final' ?
    done: {};
    failure: {};
  };
}

interface UserApproves {
  type: 'USER_APPROVES';
}
interface UserRejects {
  type: 'USER_REJECTS';
}
type WorkflowEvent = UserApproves | UserRejects;

const generateConfig = (
  actions: WorkflowActions,
  guards: WorkflowGuards
): MachineConfig<WorkflowContext, WorkflowStateSchema, WorkflowEvent> => ({
  id: 'confirm-create-channel',
  initial: 'needUserConfirmation',
  states: {
    needUserConfirmation: {
      on: {
        '': [
          {
            target: 'waitForUserConfirmation',
            cond: guards.noBudget,
            actions: [actions.displayUi]
          },
          {
            target: 'done'
          }
        ]
      }
    },
    waitForUserConfirmation: {
      on: {
        USER_APPROVES: {target: 'done', actions: [actions.hideUi]},
        USER_REJECTS: {target: 'failure', actions: [actions.hideUi]}
      }
    },
    done: {type: 'final', data: context => context},
    failure: {type: 'final'}
  }
});

const mockActions: WorkflowActions = {
  hideUi: 'hideUi',
  displayUi: 'displayUi'
};
const mockGuards = {
  noBudget: createMockGuard('noBudget')
};
export const mockOptions = {actions: mockActions, guards: mockGuards};
export const mockConfig = generateConfig(mockActions, mockGuards);
const guards = {noBudget: () => true};
const actions = {
  // TODO: We should probably set up some standard actions for all workflows
  displayUi: () => {
    sendDisplayMessage('Show');
  },
  hideUi: () => {
    sendDisplayMessage('Hide');
  }
};
export const config = generateConfig(actions, guards);
export const confirmChannelCreationWorkflow = (
  _store: ObsoleteStore,
  context: WorkflowContext
): WorkflowMachine => {
  // TODO: Once budgets are a thing this should check for a budget
  // TODO: We shouldn't need to cast this but some xstate typing is not lining up around stateSchema
  return Machine(config).withConfig({}, context) as WorkflowMachine;
};

// TODO: We should be
export type WorkflowMachine = StateMachine<WorkflowContext, StateSchema, WorkflowEvent, any>;
