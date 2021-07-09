import {
  Allocation,
  ChannelResult,
  CreateChannelParams,
  Uint256,
} from '@statechannels/client-api-schema';
import _ from 'lodash';
import EventEmitter from 'eventemitter3';
import {
  calculateObjectiveId,
  makeAddress,
  makeDestination,
  Address,
} from '@statechannels/wallet-core';
import {utils} from 'ethers';
import {setIntervalAsync, clearIntervalAsync} from 'set-interval-async/dynamic';
import P from 'pino';

import {
  MessageHandler,
  MessageServiceFactory,
  MessageServiceInterface,
} from '../message-service/types';
import {getMessages} from '../message-service/utils';
import {
  defaultConfig,
  Engine,
  extractDBConfigFromWalletConfig,
  hasNewObjective,
  EngineConfig,
  IncomingWalletConfig,
  isMultipleChannelOutput,
  MultipleChannelOutput,
  SingleChannelOutput,
  validateEngineConfig,
  SyncConfiguration,
} from '../engine';
import {
  AllocationUpdatedArg,
  ChainEventSubscriberInterface,
  ChainService,
  ChainServiceInterface,
  ChallengeRegisteredArg,
  ChannelFinalizedArg,
  HoldingUpdatedArg,
  MockChainService,
} from '../chain-service';
import * as ChannelState from '../protocols/state';
import {createLogger} from '../logger';
import {ConfigValidationError, SingleThreadedEngine} from '../engine/engine';

import {ObjectiveResult, WalletEvents, ObjectiveDoneResult, UpdateChannelResult} from './types';

export class Wallet extends EventEmitter<WalletEvents> {
  /**
   * Constructs a channel manager that will ensure objectives get accomplished by resending messages if needed.
   * @param incomingConfig The configuration object that specifies various options.
   * @param messageServiceFactory  A function that returns a message service when passed in a handler.
   * @returns A channel manager.
   */
  public static async create(
    incomingConfig: IncomingWalletConfig,
    messageServiceFactory: MessageServiceFactory
  ): Promise<Wallet> {
    const populatedConfig = _.assign({}, defaultConfig, incomingConfig);
    // Even though the config hasn't been validated we attempt to create a logger
    // This allows us to log out any config validation errors
    const logger = createLogger(populatedConfig);

    logger.trace({engineConfig: populatedConfig}, 'Wallet initializing');

    const {errors, valid} = validateEngineConfig(populatedConfig);

    if (!valid) {
      errors.forEach(error => logger.error({error}, `Validation error occurred ${error.message}`));
      throw new ConfigValidationError(errors);
    }
    const {skipEvmValidation, metricsConfiguration} = populatedConfig;
    const engineConfig: EngineConfig = {
      skipEvmValidation,
      dbConfig: extractDBConfigFromWalletConfig(populatedConfig),
      metrics: metricsConfiguration,
      chainNetworkID: utils.hexlify(populatedConfig.networkConfiguration.chainNetworkID),
      workerThreadAmount: 0, // Disable threading for now
    };
    const engine = await SingleThreadedEngine.create(engineConfig, logger);
    const chainService = populatedConfig.chainServiceConfiguration.attachChainService
      ? new ChainService({
          ...populatedConfig.chainServiceConfiguration,
          logger,
        })
      : new MockChainService();
    await chainService.checkChainId(populatedConfig.networkConfiguration.chainNetworkID);
    const networkId = utils.hexlify(populatedConfig.networkConfiguration.chainNetworkID);
    const wallet = new Wallet(
      messageServiceFactory,
      engine,
      chainService,
      networkId,
      logger,
      populatedConfig.syncConfiguration
    );
    await wallet.registerExistingChannelsWithChainService();
    return wallet;
  }

  private _messageService: MessageServiceInterface;

  private _syncInterval = setIntervalAsync(async () => {
    await this.syncObjectives();
  }, this._syncOptions.pollInterval);

  private _chainListener: ChainEventSubscriberInterface;

  private constructor(
    messageServiceFactory: MessageServiceFactory,
    private _engine: Engine,
    private _chainService: ChainServiceInterface,
    private _chainNetworkId: string,
    private _logger: P.Logger,
    private _syncOptions: SyncConfiguration
  ) {
    super();

    const handler: MessageHandler = async message => {
      const result = await this._engine.pushMessage(message.data);
      const {channelResults} = result;

      await this.registerChannels(channelResults);

      await this.handleEngineOutput(result);
    };

    this._messageService = messageServiceFactory(handler);

    this._chainListener = {
      holdingUpdated: this.createChainEventlistener('holdingUpdated', e =>
        this._engine.store.updateFunding(e.channelId, e.amount, e.asset)
      ),
      allocationUpdated: this.createChainEventlistener('allocationUpdated', async e => {
        const transferredOut = e.externalPayouts.map(ai => ({
          toAddress: makeDestination(ai.destination),
          amount: ai.amount as Uint256,
        }));

        await this._engine.store.updateTransferredOut(e.channelId, e.asset, transferredOut);
      }),
      challengeRegistered: this.createChainEventlistener('challengeRegistered', e =>
        this._engine.store.insertAdjudicatorStatus(e.channelId, e.finalizesAt, e.challengeStates)
      ),
      channelFinalized: this.createChainEventlistener('channelFinalized', e =>
        this._engine.store.markAdjudicatorStatusAsFinalized(
          e.channelId,
          e.blockNumber,
          e.blockTimestamp,
          e.finalizedAt
        )
      ),
    };
  }

  /**
   * Pulls and stores the ForceMoveApp definition bytecode at the supplied blockchain address.
   *
   * @remarks
   * Storing the bytecode is necessary for the engine to verify ForceMoveApp transitions.
   *
   * @param  appDefinition - An ethereum address where ForceMoveApp rules are deployed.
   * @returns A promise that resolves when the bytecode has been successfully stored.
   */
  public async registerAppDefinition(appDefinition: string): Promise<void> {
    const bytecode = await this._chainService.fetchBytecode(appDefinition);
    await this._engine.store.upsertBytecode(
      utils.hexlify(this._chainNetworkId),
      makeAddress(appDefinition),
      bytecode
    );
  }

  /**
   * Approves an objective that has been proposed by another participant.
   * Once the objective has been approved progress can be made to completing the objective.
   * @remarks
   * This is used to "join" channels by approving a CreateChannel Objective.
   * @param objectiveIds The ids of the objective you want to approve.
   * @returns A promise that resolves to a collection of ObjectiveResult.
   */
  public async approveObjectives(objectiveIds: string[]): Promise<ObjectiveResult[]> {
    const {objectives, messages, chainRequests} = await this._engine.approveObjectives(
      objectiveIds
    );

    const results = objectives.map(async o => ({
      objectiveId: o.objectiveId,
      currentStatus: o.status,
      channelId: o.data.targetChannelId,
      done: this.createObjectiveDoneResult(o.objectiveId),
    }));

    // TODO: ApproveObjective should probably just return a MultipleChannelOuput
    const completedObjectives = objectives.filter(o => o.status === 'succeeded');
    completedObjectives.forEach(o => this.emit('ObjectiveCompleted', o));
    await this._chainService.handleChainRequests(chainRequests);
    await this.messageService.send(messages);

    return Promise.all(results);
  }

  /**
   Creates channels using the given parameters.
   * @param channelParameters The parameters to use for channel creation. A channel will be created for each entry in the array.
   * @returns A promise that resolves to a collection of ObjectiveResult.
   */
  public async createChannels(
    channelParameters: CreateChannelParams[]
  ): Promise<ObjectiveResult[]> {
    return Promise.all(
      channelParameters.map(async p => {
        try {
          const createResult = await this._engine.createChannel(p);

          await this.registerChannels([createResult.channelResult]);

          const {newObjective, channelResult} = createResult;
          const done = this.createObjectiveDoneResult(newObjective.objectiveId);
          await this.handleEngineOutput(createResult);
          return {
            channelId: channelResult.channelId,
            currentStatus: newObjective.status,
            objectiveId: newObjective.objectiveId,
            done,
          };
        } catch (error) {
          this._logger.error({err: error}, 'Uncaught InternalError in CreateChannel');
          // TODO: This is slightly hacky but it's less painful then having to narrow the type down every time
          // you get a result back from the createChannels method
          // This should be looked at in https://github.com/statechannels/statechannels/issues/3461
          return {
            channelId: 'ERROR',
            currentStatus: 'failed' as const,
            objectiveId: 'ERROR',
            done: Promise.resolve({type: 'InternalError' as const, error}),
          };
        }
      })
    );
  }

  /**
   * Updates a channel with the given allocations and app data.
   * @param channelId The id of the channel to update.
   * @param allocations The updated allocations for the channel.
   * @param appData The updated appData for the channel.
   * @returns A promise that resolves to either a sucess result (which includes the updated channel) or
   * an error type that contains more information about the error.
   */
  public async updateChannel(
    channelId: string,
    allocations: Allocation[],
    appData: string
  ): Promise<UpdateChannelResult> {
    try {
      const updateResponse = await this._engine.updateChannel({channelId, allocations, appData});
      await this.handleEngineOutput(updateResponse);
      return {type: 'Success', channelId, result: updateResponse.channelResult};
    } catch (error) {
      return {type: 'InternalError', error, channelId};
    }
  }

  private async syncObjectives() {
    const staleDate = Date.now() - this._syncOptions.staleThreshold;
    const timeOutDate = Date.now() - this._syncOptions.timeOutThreshold;
    const objectives = await this._engine.store.getApprovedObjectives();
    const timedOutObjectives = objectives.filter(o => o.progressLastMadeAt.getTime() < timeOutDate);

    for (const o of timedOutObjectives) {
      this.emit('ObjectiveTimedOut', o);
    }

    const staleObjectives = objectives
      .filter(o => o.progressLastMadeAt.getTime() < staleDate)
      .map(o => o.objectiveId);

    const syncMessages = await this._engine.syncObjectives(staleObjectives);
    await this._messageService.send(syncMessages);
  }

  /**
   Closes the specified channels
   * @param channelIds The ids of the channels to close.
   * @returns A promise that resolves to a collection of ObjectiveResult.
   */
  public async closeChannels(channelIds: string[]): Promise<ObjectiveResult[]> {
    return Promise.all(
      channelIds.map(async channelId => {
        const objectiveId = calculateObjectiveId('CloseChannel', channelId);
        const done = this.createObjectiveDoneResult(objectiveId);
        const closeResult = await this._engine.closeChannel({channelId});
        const {newObjective, channelResult} = closeResult;
        // create the promise before we send anything out

        // TODO: We just refetch to get the latest status
        // Long term we should make sure the engine returns the latest objectives
        const latest = await this._engine.getObjective(newObjective.objectiveId);

        await this.handleEngineOutput(closeResult);

        return {
          channelId: channelResult.channelId,
          currentStatus: latest.status,
          objectiveId: newObjective.objectiveId,
          done,
        };
      })
    );
  }

  /**
   * Finds any approved objectives and attempts to make progress on them.
   * This is useful for restarting progress after a restart or crash.
   * @returns A collection of ObjectiveResults. There will be an ObjectiveResult for each approved objective found.
   */
  public async jumpStartObjectives(): Promise<ObjectiveResult[]> {
    const objectives = await this._engine.getApprovedObjectives();
    const objectiveIds = objectives.map(o => o.objectiveId);
    await this._engine.store.updateObjectiveProgressDate(objectiveIds);

    const syncMessages = await this._engine.syncObjectives(objectiveIds);

    const results = objectives.map(async o => {
      const done = this.createObjectiveDoneResult(o.objectiveId);
      return {
        objectiveId: o.objectiveId,
        currentStatus: o.status,
        channelId: o.data.targetChannelId,
        done,
      };
    });

    await this.messageService.send(syncMessages);
    return Promise.all(results);
  }

  private emitObjectiveEvents(result: MultipleChannelOutput | SingleChannelOutput): void {
    if (isMultipleChannelOutput(result)) {
      // Receiving messages from other participants may have resulted in completed objectives
      for (const o of result.completedObjectives) {
        this.emit('ObjectiveCompleted', o);
      }

      // Receiving messages from other participants may have resulted in new proposed objectives
      for (const o of result.newObjectives) {
        if (o.status === 'pending') {
          this.emit('ObjectiveProposed', o);
        }
      }
    } else {
      if (hasNewObjective(result)) {
        if (result.newObjective.status === 'pending') {
          this.emit('ObjectiveProposed', result.newObjective);
        }
      }
    }
  }

  /**
   * Emits events, sends messages and requests transactions based on the output of the engine.
   * @param output
   */
  private async handleEngineOutput(
    output: MultipleChannelOutput | SingleChannelOutput
  ): Promise<void> {
    this.emitObjectiveEvents(output);
    await this._messageService.send(getMessages(output));
    await this._chainService.handleChainRequests(output.chainRequests);
  }

  public get messageService(): MessageServiceInterface {
    return this._messageService;
  }

  private async createObjectiveDoneResult(objectiveId: string): Promise<ObjectiveDoneResult> {
    return new Promise<ObjectiveDoneResult>(resolve => {
      this.on('ObjectiveTimedOut', o => {
        if (o.objectiveId === objectiveId) {
          this._logger.trace({objective: o}, 'Objective Timed out');

          resolve({
            type: 'ObjectiveTimedOutError',
            objectiveId: o.objectiveId,
            lastProgressMadeAt: o.progressLastMadeAt,
          });
        }
      });
      this.on('ObjectiveCompleted', o => {
        if (o.objectiveId === objectiveId) {
          this._logger.trace({objective: o}, 'Objective Suceeded');
          resolve({type: 'Success', channelId: o.data.targetChannelId});
        }
      });
    });
  }

  /**
   * Registers any channels existing in the database with the chain service.
   *
   * @remarks
   * Enables the chain service to alert the engine of of any blockchain events for existing channels.
   *
   * @returns A promise that resolves when the channels have been successfully registered.
   */
  private async registerExistingChannelsWithChainService(): Promise<void> {
    const channelsToRegister = (await this._engine.store.getNonFinalizedChannels()).map(
      ChannelState.toChannelResult
    );
    await this.registerChannels(channelsToRegister);
  }

  private async registerChannels(channelsToRegister: ChannelResult[]): Promise<void> {
    const channelsWithAssetHolders = channelsToRegister.map(cr => ({
      assetHolderAddresses: cr.allocations.map(a => makeAddress(a.asset)),
      channelId: cr.channelId,
    }));

    for (const {channelId, assetHolderAddresses} of channelsWithAssetHolders) {
      this._chainService.registerChannel(channelId, assetHolderAddresses, this._chainListener);
    }
  }

  private createChainEventlistener<
    K extends keyof ChainEventSubscriberInterface,
    EH extends ChainEventSubscriberInterface[K]
  >(eventName: K, storeUpdater: EH) {
    return async (
      event: HoldingUpdatedArg & AllocationUpdatedArg & ChannelFinalizedArg & ChallengeRegisteredArg
    ) => {
      const {channelId} = event;
      this._logger.trace({event}, `${eventName} being handled`);
      try {
        await storeUpdater(event);
        const result = await this._engine.crank([channelId]);
        await this.handleEngineOutput(result);
      } catch (err) {
        this._logger.error({err, event}, `Error handling ${eventName}`);
        throw err;
      }
    };
  }

  public async getSigningAddress(): Promise<Address> {
    return this._engine.getSigningAddress();
  }

  public async getChannels(): Promise<ChannelResult[]> {
    const {channelResults} = await this._engine.getChannels();
    return channelResults;
  }

  /**
   * Registers a peer with the message service so messages can be sent to the peer.
   * @param peerUrl The endpoint for the peer.
   */
  public async registerPeerMessageService(peerUrl: string): Promise<void> {
    await this.messageService.registerPeer(peerUrl);
  }

  async destroy(): Promise<void> {
    await clearIntervalAsync(this._syncInterval);
    this._chainService.destructor();
    await this._messageService.destroy();
    await this._engine.destroy();
  }
}
