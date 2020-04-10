import {MessagingServiceInterface, MessagingService} from '../messaging';
import {Wallet} from 'ethers/wallet';
import {ChannelWallet, logTransition} from '../channel-wallet';
import {Participant} from '../store/types';
import {Chain} from '../chain';
import {
  isNotification,
  PushMessageRequest,
  JoinChannelRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  CloseChannelRequest,
  ApproveBudgetAndFundRequest,
  CloseAndWithdrawRequest
} from '@statechannels/client-api-schema';
import {interpret, Interpreter} from 'xstate';
import {CreateAndFundLedger, Application as App} from '../workflows';
import {Guid} from 'guid-typescript';
import * as CloseLedgerAndWithdraw from '../workflows/close-ledger-and-withdraw';
import {TestStore} from '../workflows/tests/store';
import {ETH_TOKEN} from '../constants';
import {makeDestination} from '../utils';
import {hexZeroPad} from 'ethers/utils';

export class Player {
  privateKey: string;
  get signingAddress() {
    return new Wallet(this.privateKey).address;
  }
  store: TestStore;
  messagingService: MessagingServiceInterface;
  channelWallet: ChannelWallet;

  startCloseLedgerAndWithdraw(context: CloseLedgerAndWithdraw.WorkflowContext) {
    const workflowId = Guid.create().toString();
    const service = interpret<any, any, any>(
      CloseLedgerAndWithdraw.workflow(this.store, this.messagingService, context),
      {devTools: true}
    )
      .onTransition((state, event) => process.env.ADD_LOGS && logTransition(state, event, this.id))

      .start();

    this.channelWallet.workflows.push({id: workflowId, service, domain: 'TODO'});
  }
  startCreateAndFundLedger(context: CreateAndFundLedger.WorkflowContext) {
    const workflowId = Guid.create().toString();
    const service = interpret<any, any, any>(
      CreateAndFundLedger.createAndFundLedgerWorkflow(this.store, context),
      {
        devTools: true
      }
    )
      .onTransition((state, event) => process.env.ADD_LOGS && logTransition(state, event, this.id))

      .start();

    this.channelWallet.workflows.push({id: workflowId, service, domain: 'TODO'});
  }
  startAppWorkflow(startingState: string, context: App.WorkflowContext) {
    const workflowId = Guid.create().toString();
    const service = interpret<any, any, any>(
      App.workflow(this.store, this.messagingService).withContext(context),
      {devTools: true}
    )
      .onTransition((state, event) => process.env.ADD_LOGS && logTransition(state, event, this.id))
      .start(startingState);

    this.channelWallet.workflows.push({id: workflowId, service, domain: 'TODO'});
  }
  get workflowMachine(): Interpreter<any, any, any, any> | undefined {
    return this.channelWallet.workflows[0]?.service;
  }
  get workflowState(): string | object | undefined {
    return this.channelWallet.workflows[0]?.service.state.value;
  }
  get destination() {
    return makeDestination('0x63E3FB11830c01ac7C9C64091c14Bb6CbAaC9Ac7');
  }
  get participant(): Participant {
    return {
      participantId: this.signingAddress,
      destination: this.destination,
      signingAddress: this.signingAddress
    };
  }
  get participantId(): string {
    return this.signingAddress;
  }
  private constructor(privateKey: string, private id: string, chain: Chain) {
    this.privateKey = privateKey;
    this.store = new TestStore(chain);
    this.messagingService = new MessagingService(this.store);
    this.channelWallet = new ChannelWallet(this.store, this.messagingService, id);
  }

  static async createPlayer(privateKey: string, id: string, chain: Chain): Promise<Player> {
    const player = new Player(privateKey, id, chain);
    await player.store.initialize([privateKey]);
    return player;
  }
}

export function hookUpMessaging(playerA: Player, playerB: Player) {
  playerA.channelWallet.onSendMessage(async message => {
    if (isNotification(message) && message.method === 'MessageQueued') {
      const pushMessageRequest = generatePushMessage(message.params);
      if (process.env.ADD_LOGS) {
        console.log(`MESSAGE A->B: ${JSON.stringify(pushMessageRequest)}`);
      }
      await playerB.channelWallet.pushMessage(pushMessageRequest, 'localhost');
    }
  });

  playerB.channelWallet.onSendMessage(message => {
    if (isNotification(message) && message.method === 'MessageQueued') {
      const pushMessageRequest = generatePushMessage(message.params);
      if (process.env.ADD_LOGS) {
        console.log(`MESSAGE B->A: ${JSON.stringify(pushMessageRequest)}`);
      }
      playerA.channelWallet.pushMessage(pushMessageRequest, 'localhost');
    }
  });
}

function generatePushMessage(messageParams): PushMessageRequest {
  return {
    jsonrpc: '2.0',
    id: 111111111,
    method: 'PushMessage',
    params: messageParams
  };
}

export function generateCloseRequest(channelId: string): CloseChannelRequest {
  return {
    jsonrpc: '2.0',
    method: 'CloseChannel',
    id: 777777777,
    params: {
      channelId
    }
  };
}

export function generatePlayerUpdate(
  channelId: string,
  playerA: Participant,
  playerB: Participant
): UpdateChannelRequest {
  return {
    id: 555555555,
    method: 'UpdateChannel',
    jsonrpc: '2.0',
    params: {
      channelId,
      participants: [playerA, playerB],
      appData: '0x0',
      allocations: [
        {
          token: hexZeroPad('0x0', 32),
          allocationItems: [
            {
              destination: playerA.destination,
              amount: hexZeroPad('0x06f05b59d3b20000', 32)
            },
            {
              destination: playerB.destination,
              amount: hexZeroPad('0x06f05b59d3b20000', 32)
            }
          ]
        }
      ]
    }
  };
}

export function generateJoinChannelRequest(channelId: string): JoinChannelRequest {
  return {id: 222222222, method: 'JoinChannel', jsonrpc: '2.0', params: {channelId}};
}

export function generateCreateChannelRequest(
  playerA: Participant,
  playerB: Participant
): CreateChannelRequest {
  return {
    jsonrpc: '2.0',
    id: 3333333333,
    method: 'CreateChannel',
    params: {
      participants: [playerA, playerB],
      allocations: [
        {
          token: hexZeroPad('0x0', 32),
          allocationItems: [
            {
              destination: playerA.destination,
              amount: hexZeroPad('0x06f05b59d3b20000', 32)
            },
            {
              destination: playerB.destination,
              amount: hexZeroPad('0x06f05b59d3b20000', 32)
            }
          ]
        }
      ],
      appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
      appData: '0x0',
      fundingStrategy: 'Direct'
    }
  };
}

export function generateApproveBudgetAndFundRequest(
  player: Participant,
  hub: Participant
): ApproveBudgetAndFundRequest {
  return {
    jsonrpc: '2.0',
    id: 88888888,
    method: 'ApproveBudgetAndFund',
    params: {
      token: ETH_TOKEN,
      hub,
      playerParticipantId: player.participantId,
      requestedSendCapacity: hexZeroPad('0x5', 32),
      requestedReceiveCapacity: hexZeroPad('0x5', 32)
    }
  };
}

export function generateCloseAndWithdrawRequest(
  player: Participant,
  hub: Participant
): CloseAndWithdrawRequest {
  return {
    jsonrpc: '2.0',
    id: 88888888,
    method: 'CloseAndWithdraw',
    params: {
      hub,
      playerParticipantId: player.participantId
    }
  };
}
