import {
  ContractArtifacts,
  createETHDepositTransaction,
  Transactions,
  getChallengeRegisteredEvent,
  ChallengeRegisteredEvent,
  SignedState as NitroSignedState
} from '@statechannels/nitro-protocol';
import {
  BN,
  State,
  SignedState,
  fromNitroState,
  toNitroSignedState,
  calculateChannelId,
  Zero,
  Uint256,
  Address
} from '@statechannels/wallet-core';
import {Contract, Wallet, utils, providers, constants} from 'ethers';
import {Observable, fromEvent, from, merge} from 'rxjs';
import {filter, map, flatMap, distinctUntilChanged} from 'rxjs/operators';
import EventEmitter from 'eventemitter3';
import _ from 'lodash';

import {getProvider} from './utils/contract-utils';
import {NITRO_ADJUDICATOR_ADDRESS} from './config';
import {logger} from './logger';

export interface ChannelChainInfo {
  readonly amount: Uint256;
  readonly channelStorage: {
    turnNumRecord: number;
    finalizesAt: number;
    /* fingerprint: string */
  };
  readonly finalized: boolean; // this is a check on 0 < finalizesAt <= now
  readonly blockNum: number; // blockNum that the information is from
}

export interface Chain {
  // Properties
  ethereumIsEnabled: boolean;
  selectedAddress: string | undefined;

  // Feeds
  chainUpdatedFeed: (channelId: string) => Observable<ChannelChainInfo>;
  challengeRegisteredFeed: (channelId: string) => Observable<ChallengeRegistered>;

  // Setup / Web3 Specific
  ethereumEnable: () => Promise<string>;
  initialize(): Promise<void>;

  // Chain Methods
  getBlockNumber: () => Promise<number>;
  deposit: (channelId: string, expectedHeld: string, amount: string) => Promise<string | undefined>;
  challenge: (support: SignedState[], privateKey: string) => Promise<string | undefined>;
  finalizeAndWithdraw: (finalizationProof: SignedState[]) => Promise<string | undefined>;
  getChainInfo: (channelId: string) => Promise<ChannelChainInfo>;
  balanceUpdatedFeed(address: string): Observable<Uint256>;

  /**
   * Only used for testing
   */
  destroy(): void;
}

type Updated = ChannelChainInfo & {channelId: string};

type ChallengeRegistered = {channelId: string; challengeState: State; challengeExpiry: number};
// type ChallengeCleared = {channelId: string};
// type Concluded = {channelId: string};

export class FakeChain implements Chain {
  private blockNumber = 1;
  private channelStatus: Record<string, ChannelChainInfo> = {};
  private eventEmitter: EventEmitter<{
    updated: [Updated];
    // TODO: Add AssetHolder events
    challengeRegistered: [ChallengeRegistered];
    // [CHALLENGE_CLEARED]: [ChallengeCleared];
    // [CONCLUDED]: [Concluded];
  }> = new EventEmitter();

  private fakeSelectedAddress: string;

  public async initialize() {
    /* NOOP */
  }

  public async getBlockNumber() {
    return this.blockNumber;
  }

  public setBlockNumber(blockNumber: number) {
    this.blockNumber = blockNumber;

    for (const channelId in this.channelStatus) {
      const {
        channelStorage: {finalizesAt}
      } = this.channelStatus[channelId];
      // FIXME: shouldn't this be block timestamp?
      if (finalizesAt > 0 && finalizesAt <= blockNumber) {
        this.channelStatus[channelId] = {...this.channelStatus[channelId], finalized: true};
        this.eventEmitter.emit('updated', {channelId, ...this.channelStatus[channelId]});
      }
    }
  }

  public async deposit(channelId: string, expectedHeld: string, amount: string) {
    this.depositSync(channelId, expectedHeld, amount);
    return 'fake-transaction-id';
  }

  public async challenge(support: SignedState[]): Promise<string> {
    const channelId = calculateChannelId(support[0]);

    const {turnNum, challengeDuration} = support[support.length - 1];

    this.channelStatus[channelId] = {
      ...(this.channelStatus[channelId] || {}),
      channelStorage: {
        turnNumRecord: turnNum,
        finalizesAt: this.blockNumber + challengeDuration
      },
      finalized: challengeDuration === 0
    };

    this.eventEmitter.emit('updated', {channelId, ...this.channelStatus[channelId]});

    this.eventEmitter.emit('challengeRegistered', {
      channelId,
      challengeState: support[support.length - 1],
      challengeExpiry: this.blockNumber + challengeDuration
    });

    return 'fake-transaction-id';
  }

  public async finalizeAndWithdraw(finalizationProof: SignedState[]): Promise<string | undefined> {
    const channelId = calculateChannelId(finalizationProof[0]);
    this.finalizeSync(channelId);

    this.channelStatus[channelId] = {
      ...this.channelStatus[channelId],
      amount: Zero,
      blockNum: this.blockNumber
    };

    this.eventEmitter.emit('updated', {
      ...this.channelStatus[channelId],
      channelId,
      blockNum: this.blockNumber
    });
    return;
  }

  public finalizeSync(channelId: string, turnNum = 0) {
    this.channelStatus[channelId] = {
      ...(this.channelStatus[channelId] || {}),
      channelStorage: {
        turnNumRecord: turnNum,
        finalizesAt: this.blockNumber
      }
    };
  }

  public depositSync(channelId: string, expectedHeld: string, amount: string) {
    const current = (this.channelStatus[channelId] || {}).amount || Zero;

    if (BN.gte(current, expectedHeld)) {
      this.channelStatus[channelId] = {
        ...this.channelStatus[channelId],
        amount: BN.add(current, amount)
      };
      this.eventEmitter.emit('updated', {
        ...this.channelStatus[channelId],
        channelId
      });
    }
  }

  public async getChainInfo(channelId: string): Promise<ChannelChainInfo> {
    const {amount, channelStorage} = this.channelStatus[channelId] || {};
    return {
      channelStorage: channelStorage || {
        turnNumRecord: 0,
        finalizesAt: 0
      },
      finalized:
        channelStorage &&
        channelStorage.finalizesAt > 0 &&
        channelStorage.finalizesAt <= this.blockNumber,
      blockNum: this.blockNumber,
      amount: amount || Zero
    };
  }

  public chainUpdatedFeed(channelId: string): Observable<ChannelChainInfo> {
    const first = from(this.getChainInfo(channelId));

    const updates = fromEvent(this.eventEmitter, 'updated').pipe(
      filter((event: Updated) => event.channelId === channelId),
      map(({amount, channelStorage, finalized, blockNum: blockNum}) => ({
        amount,
        channelStorage,
        finalized,
        blockNum
      }))
    );

    return merge(first, updates);
  }
  public balanceUpdatedFeed(): Observable<Uint256> {
    // You're rich!
    return from([BN.from('0x999999999999')]);
  }
  public challengeRegisteredFeed(channelId: string): Observable<ChallengeRegistered> {
    const updates = fromEvent(this.eventEmitter, 'challengeRegistered').pipe(
      filter((event: ChallengeRegistered) => event.channelId === channelId),
      map(({challengeState, challengeExpiry}) => ({
        channelId,
        challengeState,
        challengeExpiry
      }))
    );

    return merge(
      /* first */ // TODO: It is not possible to get the "first" event because we have no "replay" functionality
      updates
    );
  }

  public ethereumEnable() {
    this.fakeSelectedAddress = utils.hexZeroPad('0x123', 32);
    return Promise.resolve(this.selectedAddress);
  }

  public get ethereumIsEnabled() {
    return true;
  }

  public get selectedAddress() {
    return this.fakeSelectedAddress;
  }

  public destroy(): void {
    _.noop();
  }
}

const chainLogger = logger.child({module: 'chain'});
// Sets a default of gas price 15 Gwei which is more than enough to get picked up in goerli
// This prevents issues with metamask incorrectly estimating 0 gas
const GAS_PRICE = utils.parseUnits('15', 'gwei');
export class ChainWatcher implements Chain {
  private _adjudicator?: Contract;
  private provider: ReturnType<typeof getProvider>;
  private mySelectedAddress: string | undefined;

  constructor(chainAddress?: Address) {
    this.mySelectedAddress = chainAddress ?? window.ethereum?.selectedAddress ?? undefined;
  }

  private get signer() {
    if (!this.ethereumIsEnabled) throw new Error('Ethereum not enabled');

    if (window.ethereum?.mockingInfuraProvider) {
      return new Wallet(
        '0xccb052837ccafb700e34c0e0cc0f3e5fbee8f078f3fe6b4e5950c7c8acaa7bce',
        this.provider
      );
    }

    return this.provider.getSigner(this.selectedAddress as string);
  }

  public async initialize() {
    this.provider = getProvider();

    this.provider.on('block', blockNumber => chainLogger.trace({blockNumber}, 'New Block'));

    this.configureContracts();
  }

  private configureContracts() {
    if (!this.ethereumIsEnabled) return;
    this._adjudicator = new Contract(
      NITRO_ADJUDICATOR_ADDRESS,
      ContractArtifacts.NitroAdjudicatorArtifact.abi,
      this.signer
    );

    chainLogger.info(
      {
        NITRO_ADJUDICATOR_ADDRESS
      },
      'Contracts configured'
    );
  }

  public async getBlockNumber() {
    return this.provider.getBlockNumber();
  }

  public async ethereumEnable(): Promise<string> {
    if (window.ethereum) {
      try {
        this.mySelectedAddress = (await window.ethereum.enable())[0];
        if (this.ethereumIsEnabled) {
          this.configureContracts();
          return this.selectedAddress as string;
        } else {
          const error = 'Ethereum enabled but no selected address is defined';
          chainLogger.error(error);
          return Promise.reject(error);
        }
      } catch (error) {
        // TODO: Handle error. Likely the user rejected the login
        chainLogger.error(error);
        return Promise.reject('user rejected in metamask');
      }
    } else {
      return Promise.reject('window.ethereum not found');
    }
  }

  public get selectedAddress(): string | undefined {
    if (this.mySelectedAddress === null) {
      if (window && window.ethereum) {
        this.mySelectedAddress = window.ethereum.selectedAddress ?? null;
      }
    }
    return this.mySelectedAddress;
  }

  public get ethereumIsEnabled(): boolean {
    return typeof this.selectedAddress === 'string';
  }

  public async finalizeAndWithdraw(finalizationProof: SignedState[]): Promise<string | undefined> {
    const transactionRequest = {
      ...Transactions.createConcludeAndTransferAllAssetsTransaction(
        finalizationProof.flatMap(toNitroSignedState)
      ),
      to: NITRO_ADJUDICATOR_ADDRESS
    };

    const response = await this.signer.sendTransaction({
      ...convertNitroTransactionRequest(transactionRequest),
      gasPrice: GAS_PRICE
    });
    return response.hash;
  }

  public async challenge(support: SignedState[], privateKey: string): Promise<string | undefined> {
    const convertedSignedStates = support
      .reduce(
        (previous, current) => previous.concat(toNitroSignedState(current)),
        new Array<NitroSignedState>()
      )
      .sort((s1, s2) => s1.state.turnNum - s2.state.turnNum);
    const transactionRequest = {
      ...Transactions.createChallengeTransaction(
        convertedSignedStates,
        // createForceMoveTransaction requires this to sign a "challenge message"
        privateKey
      ),
      to: NITRO_ADJUDICATOR_ADDRESS
    };
    const response = await this.signer.sendTransaction({
      ...convertNitroTransactionRequest(transactionRequest),
      gasPrice: GAS_PRICE
    });
    const tx = await response.wait();
    return tx.transactionHash;
  }

  public async deposit(
    channelId: string,
    expectedHeld: string,
    amount: string
  ): Promise<string | undefined> {
    const transactionRequest = {
      ...createETHDepositTransaction(channelId, expectedHeld, amount),
      to: NITRO_ADJUDICATOR_ADDRESS,
      value: amount
    };
    const response = await this.signer.sendTransaction({
      ...convertNitroTransactionRequest(transactionRequest),
      gasPrice: GAS_PRICE
    });

    chainLogger.trace({response}, 'Deposit successful from %s', response.from);
    return response.hash;
  }

  public async getChainInfo(channelId: string): Promise<ChannelChainInfo> {
    if (!this._adjudicator) {
      throw new Error('Not connected to contracts');
    }

    const amount: Uint256 = BN.from(
      await this._adjudicator.holdings(constants.AddressZero, channelId)
    );

    const [turnNumRecord, finalizesAt]: [number, number] = await this._adjudicator.unpackStatus(
      channelId
    );

    const blockNum = await this.provider.getBlockNumber();
    chainLogger.trace(
      {
        amount,
        channelStorage: {
          turnNumRecord,
          finalizesAt
        },
        finalized: BN.gt(finalizesAt, 0) && BN.lte(finalizesAt, blockNum),
        blockNum
      },
      'Chain query result'
    );
    // TODO: Fetch other info
    return {
      amount,
      channelStorage: {
        turnNumRecord,
        finalizesAt
      },
      finalized: BN.gt(finalizesAt, 0) && BN.lte(finalizesAt, blockNum),
      blockNum
    };
  }

  public balanceUpdatedFeed(address: string): Observable<Uint256> {
    const first = from(this.provider.getBalance(address).then(BN.from));
    const updates = fromEvent<Uint256>(this.provider, 'block').pipe(
      flatMap(() => this.provider.getBalance(address))
    );

    return merge(first, updates).pipe(distinctUntilChanged<Uint256>(BN.eq));
  }

  public chainUpdatedFeed(channelId: string): Observable<ChannelChainInfo> {
    if (!this._adjudicator) {
      throw new Error('Not connected to contracts');
    }

    // TODO: removing 5 seconds polling as it is causing seems to be correlated with test process errors:
    //        Error: could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.0.9)
    // Consider adding polling as an option to the chain watcher
    //const polledData = interval(5000).pipe(flatMap(() => this.getChainInfo(channelId)));

    const depositEvents = fromEvent(this._adjudicator, 'Deposited').pipe(
      // TODO: Type event correctly, use ethers-utils.js
      filter((event: Array<any>) => BN.eq(event[0], channelId)),
      // TODO: Currently it seems that getChainInfo can return stale information
      // so as a workaround we use the amount from the event
      // see https://github.com/statechannels/monorepo/issues/1995
      flatMap(async event => ({
        ...(await this.getChainInfo(channelId)),
        amount: BN.from(event.slice(-1)[0].args.destinationHoldings)
      }))
    );

    const assetTransferEvents = fromEvent(this._adjudicator, 'FingerprintUpdated').pipe(
      // TODO: Type event correctly, use ethers-utils.js
      filter((event: Array<string | Uint256>) => BN.eq(event[0], channelId)),
      // Actually ignores the event data and just polls the chain
      flatMap(async () => this.getChainInfo(channelId))
    );

    // TODO: see comment above around polling
    // return merge(polledData, depositEvents, assetTransferEvents);
    return merge(depositEvents, assetTransferEvents);
  }

  public challengeRegisteredFeed(channelId: string): Observable<ChallengeRegistered> {
    if (!this._adjudicator) {
      throw new Error('Not connected to contracts');
    }

    const updates = fromEvent(this._adjudicator, 'ChallengeRegistered').pipe(
      filter((event: any) => event[0] === channelId), // index 0 of ChallengeRegistered event is channelId
      map(getChallengeRegisteredEvent),
      map(({challengeStates, finalizesAt}: ChallengeRegisteredEvent) => ({
        channelId,
        challengeState: fromNitroState(challengeStates[challengeStates.length - 1].state),
        challengeExpiry: finalizesAt
      }))
    );

    return merge(
      /* first */ // TODO: We cannot have a first because we can't "replay" events yet
      updates
    );
  }

  /**
   * Only used for testing
   */
  public destroy(): void {
    this.provider.polling = false;
    this._adjudicator?.removeAllListeners();
    this.provider.removeAllListeners();
  }
}

// Since nitro-protocol is still using v4 of ethers we need to convert any bignumbers the v5 version from ethers
// TODO: Remove this when nitro protocol is using v5 ethers
function convertNitroTransactionRequest(nitroTransactionRequest): providers.TransactionRequest {
  return {
    ...nitroTransactionRequest,
    gasLimit: nitroTransactionRequest.gasLimit
      ? BN.from(nitroTransactionRequest.gasLimit)
      : undefined,
    gasPrice: nitroTransactionRequest.gasPrice
      ? BN.from(nitroTransactionRequest.gasPrice)
      : undefined,
    nonce: nitroTransactionRequest.nonce ? BN.from(nitroTransactionRequest.nonce) : undefined,
    value: nitroTransactionRequest.value ? BN.from(nitroTransactionRequest.value) : undefined
  };
}
