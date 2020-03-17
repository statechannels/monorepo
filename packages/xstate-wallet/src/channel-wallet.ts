import {Store} from './store';
import {MessagingServiceInterface, convertToChannelResult} from './messaging';

import {applicationWorkflow} from './workflows/application';
import ReactDOM from 'react-dom';
import React from 'react';
import {Wallet as WalletUi} from './ui/wallet';
import {interpret, Interpreter, State, StateNode} from 'xstate';
import {Guid} from 'guid-typescript';
import {Notification, Response} from '@statechannels/client-api-schema';
import {filter, map} from 'rxjs/operators';
import {Message, OpenChannel} from './store/types';
import {approveBudgetAndFundWorkflow} from './workflows/approve-budget-and-fund';
import {ethereumEnableWorkflow} from './workflows/ethereum-enable';
import {AppRequestEvent} from './event-types';

export interface Workflow {
  id: string;
  machine: Interpreter<any, any, any>;
  domain: string; // TODO: Is this useful?
}
export class ChannelWallet {
  public workflows: Workflow[];

  constructor(
    private store: Store,
    private messagingService: MessagingServiceInterface,
    public id?: string
  ) {
    this.workflows = [];

    // Whenever the store wants to send something call sendMessage
    store.outboxFeed.subscribe(async (m: Message) => {
      this.messagingService.sendMessageNotification(m);
    });
    // Whenever an OpenChannel objective is received
    // we alert the user that there is a new channel
    // It is up to the app to call JoinChannel
    this.store.objectiveFeed
      .pipe(
        // TODO: type guard
        filter(o => o.type === 'OpenChannel'),
        map(o => o as OpenChannel)
      )
      .subscribe(async o => {
        const channelEntry = await this.store.getEntry(o.data.targetChannelId);
        this.messagingService.sendChannelNotification(
          'ChannelProposed',
          await convertToChannelResult(channelEntry)
        );
      });

    this.messagingService.requestFeed.subscribe(x => this.handleRequest(x));
  }

  private handleRequest(request: AppRequestEvent) {
    switch (request.type) {
      case 'CREATE_CHANNEL':
      case 'JOIN_CHANNEL': {
        const workflow = this.startWorkflow(applicationWorkflow(this.store, this.messagingService));
        this.workflows.push(workflow);

        workflow.machine.send(request);
        break;
      }
      case 'APPROVE_BUDGET_AND_FUND': {
        const workflow = this.startWorkflow(
          approveBudgetAndFundWorkflow(this.store, this.messagingService, {
            player: request.player,
            hub: request.hub,
            budget: request.budget,
            requestId: request.requestId
          })
        );
        this.workflows.push(workflow);

        workflow.machine.send(request);
        break;
      }
      case 'ENABLE_ETHEREUM': {
        const workflow = this.startWorkflow(
          ethereumEnableWorkflow(this.store, this.messagingService, {requestId: request.requestId})
        );
        this.workflows.push(workflow);
        break;
      }
    }
  }
  private startWorkflow(machineConfig: StateNode<any, any, any, any>): Workflow {
    const workflowId = Guid.create().toString();
    const machine = interpret<any, any, any>(machineConfig, {
      devTools: true
    })
      .onTransition((state, event) => process.env.ADD_LOGS && logTransition(state, event, this.id))

      .onDone(() => (this.workflows = this.workflows.filter(w => w.id !== workflowId)))
      .start();
    // TODO: Figure out how to resolve rendering priorities
    this.renderUI(machine);

    return {id: workflowId, machine, domain: 'TODO'};
  }

  private renderUI(machine) {
    if (document.getElementById('root')) {
      ReactDOM.render(
        React.createElement(WalletUi, {workflow: machine}),
        document.getElementById('root')
      );
    }
  }

  public async pushMessage(jsonRpcMessage) {
    // Update any workflows waiting on an observable
    await this.messagingService.receiveRequest(jsonRpcMessage);
  }

  public onSendMessage(callback: (jsonRpcMessage: Notification | Response) => void) {
    this.messagingService.outboxFeed.subscribe(m => callback(m));
  }
}

export function logTransition(
  state: State<any, any, any, any>,
  event,
  id?: string,
  logger = console
): void {
  const to = JSON.stringify(state.value);
  if (!state.history) {
    logger.log(`${id || ''} - STARTED ${state.configuration[0].id} TRANSITIONED TO ${to}`);
  } else {
    const from = JSON.stringify(state.history.value);
    const eventType = JSON.stringify(event.type ? event.type : event);

    logger.log(`${id || ''} - TRANSITION FROM ${from} EVENT ${eventType} TO  ${to}`);
  }
  Object.keys(state.children).forEach(k => {
    const child = state.children[k];

    if (child.state && 'onTransition' in child) {
      const subId = (child as any).state.configuration[0].id;
      (child as any).onTransition((state, event) =>
        logTransition(state, event, `${id} - ${subId}`)
      );
    }
  });
}
