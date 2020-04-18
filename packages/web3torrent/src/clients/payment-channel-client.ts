import {ChannelResult, ChannelClientInterface} from '@statechannels/channel-client';
import {utils, constants} from 'ethers';
import {FakeChannelProvider} from '@statechannels/channel-client';
import {ChannelClient} from '@statechannels/channel-client';
import {ChannelStatus, Message} from '@statechannels/client-api-schema';
import {SiteBudget} from '@statechannels/client-api-schema';
import {
  SINGLE_ASSET_PAYMENT_CONTRACT_ADDRESS,
  HUB,
  FIREBASE_PREFIX,
  fireBaseConfig,
  FUNDING_STRATEGY,
  INITIAL_BUDGET_AMOUNT
} from '../constants';
import {AddressZero} from 'ethers/constants';
import * as firebase from 'firebase/app';
import 'firebase/database';
import _ from 'lodash';
import {logger} from '../logger';
import EventEmitter from 'eventemitter3';
const log = logger.child({module: 'payment-channel-client'});
const hexZeroPad = utils.hexZeroPad;

function sanitizeMessageForFirebase(message) {
  return JSON.parse(JSON.stringify(message));
}

const bigNumberify = utils.bigNumberify;
const FINAL_SETUP_STATE = utils.bigNumberify(3); // for a 2 party ForceMove channel
const APP_DATA = constants.HashZero; // unused in the SingleAssetPaymentApp
export interface ChannelState {
  channelId: string;
  turnNum: utils.BigNumber;
  status: ChannelStatus;
  challengeExpirationTime;
  beneficiary: string;
  payer: string;
  beneficiaryOutcomeAddress: string;
  payerOutcomeAddress: string;
  beneficiaryBalance: string;
  payerBalance: string;
}

enum Index {
  Payer = 0,
  Beneficiary = 1
}

// This class wraps the channel client converting the
// request/response formats to those used in the app

if (process.env.REACT_APP_FAKE_CHANNEL_PROVIDER === 'true') {
  window.channelProvider = new FakeChannelProvider();
} else {
  // TODO: Replace with injection via other means than direct app import
  // NOTE: This adds `channelProvider` to the `Window` object
  require('@statechannels/channel-provider');
}

// This Client targets at _unidirectional_, single asset (ETH) payment channel with 2 participants running on Nitro protocol
// The beneficiary proposes the channel, but accepts payments
// The payer joins the channel, and makes payments
export class PaymentChannelClient {
  channelCache: Record<string, ChannelState | undefined> = {};
  budgetCache?: SiteBudget;

  get mySigningAddress(): string | undefined {
    return this.channelClient.signingAddress;
  }

  get myEthereumSelectedAddress(): string | undefined {
    return this.channelClient.selectedAddress;
  }

  constructor(private readonly channelClient: ChannelClientInterface) {
    this.channelClient.onChannelUpdated(channelResult => {
      log.info({channelResult}, 'Converting to channel state');
      const channelState = convertToChannelState(channelResult);
      log.info({channelState}, 'Channel state received');
      this.updateChannelCache(channelState);

      this._eventEmitter.emit('ChannelState', channelState);
    });

    this.channelClient.onBudgetUpdated(budgetResult => {
      this.budgetCache = budgetResult;
    });
  }

  async enable() {
    log.info('enabling payment channel client');
    await this.channelClient.provider.mountWalletComponent(process.env.REACT_APP_WALLET_URL);
    await this.channelClient.provider.enable();
    this.initializeHubComms();
    log.info('payment channel client enabled');
    // TODO: This should probably not be long term behavior
    const existingBudget = await this.getBudget();
    if (_.isEmpty(existingBudget) && FUNDING_STRATEGY !== 'Direct') {
      await this.createBudget(INITIAL_BUDGET_AMOUNT);
    }
  }

  private initializeHubComms() {
    if (!fireBaseConfig) {
      log.error('Abandoning firebase setup, configuration is undefined');
      return;
    }

    // Hub messaging
    firebase.initializeApp(fireBaseConfig);
    const myFirebaseRef = firebase
      .database()
      .ref(`/${FIREBASE_PREFIX}/messages/${this.mySigningAddress}`);
    const hubFirebaseRef = firebase
      .database()
      .ref(`/${FIREBASE_PREFIX}/messages/${HUB.participantId}`);

    // firebase setup
    myFirebaseRef.onDisconnect().remove();

    this.onMessageQueued((message: Message) => {
      if (message.recipient === HUB.participantId) {
        hubFirebaseRef.push(sanitizeMessageForFirebase(message));
      }
    });

    myFirebaseRef.on('child_added', async snapshot => {
      const key = snapshot.key;
      const message = snapshot.val();
      myFirebaseRef.child(key).remove();
      log.info({message}, 'GOT FROM FIREBASE: ');
      await this.pushMessage(message);
    });
  }

  async createChannel(
    beneficiary: string,
    payer: string,
    beneficiaryBalance: string,
    payerBalance: string,
    beneficiaryOutcomeAddress: string,
    payerOutcomeAddress: string
  ): Promise<ChannelState> {
    const participants = formatParticipants(
      beneficiary,
      payer,
      beneficiaryOutcomeAddress,
      payerOutcomeAddress
    );
    const allocations = formatAllocations(
      beneficiaryOutcomeAddress,
      payerOutcomeAddress,
      beneficiaryBalance,
      payerBalance
    );

    const appDefinition = SINGLE_ASSET_PAYMENT_CONTRACT_ADDRESS;
    const channelResult = await this.channelClient.createChannel(
      participants,
      allocations,
      appDefinition,
      APP_DATA,
      FUNDING_STRATEGY
    );

    this.insertIntoChannelCache(convertToChannelState(channelResult));

    return convertToChannelState(channelResult);
  }

  onMessageQueued(callback: (message: Message) => void) {
    return this.channelClient.onMessageQueued(callback);
  }

  insertIntoChannelCache(channelState: ChannelState) {
    this.channelCache = {...this.channelCache, [channelState.channelId]: channelState};
  }

  updateChannelCache(channelState: ChannelState) {
    this.channelCache[channelState.channelId] && // only update an existing key
      (this.channelCache[channelState.channelId] = channelState);
  }

  private _eventEmitter = new EventEmitter<{ChannelState: [ChannelState]}>();
  // Accepts an payment-channel-friendly callback, performs the necessary encoding, and subscribes to the channelClient with an appropriate, API-compliant callback
  onChannelStateReceived(web3tCallback: (channelState: ChannelState) => any) {
    this._eventEmitter.on('ChannelState', web3tCallback);
    return () => this._eventEmitter.off('ChannelState', web3tCallback);
  }

  onChannelProposed(web3tCallback: (channelState: ChannelState) => any) {
    function callback(channelResult: ChannelResult): any {
      web3tCallback(convertToChannelState(channelResult));
    }
    const unsubChannelProposed = this.channelClient.onChannelProposed(callback);
    return () => {
      unsubChannelProposed();
    };
  }

  async joinChannel(channelId: string) {
    const channelResult = await this.channelClient.joinChannel(channelId);
    this.insertIntoChannelCache(convertToChannelState(channelResult));
  }

  async closeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.closeChannel(channelId);
    this.updateChannelCache(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async challengeChannel(channelId: string): Promise<ChannelState> {
    const channelResult = await this.channelClient.challengeChannel(channelId);
    this.updateChannelCache(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  async updateChannel(
    channelId: string,
    beneficiary: string,
    payer: string,
    beneficiaryBalance: string,
    payerBalance: string,
    beneficiaryOutcomeAddress: string,
    payerOutcomeAddress: string
  ): Promise<ChannelState> {
    const allocations = formatAllocations(
      beneficiaryOutcomeAddress,
      payerOutcomeAddress,
      beneficiaryBalance,
      payerBalance
    );
    const participants = formatParticipants(
      beneficiary,
      payer,
      beneficiaryOutcomeAddress,
      payerOutcomeAddress
    );

    const channelResult = await this.channelClient.updateChannel(
      channelId,
      participants,
      allocations,
      APP_DATA
    );
    this.updateChannelCache(convertToChannelState(channelResult));
    return convertToChannelState(channelResult);
  }

  // payer may use this method to make payments (if they have sufficient funds)
  async makePayment(channelId: string, amount: string) {
    const channelState: ChannelState = await new Promise(resolve => {
      const readyToPay = (state: ChannelState | undefined) =>
        state &&
        state.status === 'running' &&
        state.payer === this.mySigningAddress &&
        state.turnNum.mod(2).eq(Index.Payer);

      const currentState = this.channelCache[channelId];
      if (readyToPay(currentState)) resolve(currentState);

      const unsubscribeListener = this.onChannelStateReceived(cu => {
        if (readyToPay(cu)) {
          unsubscribeListener();
          resolve(cu);
        }
      });
    });

    const {payerBalance} = channelState;
    if (bigNumberify(payerBalance).lt(amount)) {
      console.error('Insufficient fund to make a payment. Closing channel.');
      await this.closeChannel(channelId);
      return;
    }

    await this.updateChannel(
      channelId,
      channelState.beneficiary,
      channelState.payer,
      add(channelState.beneficiaryBalance, amount),
      subract(payerBalance, amount),
      channelState.beneficiaryOutcomeAddress,
      channelState.payerOutcomeAddress
    );
  }

  // beneficiary may use this method to accept payments
  async acceptChannelUpdate(channelState: ChannelState) {
    const {
      channelId,
      beneficiary,
      payer,
      beneficiaryBalance,
      payerBalance,
      beneficiaryOutcomeAddress,
      payerOutcomeAddress
    } = channelState;
    await this.updateChannel(
      channelId,
      beneficiary,
      payer,
      beneficiaryBalance,
      payerBalance,
      beneficiaryOutcomeAddress,
      payerOutcomeAddress
    );
  }

  amProposer(channelIdOrChannelState: string | ChannelState): boolean {
    if (typeof channelIdOrChannelState === 'string') {
      return this.channelCache[channelIdOrChannelState]?.beneficiary === this.mySigningAddress;
    } else {
      return channelIdOrChannelState.beneficiary === this.mySigningAddress;
    }
  }

  isPaymentToMe(channelState: ChannelState): boolean {
    // doesn't guarantee that my balance increased
    if (channelState.beneficiary === this.mySigningAddress) {
      return channelState.status === 'running' && channelState.turnNum.mod(2).eq(1);
    }
    return false; // only beneficiary may receive payments
  }

  shouldSendSpacerState(channelState: ChannelState): boolean {
    return channelState.turnNum.eq(FINAL_SETUP_STATE) ? true : false;
  }

  async pushMessage(message: Message) {
    await this.channelClient.pushMessage(message);
  }

  async createBudget(amount: string) {
    const playerDestinationAddress = this.channelClient.selectedAddress;
    this.budgetCache = await this.channelClient.approveBudgetAndFund(
      amount,
      amount,
      playerDestinationAddress,
      HUB.signingAddress,
      HUB.outcomeAddress
    );
  }

  async getBudget(): Promise<SiteBudget> {
    this.budgetCache = await this.channelClient.getBudget(HUB.signingAddress);
    return this.budgetCache;
  }

  async closeAndWithdraw(): Promise<SiteBudget | {}> {
    const result = await this.channelClient.closeAndWithdraw(
      HUB.signingAddress,
      HUB.outcomeAddress
    );

    this.budgetCache = _.isEmpty(result) ? undefined : result;
    return this.budgetCache;
  }
}

export const paymentChannelClient = new PaymentChannelClient(
  new ChannelClient(window.channelProvider)
);

const convertToChannelState = (channelResult: ChannelResult): ChannelState => {
  const {
    turnNum,
    channelId,
    participants,
    allocations,
    challengeExpirationTime,
    status
  } = channelResult;

  return {
    channelId,
    turnNum: utils.bigNumberify(turnNum),
    status,
    challengeExpirationTime,
    beneficiary: participants[0].participantId,
    payer: participants[1].participantId,
    beneficiaryOutcomeAddress: participants[0].destination,
    payerOutcomeAddress: participants[1].destination,
    beneficiaryBalance: hexZeroPad(
      bigNumberify(allocations[0].allocationItems[0].amount).toHexString(),
      32
    ),
    payerBalance: hexZeroPad(
      bigNumberify(allocations[0].allocationItems[1].amount).toHexString(),
      32
    )
  };
};

const formatParticipants = (
  aAddress: string,
  bAddress: string,
  aOutcomeAddress: string = aAddress,
  bOutcomeAddress: string = bAddress
) => [
  {participantId: aAddress, signingAddress: aAddress, destination: aOutcomeAddress},
  {participantId: bAddress, signingAddress: bAddress, destination: bOutcomeAddress}
];

const formatAllocations = (aAddress: string, bAddress: string, aBal: string, bBal: string) => {
  return [
    {
      token: AddressZero,
      allocationItems: [
        {destination: aAddress, amount: hexZeroPad(bigNumberify(aBal).toHexString(), 32)},
        {destination: bAddress, amount: hexZeroPad(bigNumberify(bBal).toHexString(), 32)}
      ]
    }
  ];
};

const subract = (a: string, b: string) =>
  hexZeroPad(
    bigNumberify(a)
      .sub(bigNumberify(b))
      .toHexString(),
    32
  );

const add = (a: string, b: string) =>
  hexZeroPad(
    bigNumberify(a)
      .add(bigNumberify(b))
      .toHexString(),
    32
  );
