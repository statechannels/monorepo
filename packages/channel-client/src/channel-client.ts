import {ChannelProviderInterface} from '@statechannels/channel-provider';

import {
  ChannelClientInterface,
  ChannelResult,
  UnsubscribeFunction,
  Message,
  SiteBudget
} from './types';
import {
  PushMessageResult,
  TokenAllocations,
  Participant,
  BudgetResult
} from '@statechannels/client-api-schema';

export class ChannelClient implements ChannelClientInterface<ChannelResult> {
  constructor(private readonly provider: ChannelProviderInterface) {}

  onMessageQueued(callback: (message: Message<ChannelResult>) => void): UnsubscribeFunction {
    this.provider.on('MessageQueued', callback);
    return this.provider.off.bind(this, 'MessageQueued', callback);
  }

  onChannelUpdated(callback: (result: ChannelResult) => void): UnsubscribeFunction {
    this.provider.on('ChannelUpdated', result => callback(result.params));
    return this.provider.off.bind(this, 'ChannelUpdated', callback);
  }

  // TODO: Currently not in use in the xstate wallet
  onChannelProposed(callback: (result: ChannelResult) => void): UnsubscribeFunction {
    this.provider.on('ChannelProposed', result => callback(result.params));
    return this.provider.off.bind(this, 'ChannelProposed', callback);
  }

  onBudgetUpdated(callback: (result: SiteBudget) => void): UnsubscribeFunction {
    this.provider.on('BudgetUpdated', result => callback(result.params));
    return this.provider.off.bind(this, 'BudgetUpdated', callback);
  }

  async createChannel(
    participants: Participant[],
    allocations: TokenAllocations,
    appDefinition: string,
    appData: string
  ): Promise<ChannelResult> {
    return this.provider.send('CreateChannel', {
      participants,
      allocations,
      appDefinition,
      appData
    });
  }

  async joinChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send('JoinChannel', {channelId});
  }

  async updateChannel(
    channelId: string,
    participants: Participant[],
    allocations: TokenAllocations,
    appData: string
  ): Promise<ChannelResult> {
    return this.provider.send('UpdateChannel', {
      channelId,
      participants,
      allocations,
      appData
    });
  }

  async challengeChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send('ChallengeChannel', {
      channelId
    });
  }

  async closeChannel(channelId: string): Promise<ChannelResult> {
    return this.provider.send('CloseChannel', {channelId});
  }

  async pushMessage(message: Message<ChannelResult>): Promise<PushMessageResult> {
    return this.provider.send('PushMessage', message);
  }

  async getAddress(): Promise<string> {
    return this.provider.send('GetAddress', {});
  }

  async getEthereumSelectedAddress(): Promise<string> {
    return this.provider.send('GetEthereumSelectedAddress', {});
  }

  async approveBudgetAndFund(
    playerAmount: string,
    hubAmount: string,
    playerDestinationAddress: string,
    hubAddress: string,
    hubDestinationAddress: string
  ): Promise<BudgetResult> {
    return this.provider.send('ApproveBudgetAndFund', {
      playerAmount,
      hubAmount,
      playerDestinationAddress,
      hubAddress,
      hubDestinationAddress
    });
  }

  async getBudget(hubAddress: string): Promise<BudgetResult> {
    return this.provider.send('GetBudget', {hubAddress});
  }

  async CloseAndWithdraw(hubAddress: string): Promise<BudgetResult> {
    return this.provider.send('CloseAndWithdraw', {hubAddress});
  }
}
