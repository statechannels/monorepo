import {AppData, ChannelState, encodeAppData} from '../core';
import {BigNumber, bigNumberify} from 'ethers/utils';
import {
  ChannelClient,
  NotificationName,
  JsonRPCNotification,
  Message,
  ChannelUpdatedNotification,
} from './channel-client';
import {RPS_ADDRESS} from '../constants';

// This class wraps the channel client converting the request/response formats to those used in the app

export class RPSChannelClient {
  channelClient: ChannelClient;

  constructor() {
    // might want to pass this in later
    this.channelClient = new ChannelClient();
  }

  async createChannel(
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData
  ): Promise<ChannelState> {
    const participants = [
      {participantId: aAddress, signingAddress: aAddress, destination: aAddress},
      {participantId: bAddress, signingAddress: bAddress, destination: bAddress},
    ];

    const allocations = [
      {
        token: '0x0',
        allocationItems: [
          {destination: aAddress, amount: aBal},
          {destination: bAddress, amount: bBal},
        ],
      },
    ];

    const appDefinition = RPS_ADDRESS;

    const appData = encodeAppData(appAttrs);

    // ignore return val for now and stub out response
    await this.channelClient.createChannel({participants, allocations, appDefinition, appData});

    return await {
      channelId: '0xsome-channel-id',
      turnNum: bigNumberify(0),
      status: 'open',
      aUserId: aAddress,
      bUserId: bAddress,
      aDestination: aAddress,
      bDestination: bAddress,
      aBal,
      bBal,
      appData: appAttrs,
    };
  }

  async getAddress() {
    await this.channelClient.getAddress();
  }

  async onMessageQueued(callback: (message: JsonRPCNotification<Message>) => any) {
    await this.channelClient.onMessageQueued(callback);
  }

  // Accepts an rps-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  async onChannelUpdated(rpsCallback: (channelState: ChannelState) => any) {
    function callback(notification: ChannelUpdatedNotification): any {
      const channelState: ChannelState = {
        ...notification.params,
        aUserId: notification.params.participants[0].participantId,
        bUserId: notification.params.participants[1].participantId,
        aDestination: notification.params.participants[0].destination,
        bDestination: notification.params.participants[1].destination,
        aBal: notification.params.allocations[0].allocationItems[0].amount,
        bBal: notification.params.allocations[0].allocationItems[1].amount,
      };
      rpsCallback(channelState);
    }
    await this.channelClient.onChannelUpdated(callback);
  }

  async unSubscribe(notificationName: NotificationName) {
    await this.channelClient.unSubscribe(notificationName);
  }

  async joinChannel() {}

  async updateChannel(channelId, aBal, bBal, appData: AppData) {}

  async pushMessage() {}
}
