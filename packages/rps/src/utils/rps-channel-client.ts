import { AppData, ChannelState, encodeAppData, decodeAppData, ChannelStatus } from '../core';
import { IChannelClient, Message, FakeChannelClient, ChannelResult } from './channel-client';
import { RPS_ADDRESS } from '../constants';
import {
  CreateChannelResult,
  UpdateChannelResult,
  JoinChannelResult,
  CloseChannelResult,
} from '@statechannels/client-api-schema';

// This class wraps the channel client converting the request/response formats to those used in the app

export class RPSChannelClient {
  channelClient: IChannelClient;

  constructor() {
    // might want to pass this in later
    this.channelClient = new FakeChannelClient();
  }

  async createChannel(
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData
  ) {
    const participants = formatParticipants(aAddress, bAddress);
    const allocations = formatAllocations(aAddress, bAddress, aBal, bBal);
    const appDefinition = RPS_ADDRESS;

    const appData = encodeAppData(appAttrs);

    // ignore return val for now and stub out response
    const channelResult = await this.channelClient.createChannel(
      participants,
      allocations,
      appDefinition,
      appData
    );

    return convertToChannelState(channelResult);
  }

  async getAddress() {
    return this.channelClient.getAddress();
  }

  onMessageQueued(callback: (message: Message) => void) {
    return this.channelClient.onMessageQueued(callback);
  }

  // Accepts an rps-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  onChannelUpdated(rpsCallback: (channelState: ChannelState) => any) {
    function callback(channelResult: ChannelResult): any {
      rpsCallback(convertToChannelState(channelResult));
    }
    return this.channelClient.onChannelUpdated(callback);
  }

  async joinChannel(channelId: string) {
    const channelResult = await this.channelClient.joinChannel(channelId);
    return convertToChannelState(channelResult);
  }

  async closeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.closeChannel(channelId);
    return convertToChannelState(channelResult);
  }

  async updateChannel(
    channelId: string,
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData
  ) {
    const allocations = formatAllocations(aAddress, bAddress, aBal, bBal);
    const participants = formatParticipants(aAddress, bAddress);

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

  async pushMessage(message: Message) {
    await this.channelClient.pushMessage(message);
  }
}

const convertToChannelState = (
  channelResult: CreateChannelResult | UpdateChannelResult | JoinChannelResult | CloseChannelResult
): ChannelState => {
  const { turnNum, channelId, status, participants, allocations, appData } = channelResult;
  return {
    channelId,
    turnNum,
    status: status as ChannelStatus,
    appData: decodeAppData(appData),
    aUserId: participants[0].participantId,
    bUserId: participants[1].participantId,
    aAddress: participants[0].destination,
    bAddress: participants[1].destination,
    aBal: allocations[0].allocationItems[0].amount.toString(),
    bBal: allocations[0].allocationItems[1].amount.toString(),
  };
};

const formatParticipants = (aAddress: string, bAddress: string) => [
  { participantId: aAddress, signingAddress: aAddress, destination: aAddress },
  { participantId: bAddress, signingAddress: bAddress, destination: bAddress },
];

const formatAllocations = (aAddress: string, bAddress: string, aBal: string, bBal: string) => {
  return [
    {
      token: '0x0',
      allocationItems: [
        { destination: aAddress, amount: aBal },
        { destination: bAddress, amount: bBal },
      ],
    },
  ];
};
