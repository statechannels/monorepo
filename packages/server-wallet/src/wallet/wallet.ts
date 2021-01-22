import {
  UpdateChannelParams,
  CreateChannelParams,
  SyncChannelParams,
  JoinChannelParams,
  CloseChannelParams,
  GetStateParams,
  Participant as APIParticipant,
  ChannelId,
} from '@statechannels/client-api-schema';
import {
  deserializeAllocations,
  validatePayload,
  Outcome,
  convertToParticipant,
  Participant,
  BN,
  makeAddress,
  Address as CoreAddress,
  PrivateKey,
  makeDestination,
  deserializeRequest,
  calculateChannelId,
  State,
  NULL_APP_DATA,
} from '@statechannels/wallet-core';
import * as Either from 'fp-ts/lib/Either';
import Knex from 'knex';
import _ from 'lodash';
import EventEmitter from 'eventemitter3';
import {ethers, constants, BigNumber, utils} from 'ethers';
import {Logger} from 'pino';
import {Payload as WirePayload} from '@statechannels/wire-format';
import {ValidationErrorItem} from 'joi';

import {Bytes32} from '../type-aliases';
import {createLogger} from '../logger';
import * as UpdateChannel from '../handlers/update-channel';
import * as JoinChannel from '../handlers/join-channel';
import * as ChannelState from '../protocols/state';
import {isWalletError, PushMessageError} from '../errors/wallet-error';
import {timerFactory, recordFunctionMetrics, setupMetrics} from '../metrics';
import {
  ServerWalletConfig,
  extractDBConfigFromServerWalletConfig,
  defaultConfig,
  IncomingServerWalletConfig,
  validateServerWalletConfig,
} from '../config';
import {
  ChainServiceInterface,
  ChainEventSubscriberInterface,
  HoldingUpdatedArg,
  ChainService,
  MockChainService,
  ChannelFinalizedArg,
  AssetOutcomeUpdatedArg,
  ChallengeRegisteredArg,
} from '../chain-service';
import {DBAdmin} from '../db-admin/db-admin';
import {WALLET_VERSION} from '../version';
import {ObjectiveManager} from '../objectives';
import {SingleAppUpdater} from '../handlers/single-app-updater';
import {LedgerManager} from '../protocols/ledger-manager';

import {Store, AppHandler, MissingAppHandler} from './store';
import {
  SingleChannelOutput,
  MultipleChannelOutput,
  Output,
  WalletInterface,
  UpdateChannelFundingParams,
  WalletEvent,
} from './types';
import {WalletResponse} from './wallet-response';

// TODO: The client-api does not currently allow for outgoing messages to be
// declared as the result of a wallet API call.
// Nor does it allow for multiple channel results

type EventEmitterType = {
  [key in WalletEvent['type']]: WalletEvent['value'];
};

export class ConfigValidationError extends Error {
  constructor(public errors: ValidationErrorItem[]) {
    super('Server wallet configuration validation failed');
  }
}

/**
 * A statechannels wallet
 */
export class SingleThreadedWallet
  extends EventEmitter<EventEmitterType>
  implements WalletInterface, ChainEventSubscriberInterface {
  knex: Knex;
  store: Store;
  chainService: ChainServiceInterface;
  objectiveManager: ObjectiveManager;
  ledgerManager: LedgerManager;
  logger: Logger;

  readonly walletConfig: ServerWalletConfig;

  public static create(walletConfig: IncomingServerWalletConfig): SingleThreadedWallet {
    const wallet = new SingleThreadedWallet(walletConfig);
    // This is an async method so it could continue executing after this method returns
    wallet.registerExistingChannelsWithChainService();
    return wallet;
  }

  /**
   * Registers any channels existing in the database with the chain service
   * so the chain service can alert us of any block chain events for existing channels
   */
  private async registerExistingChannelsWithChainService() {
    const channelsToRegister = (await this.store.getNonFinalizedChannels())
      .map(ChannelState.toChannelResult)
      .map(cr => ({
        assetHolderAddresses: cr.allocations.map(a => makeAddress(a.assetHolderAddress)),
        channelId: cr.channelId,
      }));

    for (const {channelId, assetHolderAddresses} of channelsToRegister) {
      this.chainService.registerChannel(channelId, assetHolderAddresses, this);
    }
  }

  // protected constructor to force consumers to initialize wallet via Wallet.create(..)
  protected constructor(walletConfig: IncomingServerWalletConfig) {
    super();

    const populatedConfig = _.assign({}, defaultConfig, walletConfig);
    // Even though the config hasn't been validated we attempt to create a logger
    // This allows us to log out any config validation errors
    this.logger = createLogger(populatedConfig);

    const {errors, valid} = validateServerWalletConfig(populatedConfig);

    if (!valid) {
      errors.forEach(error =>
        this.logger.error({error}, `Validation error occured ${error.message}`)
      );
      throw new ConfigValidationError(errors);
    }
    this.walletConfig = populatedConfig;

    this.knex = Knex(extractDBConfigFromServerWalletConfig(this.walletConfig));

    this.store = new Store(
      this.knex,
      this.walletConfig.metricsConfiguration.timingMetrics,
      this.walletConfig.skipEvmValidation,
      utils.hexlify(this.walletConfig.networkConfiguration.chainNetworkID),
      this.logger
    );

    // set up timing metrics
    if (this.walletConfig.metricsConfiguration.timingMetrics) {
      // Validation ensures that the metricsOutputFile will be defined
      setupMetrics(this.walletConfig.metricsConfiguration.metricsOutputFile as string);
    }

    if (this.walletConfig.chainServiceConfiguration.attachChainService) {
      this.chainService = new ChainService(this.walletConfig.chainServiceConfiguration);
    } else {
      this.chainService = new MockChainService();
    }

    this.objectiveManager = ObjectiveManager.create({
      store: this.store,
      chainService: this.chainService,
      logger: this.logger,
      timingMetrics: this.walletConfig.metricsConfiguration.timingMetrics,
    });

    this.ledgerManager = LedgerManager.create({
      store: this.store,
      logger: this.logger,
      timingMetrics: this.walletConfig.metricsConfiguration.timingMetrics,
    });
  }
  /**
   * Adds an ethereum private key to the wallet's database
   *
   * @remarks
   *
   * This key will be used to sign state channel upates.
   * If a key is not added, a random key will be generated the first time it is required.
   * If a private key already exists, calling this function wil be a no-op.
   *
   * @param  privateKey - An ethereum private key
   * @returns A promise that resolves when the key has been successfully added.
   */
  public async addSigningKey(privateKey: PrivateKey): Promise<void> {
    await this.store.addSigningKey(privateKey);
  }

  public async registerAppDefinition(appDefinition: string): Promise<void> {
    const bytecode = await this.chainService.fetchBytecode(appDefinition);
    await this.store.upsertBytecode(
      utils.hexlify(this.walletConfig.networkConfiguration.chainNetworkID),
      makeAddress(appDefinition),
      bytecode
    );
  }

  public async registerAppBytecode(appDefinition: string, bytecode: string): Promise<void> {
    return this.store.upsertBytecode(
      utils.hexlify(this.walletConfig.networkConfiguration.chainNetworkID),
      makeAddress(appDefinition),
      bytecode
    );
  }

  public mergeMessages(output: Output[]): MultipleChannelOutput {
    return WalletResponse.mergeOutputs(output);
  }

  public async destroy(): Promise<void> {
    await this.knex.destroy();
    this.chainService.destructor();
  }

  public async syncChannels(channelIds: Bytes32[]): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    await Promise.all(channelIds.map(channelId => this._syncChannel(channelId, response)));

    return response.multipleChannelOutput();
  }

  public async syncChannel({channelId}: SyncChannelParams): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();
    await this._syncChannel(channelId, response);
    return response.singleChannelOutput();
  }

  private async _syncChannel(channelId: string, response: WalletResponse): Promise<void> {
    const {states, channelState} = await this.store.getStates(channelId);

    const {myIndex, participants} = channelState;

    states.forEach(s => response.queueState(s, myIndex, channelId));

    response.queueChannelRequest(channelId, myIndex, participants);
    response.queueChannelState(channelState);

    if (await this.store.isLedger(channelId)) {
      const proposals = await this.store.getLedgerProposals(channelId);
      const [[mine]] = _.partition(proposals, [
        'signingAddress',
        participants[myIndex].signingAddress,
      ]);
      if (mine && mine.proposal)
        response.queueProposeLedgerUpdate(
          channelId,
          myIndex,
          participants,
          mine.proposal,
          mine.nonce
        );
    }
  }

  async challenge(challengeState: State): Promise<SingleChannelOutput> {
    const channelId = calculateChannelId(challengeState);
    const response = WalletResponse.initialize();

    await this.knex.transaction(async tx => {
      const channel = await this.store.getChannel(channelId, tx);
      if (!channel) {
        throw new Error(`No channel found for channel id ${channelId}`);
      }

      const {objectiveId} = await this.store.ensureObjective(
        {
          type: 'SubmitChallenge',
          participants: [],
          data: {targetChannelId: channelId, challengeState},
        },
        tx
      );

      await this.store.approveObjective(objectiveId, tx);

      response.queueChannel(channel);
    });

    await this.takeActions([channelId], response);
    // TODO: In v0 of challenging the challengeStatus on the channel will not be updated
    // We return a single channel result anwyays in case there are messages in the outbox
    return response.singleChannelOutput();
  }

  public async getParticipant(): Promise<Participant | undefined> {
    let participant: Participant | undefined = undefined;

    try {
      participant = await this.store.getFirstParticipant();
    } catch (e) {
      if (isWalletError(e)) this.logger.error('Wallet failed to get a participant', e);
      else throw e;
    }

    return participant;
  }

  public async updateFundingForChannels(
    args: UpdateChannelFundingParams[]
  ): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    await Promise.all(args.map(a => this._updateChannelFunding(a, response)));

    return response.multipleChannelOutput();
  }

  async updateChannelFunding(args: UpdateChannelFundingParams): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();

    await this._updateChannelFunding(args, response);

    return response.singleChannelOutput();
  }

  private async _updateChannelFunding(
    {channelId, assetHolderAddress, amount}: UpdateChannelFundingParams,
    response: WalletResponse
  ): Promise<void> {
    await this.store.updateFunding(
      channelId,
      BN.from(amount),
      assetHolderAddress || makeAddress(constants.AddressZero)
    );

    await this.takeActions([channelId], response);
  }

  public async getSigningAddress(): Promise<CoreAddress> {
    return await this.store.getOrCreateSigningAddress();
  }

  async createLedgerChannel(
    args: Pick<CreateChannelParams, 'participants' | 'allocations' | 'challengeDuration'>,
    fundingStrategy: 'Direct' | 'Fake' = 'Direct'
  ): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();

    await this._createChannel(
      response,
      {
        ...args,
        appDefinition: ethers.constants.AddressZero,
        appData: NULL_APP_DATA,
        fundingStrategy,
      },
      'ledger'
    );

    return response.singleChannelOutput();
  }

  async createChannel(args: CreateChannelParams): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    await this._createChannel(response, args, 'app');

    return response.multipleChannelOutput();
  }

  async createChannels(
    args: CreateChannelParams,
    numberOfChannels: number
  ): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    await Promise.all(
      _.range(numberOfChannels).map(() => this._createChannel(response, args, 'app'))
    );

    return response.multipleChannelOutput();
  }

  private async _createChannel(
    response: WalletResponse,
    args: CreateChannelParams,
    role: 'app' | 'ledger' = 'app'
  ): Promise<string> {
    const {
      participants: serializedParticipants,
      appDefinition,
      appData,
      allocations,
      fundingStrategy,
      fundingLedgerChannelId,
      challengeDuration,
    } = args;

    const participants = serializedParticipants.map(convertToParticipant);
    const outcome: Outcome = deserializeAllocations(allocations);

    const channelNonce = await this.store.nextNonce(participants.map(p => p.signingAddress));

    const constants = {
      appDefinition: makeAddress(appDefinition),
      chainId: BigNumber.from(this.walletConfig.networkConfiguration.chainNetworkID).toHexString(),
      challengeDuration,
      channelNonce,
      participants,
    };

    const {channel, firstSignedState: signedState, objective} = await this.store.createChannel(
      constants,
      appData,
      outcome,
      fundingStrategy,
      role,
      fundingLedgerChannelId
    );

    response.queueState(signedState, channel.myIndex, channel.channelId);
    response.queueCreatedObjective(objective, channel.myIndex, channel.participants);
    response.queueChannelState(channel);

    this.registerChannelWithChainService(channel.channelId);

    return channel.channelId;
  }

  async joinChannels(channelIds: ChannelId[]): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();
    const objectives = await this.store.getObjectives(channelIds);

    await Promise.all(
      objectives.map(
        async ({type, objectiveId}) =>
          type === 'OpenChannel' && (await this.store.approveObjective(objectiveId))
      )
    );

    await this.takeActions(channelIds, response);

    await Promise.all(channelIds.map(id => this.registerChannelWithChainService(id)));

    return response.multipleChannelOutput();
  }

  async joinChannel({channelId}: JoinChannelParams): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();
    const channel = await this.store.getChannelState(channelId);

    if (!channel)
      throw new JoinChannel.JoinChannelError(
        JoinChannel.JoinChannelError.reasons.channelNotFound,
        channelId
      );

    const objectives = await this.store.getObjectives([channelId]);

    if (objectives.length === 0)
      throw new Error(`Could not find objective for channel ${channelId}`);

    if (objectives[0].type === 'OpenChannel')
      await this.store.approveObjective(objectives[0].objectiveId);

    await this.takeActions([channelId], response);

    this.registerChannelWithChainService(channelId);

    // set strict=false to silently drop any ledger channel updates from channelResults
    // TODO: change api so that joinChannel returns a MultipleChannelOutput
    return response.singleChannelOutput(false);
  }

  async updateChannel({
    channelId,
    allocations,
    appData,
  }: UpdateChannelParams): Promise<SingleChannelOutput> {
    const timer = timerFactory(
      this.walletConfig.metricsConfiguration.timingMetrics,
      `updateChannel ${channelId}`
    );
    const handleMissingChannel: MissingAppHandler<Promise<SingleChannelOutput>> = () => {
      throw new UpdateChannel.UpdateChannelError(
        UpdateChannel.UpdateChannelError.reasons.channelNotFound,
        {channelId}
      );
    };
    const criticalCode: AppHandler<Promise<SingleChannelOutput>> = async (tx, channel) => {
      const response = WalletResponse.initialize();
      const {myIndex} = channel;

      const outcome = recordFunctionMetrics(
        deserializeAllocations(allocations),
        this.walletConfig.metricsConfiguration.timingMetrics
      );

      const nextState = getOrThrow(
        recordFunctionMetrics(
          UpdateChannel.updateChannel({channelId, appData, outcome}, channel.protocolState),
          this.walletConfig.metricsConfiguration.timingMetrics
        )
      );
      const signedState = await timer('signing state', async () => {
        try {
          return this.store.signState(channel, nextState, tx);
        } catch (err) {
          this.logger.error({err, nextState}, 'Unable to update channel');
          throw err;
        }
      });
      response.queueState(signedState, myIndex, channelId);

      const channelState = await this.store.getChannelState(channelId, tx);
      response.queueChannelState(channelState);

      return response.singleChannelOutput();
    };

    return this.store.lockApp(channelId, criticalCode, handleMissingChannel, true);
  }

  async closeChannels(channelIds: Bytes32[]): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    for (const channelId of channelIds) await this._closeChannel(channelId, response);

    await this.takeActions(channelIds, response);

    return response.multipleChannelOutput();
  }

  async closeChannel({channelId}: CloseChannelParams): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();

    await this._closeChannel(channelId, response);
    await this.takeActions([channelId], response);

    return response.singleChannelOutput();
  }

  private async _closeChannel(channelId: Bytes32, response: WalletResponse): Promise<void> {
    await this.objectiveManager.commenceCloseChannel(channelId, response);
  }

  async getLedgerChannels(
    assetHolderAddress: string,
    participants: APIParticipant[]
  ): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    const channelStates = await this.store.getLedgerChannels(
      assetHolderAddress,
      participants.map(convertToParticipant)
    );

    channelStates.forEach(cs => response.queueChannelState(cs));

    return response.multipleChannelOutput();
  }

  async getChannels(): Promise<MultipleChannelOutput> {
    const response = WalletResponse.initialize();

    const channelStates = await this.store.getChannels();
    channelStates.forEach(cs => response.queueChannelState(cs));

    return response.multipleChannelOutput();
  }

  async getState({channelId}: GetStateParams): Promise<SingleChannelOutput> {
    const response = WalletResponse.initialize();

    try {
      const channel = await this.store.getChannelState(channelId);

      response.queueChannelState(channel);

      return response.singleChannelOutput();
    } catch (err) {
      this.logger.error({err}, 'Could not get channel');
      throw err;
    }
  }

  async pushMessage(rawPayload: unknown): Promise<MultipleChannelOutput> {
    const wirePayload = validatePayload(rawPayload);

    const response = WalletResponse.initialize();

    try {
      await this._pushMessage(wirePayload, response);

      return response.multipleChannelOutput();
    } catch (err) {
      this.logger.error({err}, 'Error during pushMessage');
      throw new PushMessageError('Error during pushMessage', {
        thisWalletVersion: WALLET_VERSION,
        payloadWalletVersion: wirePayload.walletVersion,
        cause: err,
      });
    }
  }

  /**
   * For pushing a message containing a single update to a running application channel
   */
  async pushUpdate(rawPayload: unknown): Promise<SingleChannelOutput> {
    const wirePayload = validatePayload(rawPayload);

    const response = WalletResponse.initialize();

    await SingleAppUpdater.create(this.store).update(wirePayload, response);

    return response.singleChannelOutput();
  }

  private async _pushMessage(wirePayload: WirePayload, response: WalletResponse): Promise<void> {
    const store = this.store;

    const {
      channelIds: channelIdsFromStates,
      channelResults: fromStoring,
    } = await this.store.pushMessage(wirePayload);

    const channelIdsFromRequests: Bytes32[] = [];
    const requests = (wirePayload.requests || []).map(deserializeRequest);

    for (const request of requests) {
      const {channelId} = request;

      channelIdsFromRequests.push(channelId);

      switch (request.type) {
        case 'GetChannel': {
          const {states: signedStates, channelState} = await store.getStates(channelId);

          // add signed states to response
          signedStates.forEach(s => response.queueState(s, channelState.myIndex, channelId));

          if (await this.store.isLedger(channelId)) {
            const proposals = await this.store.getLedgerProposals(channelId);

            const [[mine]] = _.partition(proposals, [
              'signingAddress',
              channelState.participants[channelState.myIndex].signingAddress,
            ]);

            if (mine && mine.proposal)
              response.queueProposeLedgerUpdate(
                channelId,
                channelState.myIndex,
                channelState.participants,
                mine.proposal,
                mine.nonce
              );
          }

          continue;
        }
        case 'ProposeLedgerUpdate':
          await store.storeLedgerProposal(
            channelId,
            request.outcome,
            request.nonce,
            request.signingAddress
          );
          continue;
        default:
          continue;
      }
    }

    // add channelResults to response
    fromStoring.forEach(cr => response.queueChannelResult(cr));

    const channelIds = _.uniq(channelIdsFromStates.concat(channelIdsFromRequests));

    await this.takeActions(channelIds, response);
  }

  private async takeActions(channels: Bytes32[], response: WalletResponse): Promise<void> {
    let needToCrank = true;
    while (needToCrank) {
      await this.crankUntilIdle(channels, response);
      needToCrank = await this.processLedgerQueue(channels, response);
    }
  }

  private async processLedgerQueue(
    channels: Bytes32[],
    response: WalletResponse
  ): Promise<boolean> {
    let requiresAnotherCrankUponCompletion = false;

    // Fetch ledger channels related to the channels argument where related means, either:
    // - The ledger channel is in the channels array
    // - The ledger channel is funding one of the channels in the channels array
    const ledgerIdsFundingChannels = await this.store.getLedgerChannelIdsFundingChannels(channels);
    const ledgerIdsFromChannels = await this.store.filterChannelIdsByIsLedger(channels);

    const ledgersToProcess = _.uniq(ledgerIdsFromChannels.concat(ledgerIdsFundingChannels));

    for (const ledgerChannelId of ledgersToProcess) {
      const result = await this.ledgerManager.crank(ledgerChannelId, response);
      requiresAnotherCrankUponCompletion = requiresAnotherCrankUponCompletion || result;
    }

    return requiresAnotherCrankUponCompletion;
  }

  // todo(tom): change function to return a value instead of mutating input args
  private async crankUntilIdle(channels: Bytes32[], response: WalletResponse): Promise<void> {
    // Fetch channels related to the channels argument where related means, either:
    // - The channel is in the channels array
    // - The channel is being funded by one of the channels in the channels array
    const channelsWithRelevantPendingReqs = await this.store.getChannelIdsPendingLedgerFundingFrom(
      channels
    );

    const objectives = (
      await this.store.getObjectives(channels.concat(channelsWithRelevantPendingReqs))
    ).filter(objective => objective.status === 'approved');

    // todo(tom): why isn't this just a for loop?
    while (objectives.length) {
      const objective = objectives[0];

      await this.objectiveManager.crank(objective.objectiveId, response);

      // remove objective from list
      objectives.shift();
    }
  }

  // ChainEventSubscriberInterface implementation
  async holdingUpdated({channelId, amount, assetHolderAddress}: HoldingUpdatedArg): Promise<void> {
    const response = WalletResponse.initialize();

    await this.store.updateFunding(channelId, BN.from(amount), assetHolderAddress);
    await this.takeActions([channelId], response);

    response.channelUpdatedEvents().forEach(event => this.emit('channelUpdated', event.value));
  }

  async assetOutcomeUpdated({
    channelId,
    assetHolderAddress,
    externalPayouts,
  }: AssetOutcomeUpdatedArg): Promise<void> {
    const response = WalletResponse.initialize();
    await Promise.all(
      externalPayouts.map(payout =>
        this.store.updateTransferredOut(
          channelId,
          assetHolderAddress,
          makeDestination(payout.destination),
          payout.amount
        )
      )
    );

    await this.takeActions([channelId], response);

    response.channelUpdatedEvents().forEach(event => this.emit('channelUpdated', event.value));
  }

  async challengeRegistered(arg: ChallengeRegisteredArg): Promise<void> {
    const response = WalletResponse.initialize();
    const {channelId, finalizesAt: finalizedAt, challengeStates} = arg;

    await this.store.insertAdjudicatorStatus(channelId, finalizedAt, challengeStates);
    await this.takeActions([arg.channelId], response);
    response.channelUpdatedEvents().forEach(event => this.emit('channelUpdated', event.value));
  }

  async channelFinalized(arg: ChannelFinalizedArg): Promise<void> {
    const response = WalletResponse.initialize();

    await this.store.markAdjudicatorStatusAsFinalized(
      arg.channelId,
      arg.blockNumber,
      arg.blockTimestamp
    );
    await this.knex.transaction(async tx => {
      const {objectiveId} = await this.store.ensureObjective(
        {
          type: 'DefundChannel',
          participants: [],
          data: {targetChannelId: arg.channelId},
        },
        tx
      );
      await this.store.approveObjective(objectiveId, tx);
    });

    await this.takeActions([arg.channelId], response);
    response.channelUpdatedEvents().forEach(event => this.emit('channelUpdated', event.value));
  }

  private async registerChannelWithChainService(channelId: string): Promise<void> {
    const channel = await this.store.getChannelState(channelId);
    const channelResult = ChannelState.toChannelResult(channel);

    const assetHolderAddresses = channelResult.allocations.map(a =>
      makeAddress(a.assetHolderAddress)
    );
    this.chainService.registerChannel(channelId, assetHolderAddresses, this);
  }

  dbAdmin(): DBAdmin {
    return new DBAdmin(this.knex);
  }

  async warmUpThreads(): Promise<void> {
    // no-op for single-threaded-wallet
  }
}

// TODO: This should be removed, and not used externally.
// It is a fill-in until the wallet API is specced out.
export function getOrThrow<E, T>(result: Either.Either<E, T>): T {
  return Either.getOrElseW<E, T>(
    (err: E): T => {
      throw err;
    }
  )(result);
}
