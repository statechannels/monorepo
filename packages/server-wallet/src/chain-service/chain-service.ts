import {
  ContractArtifacts,
  TestContractArtifacts,
  createERC20DepositTransaction,
  createETHDepositTransaction,
  getChallengeRegisteredEvent,
  getChannelId,
  Transactions,
} from '@statechannels/nitro-protocol';
import {
  Address,
  BN,
  fromNitroSignedState,
  makeAddress,
  PrivateKey,
  SignedState,
  State,
  toNitroSignedState,
  toNitroState,
  unreachable,
} from '@statechannels/wallet-core';
import {constants, Contract, Event, providers, Wallet} from 'ethers';
import {NonceManager} from '@ethersproject/experimental';
import PQueue from 'p-queue';
import {Logger} from 'pino';
import _ from 'lodash';
const MAGIC_ADDRESS_INDICATING_ETH = constants.AddressZero;
import {computeNewOutcome} from '@statechannels/nitro-protocol/src/contract/multi-asset-holder';

import {Bytes32} from '../type-aliases';
import {createLogger} from '../logger';
import {defaultTestWalletConfig} from '../config';

import {
  AllowanceMode,
  AllocationUpdatedArg,
  ChainEventSubscriberInterface,
  ChainRequest,
  ChainServiceArgs,
  ChainServiceInterface,
  FundChannelArg,
  HoldingUpdatedArg,
} from './types';
import {EventTracker} from './event-tracker';

const Deposited = 'Deposited' as const;
const AllocationUpdated = 'AllocationUpdated' as const;
const ChallengeRegistered = 'ChallengeRegistered' as const;
const Concluded = 'Concluded' as const;
type DepositedEvent = {type: 'Deposited'; ethersEvent: Event} & HoldingUpdatedArg;
type AllocationUpdatedEvent = {
  type: typeof AllocationUpdated;
  ethersEvent: Event;
} & AllocationUpdatedArg;

/* eslint-disable no-process-env, */
const nitroAdjudicatorAddress = makeAddress(
  process.env.NITRO_ADJUDICATOR_ADDRESS || constants.AddressZero
);
export class ChainService implements ChainServiceInterface {
  private logger: Logger;
  private readonly ethWallet: NonceManager;
  private provider: providers.JsonRpcProvider;
  private allowanceMode: AllowanceMode;
  private channelToEventTrackers: Map<Bytes32, EventTracker[]> = new Map();
  // For convenience, can also use addressToContract map
  private nitroAdjudicator: Contract;

  private readonly blockConfirmations: number;
  private transactionQueue = new PQueue({concurrency: 1});

  private finalizingChannels: {finalizesAtS: number; channelId: Bytes32}[] = [];

  constructor({
    provider,
    pk, // TODO require pk to be defined and remove if (!pk) throw (below)
    pollingInterval,
    logger,
    blockConfirmations,
    allowanceMode,
  }: Partial<ChainServiceArgs>) {
    if (!pk) throw new Error('ChainService: Private key not provided');
    this.provider = new providers.JsonRpcProvider(provider);
    this.ethWallet = new NonceManager(new Wallet(pk, this.provider));
    this.blockConfirmations = blockConfirmations ?? 5;
    this.logger = logger
      ? logger.child({module: 'ChainService'})
      : createLogger(defaultTestWalletConfig());

    this.allowanceMode = allowanceMode || 'MaxUint';
    if (provider && (provider.includes('0.0.0.0') || provider.includes('localhost'))) {
      pollingInterval = pollingInterval ?? 50;
    }
    if (pollingInterval) this.provider.pollingInterval = pollingInterval;

    this.nitroAdjudicator = new Contract(
      nitroAdjudicatorAddress,
      ContractArtifacts.NitroAdjudicatorArtifact.abi,
      this.ethWallet
    );

    this.nitroAdjudicator.on(ChallengeRegistered, (...args) => {
      const event = getChallengeRegisteredEvent(args);
      this.addFinalizingChannel({channelId: event.channelId, finalizesAtS: event.finalizesAt});

      const {channelId, challengeStates, finalizesAt} = event;

      this.channelToEventTrackers.get(event.channelId)?.map(subscriber =>
        subscriber.challengeRegistered({
          channelId,
          challengeStates: challengeStates.map(s => fromNitroSignedState(s)),
          finalizesAt,
        })
      );
    });

    this.nitroAdjudicator.on(Concluded, (channelId, finalizesAtS) => {
      this.addFinalizingChannel({channelId, finalizesAtS});
    });

    // this sets up listeners for the "asset holding part" of the nitro adjudicator
    this.listenForAssetEvents(this.nitroAdjudicator);

    this.provider.on('block', async (blockTag: providers.BlockTag) =>
      this.checkFinalizingChannels(await this.provider.getBlock(blockTag))
    );
  }

  /**
   * Create and send transactions for the chain requests.
   * @param chainRequests A collection of chain requests
   * @returns A collection of transaction responses for the submitted chain requests.
   */
  public async handleChainRequests(
    chainRequests: ChainRequest[]
  ): Promise<providers.TransactionResponse[]> {
    // Bail early so we don't add chatter to the logs
    if (chainRequests.length === 0) {
      return [];
    }
    const responses: providers.TransactionResponse[] = [];

    this.logger.trace({chainRequests}, 'Handling chain requests');
    for (const chainRequest of chainRequests) {
      let response;
      switch (chainRequest.type) {
        case 'Challenge':
          response = await this.challenge(chainRequest.challengeStates, chainRequest.privateKey);

          break;
        case 'ConcludeAndWithdraw':
          response = await this.concludeAndWithdraw(chainRequest.finalizationProof);
          break;
        case 'FundChannel':
          response = await this.fundChannel(chainRequest);
          break;
        case 'Withdraw':
          response = await this.withdraw(chainRequest.state, chainRequest.challengerAddress);

          break;
        default:
          unreachable(chainRequest);
      }

      responses.push(response);
    }
    return responses;
  }

  public async checkChainId(networkChainId: number): Promise<void> {
    const rpcChainId = (await this.provider.getNetwork()).chainId;
    if (rpcChainId !== networkChainId)
      throw Error(
        `ChainId mismatch: ${networkChainId} is required but provider reports ${rpcChainId}`
      );
  }

  // Only used for unit tests
  destructor(): void {
    this.logger.trace('Starting destroy');
    this.channelToEventTrackers.clear();
    this.provider.polling = false;
    this.provider.removeAllListeners();
    this.nitroAdjudicator.removeAllListeners();
    this.logger.trace('Completed destroy');
  }

  private async sendTransaction(
    transactionRequest: providers.TransactionRequest
  ): Promise<providers.TransactionResponse> {
    return this.transactionQueue.add(async () => {
      try {
        this.logger.debug({...transactionRequest}, 'Submitting transaction to the blockchain');
        return await this.ethWallet.sendTransaction(transactionRequest);
      } catch (err) {
        // https://github.com/ethers-io/ethers.js/issues/972
        this.ethWallet.incrementTransactionCount(-1);
        this.logger.error({err}, 'Transaction submission failed');
        throw err;
      }
    });
  }

  async fundChannel(arg: FundChannelArg): Promise<providers.TransactionResponse> {
    this.logger.info({...arg}, 'fundChannel: entry');

    let depositRequest;

    if (arg.asset === MAGIC_ADDRESS_INDICATING_ETH) {
      depositRequest = {
        to: this.nitroAdjudicator.address,
        value: arg.amount,
        ...createETHDepositTransaction(arg.channelId, arg.expectedHeld, arg.amount),
      };
    } else {
      await this.increaseAllowance(arg.asset, arg.amount);
      depositRequest = {
        to: this.nitroAdjudicator.address,
        ...createERC20DepositTransaction(arg.asset, arg.channelId, arg.expectedHeld, arg.amount),
      };
    }

    const tx = await this.sendTransaction(depositRequest);

    this.logger.info(
      {
        channelId: arg.channelId,
        nitroAdjudicatorAddress: this.nitroAdjudicator.address,
        tx: tx.hash,
      },
      'Finished funding channel'
    );

    return tx;
  }

  async concludeAndWithdraw(
    finalizationProof: SignedState[]
  ): Promise<providers.TransactionResponse> {
    if (!finalizationProof.length)
      throw new Error('ChainService: concludeAndWithdraw was called with an empty array?');

    const channelId = getChannelId({
      ...finalizationProof[0],
      participants: finalizationProof[0].participants.map(p => p.signingAddress),
    });

    this.logger.info({channelId}, 'concludeAndWithdraw: entry');

    const transactionRequest = {
      ...Transactions.createConcludeAndTransferAllAssetsTransaction(
        finalizationProof.flatMap(toNitroSignedState)
      ),
      to: this.nitroAdjudicator.address,
    };

    const captureExpectedErrors = async (reason: any) => {
      if (reason.error?.message.includes('Channel finalized')) {
        this.logger.warn(
          {channelId, determinedBy: 'Revert reason'},
          'Transaction to conclude channel failed: channel is already finalized'
        );
        throw new Error('Conclude failed');
      }

      const [, finalizesAt] = await this.nitroAdjudicator.unpackStatus(channelId);

      const {timestamp: latestBlockTimestamp} = await this.provider.getBlock(
        this.provider.getBlockNumber()
      );

      // Check if the channel has been finalized in the past
      if (latestBlockTimestamp >= Number(finalizesAt)) {
        this.logger.warn(
          {channelId, determinedBy: 'Javascript check'},
          'Transaction to conclude channel failed: channel is already finalized'
        );
        throw new Error('Conclude failed');
      }

      throw reason;
    };

    const transactionResponse = this.sendTransaction(transactionRequest).catch(
      captureExpectedErrors
    );

    transactionResponse
      .then(receipt => {
        if (receipt) return receipt.wait();
        return;
      })
      .catch(captureExpectedErrors);

    return transactionResponse;
  }

  async challenge(
    challengeStates: SignedState[],
    privateKey: PrivateKey
  ): Promise<providers.TransactionResponse> {
    this.logger.info({challengeStates}, 'challenge: entry');
    if (!challengeStates.length) {
      throw new Error('Must challenge with at least one state');
    }

    const challengeTransactionRequest = {
      ...Transactions.createChallengeTransaction(
        challengeStates.flatMap(toNitroSignedState),
        privateKey
      ),
      to: this.nitroAdjudicator.address,
    };
    return this.sendTransaction(challengeTransactionRequest);
  }

  async withdraw(state: State, challengerAddress: Address): Promise<providers.TransactionResponse> {
    this.logger.info('withdraw: entry');
    const lastState = toNitroState(state);

    const transactionRequest = {
      ...Transactions.createTransferAllAssetsTransaction(lastState, challengerAddress),
      to: this.nitroAdjudicator.address,
    };
    return this.sendTransaction(transactionRequest);
  }

  // TODO add another public method for transferring from an channel that has already been concluded *and* pushed
  // i.e. one that calls NitroAdjudicator.transfer. We could call the new method "withdraw" to match the other methods in this class
  // The new method will uses the latest outcome that we know exists ON CHAIN, which can be "newer" than the latest OFF CHAIN outcome.
  // Choices:
  // - the chain service stores the latest outcome in it's own DB table
  // - the wallet.store stores them
  // - nothing is stored, and the chain service searches through historic transaction data that it pulls from the provider (seems riskier, but we may need to do this in case we are offline for a time, anyway)

  registerChannel(
    channelId: Bytes32,
    assets: Address[],
    subscriber: ChainEventSubscriberInterface
  ): void {
    this.logger.info({channelId}, 'registerChannel: entry');

    const eventTracker = new EventTracker(subscriber, this.logger);
    this.channelToEventTrackers.set(channelId, [
      ...(this.channelToEventTrackers.get(channelId) ?? []),
      eventTracker,
    ]);

    // Fetch the current contract holding, and emit as an event
    for (const asset of assets) {
      this.getInitialHoldings(asset, channelId, eventTracker);
    }

    // This method is async so it will continue to run after the method has been exited
    // That's ok since we're just registering some things and/or dispatching some events
    this.registerFinalizationStatus(channelId);
  }

  unregisterChannel(channelId: Bytes32): void {
    this.logger.info({channelId}, 'unregisterChannel: entry');
    this.channelToEventTrackers.set(channelId, []);
  }

  private async checkFinalizingChannels(block: providers.Block): Promise<void> {
    const finalizingChannel = this.finalizingChannels.shift();
    if (!finalizingChannel) return;
    if (finalizingChannel.finalizesAtS > block.timestamp) {
      this.addFinalizingChannel(finalizingChannel);
      return;
    }
    const {channelId} = finalizingChannel;
    const [, finalizesAt] = await this.nitroAdjudicator.unpackStatus(channelId);
    if (finalizesAt === finalizingChannel.finalizesAtS) {
      // Should we wait for 6 blocks before emitting the finalized event?
      // Will the wallet sign new states or deposit into the channel based on this event?
      // The answer is likely no.
      // So we probably want to emit this event as soon as possible.
      this.channelToEventTrackers.get(channelId)?.map(subscriber =>
        subscriber.channelFinalized({
          channelId,
          blockNumber: block.number,
          blockTimestamp: block.timestamp,
          finalizedAt: finalizingChannel.finalizesAtS,
        })
      );
      // Chain storage has a new finalizesAt timestamp
    } else if (finalizesAt) {
      this.addFinalizingChannel({channelId, finalizesAtS: finalizesAt});
    }
    this.checkFinalizingChannels(block);
  }

  private addFinalizingChannel(arg: {channelId: string; finalizesAtS: number}) {
    const {channelId, finalizesAtS} = arg;
    // Only add the finalizing channel if its not already there
    if (!this.finalizingChannels.some(c => c.channelId === channelId)) {
      this.finalizingChannels = [
        ...this.finalizingChannels,
        {channelId, finalizesAtS: finalizesAtS},
      ];
      this.finalizingChannels.sort((a, b) => a.finalizesAtS - b.finalizesAtS);
    }
  }

  private async registerFinalizationStatus(channelId: string): Promise<void> {
    const finalizesAtS = await this.getFinalizedAt(channelId);
    if (finalizesAtS !== 0) {
      this.addFinalizingChannel({channelId, finalizesAtS});
    }
  }

  private async getFinalizedAt(channelId: string): Promise<number> {
    const [, finalizesAt] = await this.nitroAdjudicator.unpackStatus(channelId);
    return finalizesAt;
  }

  private async getInitialHoldings(
    asset: Address,
    channelId: string,
    eventTracker: EventTracker
  ): Promise<void> {
    // If the destructor has been called we want to abort right away
    // We use this.provider.polling since we know the destructor sets that to false
    if (!this.provider.polling) return;
    const currentBlock = await this.provider.getBlockNumber();
    const confirmedBlock = currentBlock - this.blockConfirmations;
    const currentHolding = BN.from(await this.nitroAdjudicator.holdings(asset, channelId));
    let confirmedHolding = BN.from(0);
    try {
      // https://docs.ethers.io/v5/api/contract/contract/#Contract--metaclass
      // provider can lose track of the latest block, force it to reload
      const overrides = {
        blockTag: confirmedBlock,
      };

      confirmedHolding = BN.from(await this.nitroAdjudicator.holdings(asset, channelId, overrides));
      this.logger.debug(
        `Successfully read confirmedHoldings (${confirmedHolding}), from block ${confirmedBlock}.`
      );
    } catch (e) {
      // We should have e.code="CALL_EXCEPTION", but given currentHolding query succeeded,
      // the cause of exception is obvious
      this.logger.error(
        `Error caught while trying to query confirmed holding in block ${confirmedBlock}. ` +
          `This is likely because the channel is new and is safe to ignore. The error is ${JSON.stringify(
            e
          )}`
      );
    }

    this.logger.debug(
      `getConfirmedHoldings: from block ${confirmedBlock}, confirmed holding ${confirmedHolding}, current holding ${currentHolding}.`
    );

    /**
     * Report confirmed holding immediately.
     *
     * TODO: below can result in duplicate notifications to subscribers. Consider the following:
     * 1. Funds are deposited on block 0, generating a deposit event D.
     * 2. Events are defined as confirmed when the 5th block is mined after a transaction.
     * 3. A channel is registered with the chain service at block 5.
     * 4. We check for confirmed events:
     *      D is confirmed, so holdingUpdated is called with the block number 0 and the correct log index.
     * 5. We check for confirmed holdings:
     *      Holdings in block 5 are confirmed, so holdingUpdated is called with block number of 0 and the DEFAULT log index.
     * 6. Subscribers are notified of the holdings twice.
     */
    eventTracker.holdingUpdated(
      {
        channelId: channelId,
        asset,
        amount: confirmedHolding,
      },
      confirmedBlock
    );

    // We're unsure if the same events are also played by contract observer callback,
    // but need to play it regardless, so subscribers won't miss anything.
    // See EventTracker documentation
    const ethersEvents = (await this.nitroAdjudicator.queryFilter({}, confirmedBlock)).sort(
      e => e.blockNumber
    );
    for (const ethersEvent of ethersEvents) {
      await this.waitForConfirmations(ethersEvent);
      this.onAssetEvent(ethersEvent);
    }
  }

  private async waitForConfirmations(event: Event): Promise<void> {
    // `tx.wait(n)` resolves after n blocks are mined that include the given transaction `tx`
    // See https://docs.ethers.io/v5/api/providers/types/#providers-TransactionResponse
    await (await event.getTransaction()).wait(this.blockConfirmations + 1);
    this.logger.debug(
      {tx: event.transactionHash},
      'Finished waiting for confirmations; considering transaction finalized'
    );
  }

  private listenForAssetEvents(adjudicatorContract: Contract): void {
    // Listen to all contract events
    adjudicatorContract.on({}, async (ethersEvent: Event) => {
      this.logger.trace(
        {address: adjudicatorContract.address, event: ethersEvent},
        'Asset event being handled'
      );
      await this.waitForConfirmations(ethersEvent);
      this.onAssetEvent(ethersEvent);
    });
  }

  private async onAssetEvent(ethersEvent: Event): Promise<void> {
    switch (ethersEvent.event) {
      case Deposited:
        {
          const depositedEvent = await this.getDepositedEvent(ethersEvent);
          this.channelToEventTrackers.get(depositedEvent.channelId)?.forEach(eventTracker => {
            eventTracker.holdingUpdated(
              depositedEvent,
              depositedEvent.ethersEvent.blockNumber,
              depositedEvent.ethersEvent.logIndex
            );
          });
        }
        break;
      case AllocationUpdated:
        {
          const AllocationUpdatedEvent = await this.getAllocationUpdatedEvent(ethersEvent);
          this.channelToEventTrackers
            .get(AllocationUpdatedEvent.channelId)
            ?.forEach(eventTracker => {
              eventTracker.allocationUpdated(
                AllocationUpdatedEvent,
                AllocationUpdatedEvent.ethersEvent.blockNumber,
                AllocationUpdatedEvent.ethersEvent.logIndex
              );
            });
        }
        break;
      default:
        this.logger.error(`Unexpected event ${ethersEvent}`);
    }
  }

  private async increaseAllowance(tokenAddress: Address, amount: string): Promise<void> {
    const tokenContract = new Contract(
      tokenAddress,
      TestContractArtifacts.TokenArtifact.abi,
      this.ethWallet
    );
    switch (this.allowanceMode) {
      case 'PerDeposit': {
        const increaseAllowance = tokenContract.interface.encodeFunctionData('increaseAllowance', [
          this.nitroAdjudicator.address,
          amount,
        ]);
        const increaseAllowanceRequest = {
          data: increaseAllowance,
          to: tokenAddress,
        };

        const tx = await this.sendTransaction(increaseAllowanceRequest);

        this.logger.info(
          {tx: tx.hash},
          'Transaction to increase asset holder token allowance successfully submitted'
        );

        break;
      }
      case 'MaxUint': {
        const currentAllowance = await tokenContract.allowance(
          await this.ethWallet.getAddress(),
          this.nitroAdjudicator.address
        );
        // Half of MaxUint256 is the threshold for bumping up the allowance
        if (BN.gt(BN.div(constants.MaxUint256, 2), currentAllowance)) {
          const approveAllowance = tokenContract.interface.encodeFunctionData('approve', [
            this.nitroAdjudicator.address,
            constants.MaxUint256,
          ]);
          const approveAllowanceRequest = {
            data: approveAllowance,
            to: tokenContract.address,
          };

          const tx = await this.sendTransaction(approveAllowanceRequest);

          this.logger.info(
            {tx: tx.hash},
            'Transaction to approve maximum amount of asset holder spending successfully submitted'
          );

          break;
        }
      }
    }
  }

  private async getDepositedEvent(event: Event): Promise<DepositedEvent> {
    if (!event.args) {
      throw new Error('Deposited event must have args');
    }
    const [destination, asset, _amountDeposited, destinationHoldings] = event.args;
    return {
      type: Deposited,
      channelId: destination,
      asset,
      amount: BN.from(destinationHoldings),
      ethersEvent: event,
    };
  }

  private async getAllocationUpdatedEvent(event: Event): Promise<AllocationUpdatedEvent> {
    if (!event.args) {
      throw new Error('AllocationUpdated event must have args');
    }

    const [channelId, assetIndex, initialHoldings] = event.args;
    const tx = await this.provider.getTransaction(event.transactionHash);

    const {newOutcome, newHoldings, externalPayouts, internalPayouts} = computeNewOutcome(
      this.nitroAdjudicator.address,
      {channelId, assetIndex, initialHoldings},
      tx
    );

    return {
      type: AllocationUpdated,
      channelId: channelId,
      asset: makeAddress(newOutcome[assetIndex].asset),
      newHoldings: BN.from(newHoldings),
      externalPayouts: externalPayouts,
      internalPayouts: internalPayouts,
      newAssetOutcome: newOutcome[assetIndex],
      ethersEvent: event,
    };
  }

  /**
   *
   * @param appDefinition Address of state channels app
   *
   * Rejects with 'Bytecode missing' if there is no contract deployed at `appDefinition`.
   */
  public async fetchBytecode(appDefinition: string): Promise<string> {
    const result = await this.provider.getCode(appDefinition);

    if (result === '0x') throw new Error('Bytecode missing');

    return result;
  }
}
