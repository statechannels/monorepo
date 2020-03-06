/* eslint-disable @typescript-eslint/no-explicit-any */
import Service from '@ember/service';
import {
  ChannelResult,
  Message,
  ChannelClientInterface,
  UnsubscribeFunction
} from '@statechannels/channel-client';
import {AppData, encodeAppData, decodeAppData} from '../core/app-data';
import {ChannelState} from '../core/channel-state';

const {bigNumberify} = ethers.utils;

const TTT_ADDRESS = '0x000'; // Need to pass in the actual address at build time

const convertToChannelState = (channelResult: ChannelResult): ChannelState => {
  const {
    turnNum,
    channelId,
    status,
    participants,
    allocations,
    appData,
    challengeExpirationTime
  } = channelResult;
  return {
    channelId,
    turnNum: turnNum.toString(), // TODO: turnNum should be switched to a number (or be a string everywhere),
    status,
    challengeExpirationTime,
    appData: decodeAppData(appData),
    aUserId: participants[0].participantId,
    bUserId: participants[1].participantId,
    aAddress: participants[0].destination,
    bAddress: participants[1].destination,
    aOutcomeAddress: participants[0].destination,
    bOutcomeAddress: participants[1].destination,
    aBal: bigNumberify(allocations[0].allocationItems[0].amount).toString(),
    bBal: bigNumberify(allocations[0].allocationItems[1].amount).toString()
  };
};

const formatParticipants = (
  aAddress: string,
  bAddress: string,
  aOutcomeAddress: string = aAddress,
  bOutcomeAddress: string = bAddress
): {participantId: string; signingAddress: string; destination: string}[] => [
  {participantId: aAddress, signingAddress: aAddress, destination: aOutcomeAddress},
  {participantId: bAddress, signingAddress: bAddress, destination: bOutcomeAddress}
];

const formatAllocations = (
  aAddress: string,
  bAddress: string,
  aBal: string,
  bBal: string
): {token: string; allocationItems: {destination: string; amount: string}[]}[] => {
  return [
    {
      token: '0x0',
      allocationItems: [
        {destination: aAddress, amount: bigNumberify(aBal).toHexString()},
        {destination: bAddress, amount: bigNumberify(bBal).toHexString()}
      ]
    }
  ];
};

export default class TttChannelProvider extends Service {
  private channelClient!: ChannelClientInterface;

  enable(channelClient: ChannelClientInterface): void {
    this.channelClient = channelClient;
  }

  async createChannel(
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData,
    aOutcomeAddress: string = aAddress,
    bOutcomeAddress: string = bAddress
  ): Promise<ChannelState> {
    const participants = formatParticipants(aAddress, bAddress, aOutcomeAddress, bOutcomeAddress);
    const allocations = formatAllocations(aOutcomeAddress, bOutcomeAddress, aBal, bBal);
    const appDefinition = TTT_ADDRESS;
    const appData = encodeAppData(appAttrs);

    const channelResult = await this.channelClient.createChannel(
      participants,
      allocations,
      appDefinition,
      appData
    );

    return convertToChannelState(channelResult);
  }

  async getAddress(): Promise<string> {
    return this.channelClient.getAddress();
  }

  async getEthereumSelectedAddress(): Promise<string> {
    return this.channelClient.getEthereumSelectedAddress();
  }

  onMessageQueued(callback: (message: Message) => void): any {
    return this.channelClient.onMessageQueued(callback);
  }

  // Accepts a ttt-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  onChannelUpdated(tttCallback: (channelState: ChannelState) => UnsubscribeFunction): () => {} {
    function callback(channelResult: any): any {
      tttCallback(convertToChannelState(channelResult));
    }
    // These are two distinct events from the channel client
    // but for our purposes we can treat them the same
    // and rely on the channel status
    const unsubChannelUpdated = this.channelClient.onChannelUpdated(callback);
    const unsubChannelProposed = this.channelClient.onChannelProposed(callback);

    return (): any => {
      unsubChannelUpdated();
      unsubChannelProposed();
    };
  }

  async joinChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.joinChannel(channelId);
    return convertToChannelState(channelResult);
  }

  async closeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.closeChannel(channelId);
    return convertToChannelState(channelResult);
  }

  async challengeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.challengeChannel(channelId);
    return convertToChannelState(channelResult);
  }

  async updateChannel(
    channelId: string,
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData,
    aOutcomeAddress: string = aAddress,
    bOutcomeAddress: string = bAddress
  ): Promise<ChannelState> {
    const allocations = formatAllocations(aOutcomeAddress, bOutcomeAddress, aBal, bBal);
    const participants = formatParticipants(aAddress, bAddress, aOutcomeAddress, bOutcomeAddress);

    const appData = encodeAppData(appAttrs);

    // ignore return val for now and stub out response
    const channelResult = await this.channelClient.updateChannel(
      channelId,
      participants,
      allocations,
      appData
    );

    return convertToChannelState(channelResult);
  }

  async pushMessage(message: Message): Promise<void> {
    await this.channelClient.pushMessage(message);
  }
}

// DO NOT DELETE: this is how TypeScript knows how to look up your services.
declare module '@ember/service' {
  interface Registry {
    'ttt-channel-provider': TttChannelProvider;
  }
}
