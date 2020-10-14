import {
  UpdateChannelParams,
  CreateChannelParams,
  SyncChannelParams,
  StateChannelsNotification,
  JoinChannelParams,
  CloseChannelParams,
  ChannelResult,
  GetStateParams,
  Address,
  ChannelId,
} from '@statechannels/client-api-schema';
import {
  deserializeAllocations,
  validatePayload,
  ChannelRequest,
  Outcome,
  convertToParticipant,
  Participant,
  assetHolderAddress,
  BN,
  Zero,
  serializeMessage,
  ChannelConstants,
  Payload,
} from '@statechannels/wallet-core';
import * as Either from 'fp-ts/lib/Either';
import Knex from 'knex';
import _ from 'lodash';

import {Bytes32, Uint256} from '../type-aliases';
import {Outgoing, ProtocolAction, isOutgoing} from '../protocols/actions';
import {logger} from '../logger';
import * as OpenChannelProtocol from '../protocols/open-channel';
import * as CloseChannelProtocol from '../protocols/close-channel';
import * as UpdateChannel from '../handlers/update-channel';
import * as CloseChannel from '../handlers/close-channel';
import * as JoinChannel from '../handlers/join-channel';
import * as ChannelState from '../protocols/state';
import {isWalletError} from '../errors/wallet-error';
import {timerFactory, recordFunctionMetrics, setupMetrics} from '../metrics';
import {WorkerManager} from '../utilities/workers/manager';
import {mergeChannelResults, mergeOutgoing} from '../utilities/messaging';
import {ServerWalletConfig, extractDBConfigFromServerWalletConfig, defaultConfig} from '../config';
import {
  ChainServiceInterface,
  MockChainService,
  ChainEventSubscriberInterface,
  HoldingUpdatedArg,
  AssetTransferredArg,
} from '../chain-service';
import {DBAdmin} from '../db-admin/db-admin';

import {Store, AppHandler, MissingAppHandler} from './store';

// TODO: The client-api does not currently allow for outgoing messages to be
// declared as the result of a wallet API call.
// Nor does it allow for multiple channel results
export type SingleChannelOutput = {outbox: Outgoing[]; channelResult: ChannelResult};
export type MultipleChannelOutput = {outbox: Outgoing[]; channelResults: ChannelResult[]};
type Message = SingleChannelOutput | MultipleChannelOutput;
const isSingleChannelMessage = (message: Message): message is SingleChannelOutput =>
  'channelResult' in message;

export interface UpdateChannelFundingParams {
  channelId: ChannelId;
  token?: Address;
  amount: Uint256;
}

export type WalletInterface = {
  // App utilities
  getParticipant(): Promise<Participant | undefined>;

  // App channel management
  createChannels(
    args: CreateChannelParams,
    amountOfChannels: number
  ): Promise<MultipleChannelOutput>;

  joinChannels(channelIds: ChannelId[]): Promise<MultipleChannelOutput>;
  updateChannel(args: UpdateChannelParams): Promise<SingleChannelOutput>;
  closeChannel(args: CloseChannelParams): Promise<SingleChannelOutput>;
  getChannels(): Promise<MultipleChannelOutput>;
  getState(args: GetStateParams): Promise<SingleChannelOutput>;
  syncChannel(args: SyncChannelParams): Promise<SingleChannelOutput>;

  updateFundingForChannels(args: UpdateChannelFundingParams[]): Promise<MultipleChannelOutput>;
  // Wallet <-> Wallet communication
  pushMessage(m: unknown): Promise<MultipleChannelOutput>;

  // Wallet -> App communication
  onNotification(cb: (notice: StateChannelsNotification) => void): {unsubscribe: () => void};

  mergeMessages(messages: Message[]): MultipleChannelOutput;
};

export class Wallet implements WalletInterface, ChainEventSubscriberInterface {
  manager: WorkerManager;
  knex: Knex;
  store: Store;
  chainService: ChainServiceInterface;
  readonly walletConfig: ServerWalletConfig;
  constructor(walletConfig?: ServerWalletConfig) {
    this.walletConfig = walletConfig || defaultConfig;
    this.manager = new WorkerManager(this.walletConfig);
    this.knex = Knex(extractDBConfigFromServerWalletConfig(this.walletConfig));
    this.store = new Store(
      this.knex,
      this.walletConfig.timingMetrics,
      this.walletConfig.skipEvmValidation
    );

    // Bind methods to class instance
    this.getParticipant = this.getParticipant.bind(this);
    this.updateChannelFunding = this.updateChannelFunding.bind(this);
    this.updateFundingForChannels = this.updateFundingForChannels.bind(this);
    this.getSigningAddress = this.getSigningAddress.bind(this);

    this.createChannels = this.createChannels.bind(this);
    this.createChannelInternal = this.createChannelInternal.bind(this);

    this.joinChannels = this.joinChannels.bind(this);
    this.updateChannel = this.updateChannel.bind(this);
    this.updateChannelInternal = this.updateChannelInternal.bind(this);
    this.pushMessageInternal = this.pushMessageInternal.bind(this);
    this.closeChannel = this.closeChannel.bind(this);
    this.getChannels = this.getChannels.bind(this);
    this.getState = this.getState.bind(this);
    this.pushMessage = this.pushMessage.bind(this);
    this.takeActions = this.takeActions.bind(this);
    this.mergeMessages = this.mergeMessages.bind(this);
    this.destroy = this.destroy.bind(this);

    // set up timing metrics
    if (this.walletConfig.timingMetrics) {
      if (!this.walletConfig.metricsOutputFile) {
        throw Error('You must define a metrics output file');
      }
      setupMetrics(this.walletConfig.metricsOutputFile);
    }

    this.chainService = new MockChainService();
  }

  public mergeMessages(messages: Message[]): MultipleChannelOutput {
    const channelResults = mergeChannelResults(
      messages
        .map(m => (isSingleChannelMessage(m) ? [m.channelResult] : m.channelResults))
        .reduce((cr1, cr2) => cr1.concat(cr2))
    );

    const outbox = mergeOutgoing(messages.map(m => m.outbox).reduce((m1, m2) => m1.concat(m2)));
    return {channelResults, outbox};
  }

  public async destroy(): Promise<void> {
    await this.manager.destroy();
    await this.store.destroy(); // TODO this destroys this.knex(), which seems quite unexpected
  }

  public async syncChannel({channelId}: SyncChannelParams): Promise<SingleChannelOutput> {
    const {states, channelState} = await this.store.getStates(channelId);

    const {participants, myIndex} = channelState;

    return {
      outbox: createOutboxFor(channelId, myIndex, participants, {
        signedStates: states,
        requests: [{type: 'GetChannel', channelId}],
      }),
      channelResult: ChannelState.toChannelResult(channelState),
    };
  }

  public async getParticipant(): Promise<Participant | undefined> {
    let participant: Participant | undefined = undefined;

    try {
      participant = await this.store.getFirstParticipant();
    } catch (e) {
      if (isWalletError(e)) logger.error('Wallet failed to get a participant', e);
      else throw e;
    }

    return participant;
  }

  public async updateFundingForChannels(
    args: UpdateChannelFundingParams[]
  ): Promise<MultipleChannelOutput> {
    const results = await Promise.all(args.map(a => this.updateChannelFunding(a)));

    const channelResults = results.map(r => r.channelResult);
    const outgoing = results.map(r => r.outbox).reduce((p, c) => p.concat(c));

    return {
      channelResults: mergeChannelResults(channelResults),
      outbox: mergeOutgoing(outgoing),
    };
  }
  async updateChannelFunding({
    channelId,
    token,
    amount,
  }: UpdateChannelFundingParams): Promise<SingleChannelOutput> {
    const assetHolder = assetHolderAddress(token || Zero);

    await this.store.updateFunding(channelId, BN.from(amount), assetHolder);

    const {channelResults, outbox} = await this.takeActions([channelId]);

    return {outbox, channelResult: channelResults[0]};
  }

  public async getSigningAddress(): Promise<string> {
    return await this.store.getOrCreateSigningAddress();
  }

  async createChannel(args: CreateChannelParams): Promise<MultipleChannelOutput> {
    return this.createChannels(args, 1);
  }
  async createChannels(
    args: CreateChannelParams,
    amountOfChannels: number
  ): Promise<MultipleChannelOutput> {
    const {participants, appDefinition, appData, allocations, fundingStrategy} = args;
    const outcome: Outcome = deserializeAllocations(allocations);
    const results = await Promise.all(
      _.range(amountOfChannels).map(async () => {
        const channelNonce = await this.store.nextNonce(participants.map(p => p.signingAddress));
        const constants: ChannelConstants = {
          channelNonce,
          participants: participants.map(convertToParticipant),
          chainId: '0x01',
          challengeDuration: 9001,
          appDefinition,
        };
        return this.store.createChannel(constants, appData, outcome, fundingStrategy);
      })
    );
    const channelResults = results.map(r => r.channelResult);
    const outgoing = results.map(r => r.outgoing).reduce((p, c) => p.concat(c));
    return {
      channelResults: mergeChannelResults(channelResults),
      outbox: mergeOutgoing(outgoing.map(n => n.notice)),
    };
  }

  async createChannelInternal(
    args: CreateChannelParams,
    channelNonce: number
  ): Promise<SingleChannelOutput> {
    const {participants, appDefinition, appData, allocations, fundingStrategy} = args;
    const outcome: Outcome = deserializeAllocations(allocations);

    const constants: ChannelConstants = {
      channelNonce,
      participants: participants.map(convertToParticipant),
      chainId: '0x01',
      challengeDuration: 9001,
      appDefinition,
    };

    const {outgoing, channelResult} = await this.store.createChannel(
      constants,
      appData,
      outcome,
      fundingStrategy
    );
    return {outbox: mergeOutgoing(outgoing.map(n => n.notice)), channelResult};
  }

  async joinChannels(channelIds: ChannelId[]): Promise<MultipleChannelOutput> {
    const results = await Promise.all(channelIds.map(channelId => this.joinChannel({channelId})));

    const channelResults = results.map(r => r.channelResult);
    const outgoing = results.map(r => r.outbox).reduce((p, c) => p.concat(c));

    return {
      channelResults: mergeChannelResults(channelResults),
      outbox: mergeOutgoing(outgoing),
    };
  }

  async joinChannel({channelId}: JoinChannelParams): Promise<SingleChannelOutput> {
    const criticalCode: AppHandler<Promise<SingleChannelOutput>> = async (tx, channel) => {
      const {myIndex, participants} = channel;

      const nextState = getOrThrow(JoinChannel.joinChannel({channelId}, channel));
      const signedState = await this.store.signState(channelId, nextState, tx);

      return {
        outbox: createOutboxFor(channelId, myIndex, participants, {signedStates: [signedState]}),
        channelResult: ChannelState.toChannelResult(await this.store.getChannel(channelId, tx)),
      };
    };

    const handleMissingChannel: MissingAppHandler<Promise<SingleChannelOutput>> = () => {
      throw new JoinChannel.JoinChannelError(JoinChannel.JoinChannelError.reasons.channelNotFound, {
        channelId,
      });
    };

    // FIXME: This is just to get existing joinChannel API pattern to keep working
    /* eslint-disable-next-line */
    const {objectiveId} = _.find(
      this.store.objectives,
      o => o.type === 'OpenChannel' && o.data.targetChannelId === channelId
    )!;
    this.store.objectives[objectiveId].status = 'approved';
    // END FIXME

    const {outbox, channelResult} = await this.store.lockApp(
      channelId,
      criticalCode,
      handleMissingChannel
    );
    const {outbox: nextOutbox, channelResults} = await this.takeActions([channelId]);
    const nextChannelResult = channelResults.find(c => c.channelId === channelId) || channelResult;

    return {
      outbox: mergeOutgoing(outbox.concat(nextOutbox)),
      channelResult: nextChannelResult,
    };
  }

  async updateChannel(args: UpdateChannelParams): Promise<SingleChannelOutput> {
    if (this.walletConfig.workerThreadAmount > 0) {
      return this.manager.updateChannel(args);
    } else {
      return this.updateChannelInternal(args);
    }
  }

  // The internal implementation of updateChannel responsible for actually updating the channel
  async updateChannelInternal({
    channelId,
    allocations,
    appData,
  }: UpdateChannelParams): Promise<SingleChannelOutput> {
    const timer = timerFactory(this.walletConfig.timingMetrics, `updateChannel ${channelId}`);
    const handleMissingChannel: MissingAppHandler<Promise<SingleChannelOutput>> = () => {
      throw new UpdateChannel.UpdateChannelError(
        UpdateChannel.UpdateChannelError.reasons.channelNotFound,
        {channelId}
      );
    };
    const criticalCode: AppHandler<Promise<SingleChannelOutput>> = async (tx, channel) => {
      const {myIndex, participants} = channel;

      const outcome = recordFunctionMetrics(
        deserializeAllocations(allocations),
        this.walletConfig.timingMetrics
      );

      const nextState = getOrThrow(
        recordFunctionMetrics(
          UpdateChannel.updateChannel({channelId, appData, outcome}, channel),
          this.walletConfig.timingMetrics
        )
      );
      const signedState = await timer('signing state', () =>
        this.store.signState(channelId, nextState, tx)
      );

      return {
        outbox: createOutboxFor(channelId, myIndex, participants, {signedStates: [signedState]}),
        channelResult: ChannelState.toChannelResult(await this.store.getChannel(channelId, tx)),
      };
    };

    return this.store.lockApp(channelId, criticalCode, handleMissingChannel);
  }

  async closeChannel({channelId}: CloseChannelParams): Promise<SingleChannelOutput> {
    const handleMissingChannel: MissingAppHandler<Promise<SingleChannelOutput>> = () => {
      throw new CloseChannel.CloseChannelError(
        CloseChannel.CloseChannelError.reasons.channelMissing,
        {channelId}
      );
    };
    const criticalCode: AppHandler<Promise<SingleChannelOutput>> = async (tx, channel) => {
      const {myIndex, participants} = channel;

      const nextState = getOrThrow(CloseChannel.closeChannel(channel));
      const signedState = await this.store.signState(channelId, nextState, tx);

      return {
        outbox: createOutboxFor(channelId, myIndex, participants, {signedStates: [signedState]}),
        channelResult: ChannelState.toChannelResult(await this.store.getChannel(channelId, tx)),
      };
    };

    await this.store.lockApp(channelId, criticalCode, handleMissingChannel);

    const {channelResults, outbox} = await this.takeActions([channelId]);

    (outbox[0].params.data as Payload).objectives = [
      {
        type: 'CloseChannel',
        data: {targetChannelId: channelId},
        participants: [],
      },
    ];

    return {outbox, channelResult: channelResults[0]};
  }

  async getChannels(): Promise<MultipleChannelOutput> {
    const channelStates = await this.store.getChannels();
    return {
      channelResults: mergeChannelResults(channelStates.map(ChannelState.toChannelResult)),
      outbox: [],
    };
  }

  async getState({channelId}: GetStateParams): Promise<SingleChannelOutput> {
    try {
      const channel = await this.store.getChannel(channelId);

      return {
        channelResult: ChannelState.toChannelResult(channel),
        outbox: [],
      };
    } catch (err) {
      logger.error({err}, 'Could not get channel');
      throw err; // FIXME: Wallet shoudl return ChannelNotFound
    }
  }

  async pushMessage(rawPayload: unknown): Promise<MultipleChannelOutput> {
    if (this.walletConfig.workerThreadAmount > 0) {
      return this.manager.pushMessage(rawPayload);
    } else {
      return this.pushMessageInternal(rawPayload);
    }
  }

  // The internal implementation of pushMessage responsible for actually pushing the message into the wallet
  async pushMessageInternal(rawPayload: unknown): Promise<MultipleChannelOutput> {
    const store = this.store;

    const wirePayload = validatePayload(rawPayload);

    // TODO: Move into utility somewhere?
    function handleRequest(outbox: Outgoing[]): (req: ChannelRequest) => Promise<void> {
      return async ({channelId}: ChannelRequest): Promise<void> => {
        const {states: signedStates, channelState} = await store.getStates(channelId);

        const {participants, myIndex} = channelState;

        createOutboxFor(channelId, myIndex, participants, {signedStates}).map(outgoing =>
          outbox.push(outgoing)
        );
      };
    }

    const {channelIds, objectives, channelResults: fromStoring} = await this.store.pushMessage(
      wirePayload
    );

    const {channelResults, outbox} = await this.takeActions(channelIds);

    for (const channel of fromStoring) {
      if (!_.some(channelResults, c => c.channelId === channel.channelId))
        channelResults.push(channel);
    }

    if (wirePayload.requests && wirePayload.requests.length > 0)
      // Modifies outbox, may append new messages
      await Promise.all(wirePayload.requests.map(handleRequest(outbox)));

    return {
      outbox: mergeOutgoing(outbox),
      channelResults: mergeChannelResults(channelResults),
      objectivesToApprove: objectives,
    };
  }

  onNotification(_cb: (notice: StateChannelsNotification) => void): {unsubscribe: () => void} {
    throw 'Unimplemented';
  }

  takeActions = async (channels: Bytes32[]): Promise<ExecutionResult> => {
    const outbox: Outgoing[] = [];
    const channelResults: ChannelResult[] = [];
    let error: Error | undefined = undefined;

    // FIXME: Only get objectives which are:
    // 1. Approved but not executed yet
    // 2. Related to one of the channels
    const objectives = Object.values(this.store.objectives).filter(
      objective =>
        // Only supports these two
        (objective.type === 'OpenChannel' || objective.type === 'CloseChannel') &&
        // Only runs on those with relevant channels
        _.includes(channels, objective.data.targetChannelId) &&
        // Only runs on pending or approved
        (objective.status === 'approved' || // Need approved b.c. next action to take
          objective.status === 'pending') /* Need pending because you want new channel result */
    );

    while (objectives.length && !error) {
      const objective = objectives[0];

      if (objective.type !== 'OpenChannel' && objective.type !== 'CloseChannel')
        throw new Error('not implememnted');

      const channel = objective.data.targetChannelId;

      await this.store.lockApp(channel, async tx => {
        // For the moment, we are only considering directly funded app channels.
        // Thus, we can directly fetch the channel record, and immediately construct the protocol state from it.
        // In the future, we can have an App model which collects all the relevant channels for an app channel,
        // and a Ledger model which stores ledger-specific data (eg. queued requests)
        const app = await this.store.getChannel(channel, tx);

        if (!app) {
          throw new Error('Channel not found');
        }

        const setError = async (e: Error): Promise<void> => {
          error = e;
          await tx.rollback(error);
        };
        const markObjectiveAsDone = (): void => {
          objectives.shift();
          channelResults.push(ChannelState.toChannelResult(app));
        };

        const doAction = async (action: ProtocolAction): Promise<any> => {
          switch (action.type) {
            case 'SignState': {
              const {myIndex, participants, channelId} = app;
              const signedState = await this.store.signState(action.channelId, action, tx);
              createOutboxFor(channelId, myIndex, participants, {
                signedStates: [signedState],
              }).map(outgoing => outbox.push(outgoing));
              return;
            }
            case 'FundChannel':
              await this.store.addChainServiceRequest(action.channelId, 'fund', tx);
              await this.chainService.fundChannel({
                ...action,
                expectedHeld: BN.from(action.expectedHeld),
                amount: BN.from(action.amount),
              });
              return;
            case 'CompleteObjective':
              this.store.objectives[objective.objectiveId].status = 'succeeded';
              markObjectiveAsDone(); // TODO: Awkward to use this for undefined and CompleteObjective
              return;
            default:
              throw 'Unimplemented';
          }
        };

        const fsm = {OpenChannel: OpenChannelProtocol, CloseChannel: CloseChannelProtocol}[
          objective.type
        ];

        const nextAction = recordFunctionMetrics(
          fsm.protocol({app}),
          this.walletConfig.timingMetrics
        );

        if (!nextAction) markObjectiveAsDone();
        else if (isOutgoing(nextAction)) {
          outbox.push(nextAction.notice);
          markObjectiveAsDone();
        } else {
          try {
            await doAction(nextAction);
          } catch (err) {
            logger.error({err}, 'Error handling action');
            await setError(err);
          }
        }
      });
    }

    return {outbox, error, channelResults};
  };

  // ChainEventSubscriberInterface implementation
  onHoldingUpdated(arg: HoldingUpdatedArg): void {
    // note: updateChannelFunding is an async function.
    // todo: this returns a Promise<Promise<SingleChannelOutput>>. How should the Promise<SingleChannelOutput> get relayed to the application?
    this.updateChannelFunding({
      ...arg,
      token: arg.assetHolderAddress,
    });
  }

  dbAdmin(): DBAdmin {
    return new DBAdmin(this.knex);
  }

  onAssetTransferred(_arg: AssetTransferredArg): void {
    // todo: implement me
  }
}

type ExecutionResult = {
  outbox: Outgoing[];
  channelResults: ChannelResult[];
  error?: any;
};

// TODO: This should be removed, and not used externally.
// It is a fill-in until the wallet API is specced out.
export function getOrThrow<E, T>(result: Either.Either<E, T>): T {
  return Either.getOrElseW<E, T>(
    (err: E): T => {
      throw err;
    }
  )(result);
}

const createOutboxFor = (
  channelId: Bytes32,
  myIndex: number,
  participants: Participant[],
  data: Payload
): Outgoing[] =>
  participants
    .filter((_p, i: number): boolean => i !== myIndex)
    .map(({participantId: recipient}) => ({
      method: 'MessageQueued' as const,
      params: serializeMessage(data, recipient, participants[myIndex].participantId, channelId),
    }));
