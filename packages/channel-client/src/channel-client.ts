import {ChannelProviderInterface} from '@statechannels/channel-provider';

import {ChannelClientInterface, UnsubscribeFunction} from './types';
import {
  PushMessageResult,
  ChannelResult,
  Allocation,
  Participant,
  SiteBudget,
  ChannelUpdatedNotification,
  ChannelProposedNotification,
  BudgetUpdatedNotification,
  Message,
  MessageQueuedNotification,
  FundingStrategy
} from '@statechannels/client-api-schema';
import {HUB} from './constants';
import {ETH_TOKEN_ADDRESS} from '../tests/constants';

type TokenAllocations = Allocation[];

export class ChannelClient implements ChannelClientInterface {
  get signingAddress(): string | undefined {
    return this.provider.signingAddress;
  }

  get selectedAddress(): string | undefined {
    return this.provider.selectedAddress;
  }

  get walletVersion(): string | undefined {
    return this.provider.walletVersion;
  }

  constructor(readonly provider: ChannelProviderInterface) {}

  onMessageQueued(
    callback: (result: MessageQueuedNotification['params']) => void
  ): UnsubscribeFunction {
    this.provider.on('MessageQueued', callback);
    return (): void => {
      this.provider.off('MessageQueued', callback);
    };
  }

  onChannelUpdated(
    callback: (result: ChannelUpdatedNotification['params']) => void
  ): UnsubscribeFunction {
    this.provider.on('ChannelUpdated', callback);
    return (): void => {
      this.provider.off('ChannelUpdated', callback);
    };
  }

  onChannelProposed(
    callback: (result: ChannelProposedNotification['params']) => void
  ): UnsubscribeFunction {
    this.provider.on('ChannelProposed', callback);
    return (): void => {
      this.provider.off('ChannelProposed', callback);
    };
  }

  onBudgetUpdated(
    callback: (result: BudgetUpdatedNotification['params']) => void
  ): UnsubscribeFunction {
    this.provider.on('BudgetUpdated', callback);
    return (): void => {
      this.provider.off('BudgetUpdated', callback);
    };
  }
  async createChannel(
    participants: Participant[],
    allocations: TokenAllocations,
    appDefinition: string,
    appData: string,
    fundingStrategy: FundingStrategy
  ): Promise<ChannelResult> {
    return this.provider.send({
      method: 'CreateChannel',
      params: {
        participants,
        allocations,
        appDefinition,
        appData,
        fundingStrategy
      }
    });
  }

  async joinChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send({method: 'JoinChannel', params: {channelId}});
  }

  async updateChannel(
    channelId: string,
    participants: Participant[],
    allocations: TokenAllocations,
    appData: string
  ): Promise<ChannelResult> {
    return this.provider.send({
      method: 'UpdateChannel',
      params: {
        channelId,
        participants,
        allocations,
        appData
      }
    });
  }

  async getState(channelId: string): Promise<ChannelResult> {
    return this.provider.send({method: 'GetState', params: {channelId}});
  }

  async challengeChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send({
      method: 'ChallengeChannel',
      params: {
        channelId
      }
    });
  }

  async closeChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send({method: 'CloseChannel', params: {channelId}});
  }

  async pushMessage(message: Message): Promise<PushMessageResult> {
    return this.provider.send({method: 'PushMessage', params: message});
  }

  async approveBudgetAndFund(
    receiveCapacity: string,
    sendCapacity: string,
    _playerOutcomeAddress: string, // TODO: This is done by the wallet and not needed
    hubAddress: string,
    hubOutcomeAddress: string
  ): Promise<SiteBudget> {
    return this.provider.send({
      method: 'ApproveBudgetAndFund',
      params: {
        requestedReceiveCapacity: receiveCapacity,
        requestedSendCapacity: sendCapacity,
        token: ETH_TOKEN_ADDRESS,
        playerParticipantId: this.signingAddress as string,

        hub: {
          participantId: HUB.participantId,
          signingAddress: hubAddress,
          destination: hubOutcomeAddress
        }
      }
    });
  }

  async getBudget(hubAddress: string): Promise<SiteBudget> {
    return this.provider.send({method: 'GetBudget', params: {hubAddress}});
  }

  async closeAndWithdraw(hubAddress: string, hubOutcomeAddress: string): Promise<SiteBudget> {
    return this.provider.send({
      method: 'CloseAndWithdraw',
      params: {
        playerParticipantId: this.signingAddress as string,
        hub: {
          participantId: HUB.participantId,
          signingAddress: hubAddress,
          destination: hubOutcomeAddress
        }
      }
    });
  }
}
