import {Wallet, utils} from 'ethers';
import {
  Participant,
  SignatureEntry,
  SignedState,
  signState,
  makeDestination,
  makeAddress
} from '@statechannels/wallet-core';
import {
  isStateChannelsNotification,
  PushMessageRequest,
  JoinChannelRequest,
  CreateChannelRequest,
  UpdateChannelRequest,
  CloseChannelRequest,
  ApproveBudgetAndFundRequest,
  CloseAndWithdrawRequest
} from '@statechannels/client-api-schema';
import {interpret, Interpreter} from 'xstate';
import {Guid} from 'guid-typescript';
import _ from 'lodash';

import {DBBackend} from '../store';
import {TestStore} from '../test-store';
import {Chain} from '../chain';
import {ETH_TOKEN} from '../constants';
import {logger} from '../logger';
import {ADD_LOGS} from '../config';
import * as CloseLedgerAndWithdraw from '../workflows/close-ledger-and-withdraw';
import {CreateAndFundLedger, Application as App} from '../workflows';
import {ChannelWallet, logTransition} from '../channel-wallet';
import {MessagingServiceInterface, MessagingService} from '../messaging';

const log = logger.info.bind(logger);

export class Player {
  get signingAddress() {
    return new Wallet(this.privateKey).address;
  }

  private constructor(
    public privateKey: string,
    private id: string,
    chain: Chain,
    backend?: DBBackend
  ) {
    this.store = new TestStore(chain, backend);
    this.messagingService = new MessagingService(this.store);
    this.channelWallet = new ChannelWallet(this.store, this.messagingService);
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
      .onTransition((state, event) => ADD_LOGS && logTransition(state, event, this.id))

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
      .onTransition((state, event) => ADD_LOGS && logTransition(state, event, this.id))

      .start();

    this.channelWallet.workflows.push({id: workflowId, service, domain: 'TODO'});
  }
  startAppWorkflow(startingState: string, context: App.WorkflowContext) {
    const workflowId = Guid.create().toString();
    const service = interpret<any, any, any>(
      App.workflow(this.store, this.messagingService).withContext(context),
      {devTools: true}
    )
      .onTransition((state, event) => ADD_LOGS && logTransition(state, event, this.id))
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
      signingAddress: makeAddress(this.signingAddress)
    };
  }
  get participantId(): string {
    return this.signingAddress;
  }

  signState(state: SignedState): SignedState {
    const mySignature: SignatureEntry = {
      signature: signState(state, this.privateKey),
      signer: makeAddress(this.signingAddress)
    };

    return {...state, signatures: _.unionBy(state.signatures, [mySignature], sig => sig.signature)};
  }

  static async createPlayer(
    privateKey: string,
    id: string,
    chain: Chain,
    backend?: DBBackend
  ): Promise<Player> {
    const player = new Player(privateKey, id, chain, backend);
    await player.store.initialize([privateKey], true, id);
    return player;
  }
}

export function hookUpMessaging(playerA: Player, playerB: Player) {
  playerA.channelWallet.onSendMessage(async message => {
    if (isStateChannelsNotification(message) && message.method === 'MessageQueued') {
      const pushMessageRequest = generatePushMessage(message.params);
      ADD_LOGS && log({pushMessageRequest}, 'MESSAGE A->B:');
      await playerB.channelWallet.pushMessage(pushMessageRequest, 'localhost');
    }
  });

  playerB.channelWallet.onSendMessage(message => {
    if (isStateChannelsNotification(message) && message.method === 'MessageQueued') {
      const pushMessageRequest = generatePushMessage(message.params);
      ADD_LOGS && log({pushMessageRequest}, 'MESSAGE B->A:');

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
      appData: '0x00',
      allocations: [
        {
          asset: '0x0000000000000000000000000000000000000000',
          allocationItems: [
            {
              destination: playerA.destination,
              amount: utils.hexZeroPad('0x06f05b59d3b20000', 32)
            },
            {
              destination: playerB.destination,
              amount: utils.hexZeroPad('0x06f05b59d3b20000', 32)
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
          asset: utils.hexZeroPad('0x00', 32),
          allocationItems: [
            {
              destination: playerA.destination,
              amount: utils.hexZeroPad('0x06f05b59d3b20000', 32)
            },
            {
              destination: playerB.destination,
              amount: utils.hexZeroPad('0x06f05b59d3b20000', 32)
            }
          ]
        }
      ],
      appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
      appData: '0x00',
      fundingStrategy: 'Direct',
      challengeDuration: 1000
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
      asset: ETH_TOKEN,
      hub,
      playerParticipantId: player.participantId,
      requestedSendCapacity: utils.hexZeroPad('0x5', 32),
      requestedReceiveCapacity: utils.hexZeroPad('0x5', 32)
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
      hubParticipantId: hub.participantId
    }
  };
}
