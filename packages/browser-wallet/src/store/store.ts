import {EventEmitter} from 'eventemitter3';
import {filter, map, concatAll} from 'rxjs/operators';
import {Observable, fromEvent, merge, from, of, Subject} from 'rxjs';
import {Wallet, constants} from 'ethers';
import * as _ from 'lodash';
import AsyncLock from 'async-lock';
import {
  isSimpleEthAllocation,
  calculateChannelId,
  hashState,
  Outcome,
  ChannelStoredData,
  Payload,
  Objective,
  Participant,
  SignedState,
  DomainBudget,
  State,
  StateVariables,
  SimpleAllocation,
  Funding,
  BN,
  Uint256,
  makeAddress,
  DirectFunder,
  RichObjective,
  RichObjectiveEvent
} from '@statechannels/wallet-core';
import {Dictionary} from 'lodash';

import {Chain, FakeChain} from '../chain';
import {CHAIN_NETWORK_ID, HUB, WALLET_VERSION} from '../config';
import {checkThat, recordToArray} from '../utils';
import {logger} from '../logger';
import {DB_NAME} from '../constants';

import {ChannelStoreEntry} from './channel-store-entry';
import {MemoryBackend} from './memory-backend';

import {Errors, DBBackend, ObjectStores} from '.';

interface InternalEvents {
  channelUpdated: [ChannelStoreEntry];
  newObjective: [Objective];
  addToOutbox: [Payload];
  lockUpdated: [ChannelLock];
}
export type ChannelLock = {
  channelId: string;
  release: () => void;
};

type OpenChanneObjectiveParams = Omit<State, 'turnNum' | 'channelNonce' | 'isFinal'>;

//FIXME
const track = _.noop;
const identify = _.noop;

export class Store {
  protected backend: DBBackend = new MemoryBackend();
  readonly chain: Chain;
  private _eventEmitter = new EventEmitter<InternalEvents>();
  private objectives: Objective[] = [];

  /**
   *  START of wallet 2.0
   */

  /** TODO:
   *    These dictionaries should be changed:
   *      - Store this information in permanent storage instead of memory.
   *      - Create getters and setters.
   */
  public richObjectives: Dictionary<RichObjective> = {};

  public richObjectiveFeed = new Subject<RichObjective>();
  public richObjectiveEventFeed = new Subject<RichObjectiveEvent>();

  /**
   *  END of wallet 2.0
   */

  constructor(chain?: Chain, backend?: DBBackend) {
    // TODO: We shouldn't default to a fake chain
    // but I didn't feel like updating all the constructor calls
    this.chain = chain || new FakeChain();
    this.chain.initialize();
    if (backend) {
      this.backend = backend;
    }
  }

  public initialize = async (privateKeys?: string[], cleanSlate = false, dbName = DB_NAME) => {
    await this.backend.initialize(cleanSlate, dbName);

    await this.backend.transaction('readwrite', [ObjectStores.privateKeys], async () => {
      const currentAddress = await this.getAddress();
      let segmentId = currentAddress;

      if (!privateKeys?.length && !currentAddress) {
        // generate the first private key
        const {privateKey} = Wallet.createRandom();
        privateKeys = [privateKey];
      }

      await Promise.all(
        privateKeys?.map(pk => this.backend.setPrivateKey(new Wallet(pk).address, pk)) || []
      );

      if (!segmentId) {
        segmentId = await this.getAddress();
        identify(segmentId);
        track('created a wallet', {address: segmentId});
      } else {
        identify(segmentId);
      }

      track('initialized a wallet', {address: segmentId});
    });
  };

  public getDestinationAddress = () => this.backend.getDestinationAddress();
  public setDestinationAddress = (destinationAddress: string) => {
    if (!destinationAddress) {
      logger.error('destinationAddress being set to falsy value', destinationAddress);
    }
    return this.backend.setDestinationAddress(destinationAddress);
  };

  public async getBudget(domain: string): Promise<DomainBudget | undefined> {
    return this.backend.getBudget(domain);
  }

  public channelUpdatedFeed(channelId: string): Observable<ChannelStoreEntry> {
    // TODO: The following line is not actually type safe.
    // fromEvent<'foo'>(this._eventEmitter, 'channelUpdated') would happily return
    // Observable<'foo'>
    const newEntries = fromEvent<ChannelStoreEntry>(this._eventEmitter, 'channelUpdated').pipe(
      filter(cs => cs.channelId === channelId)
    );

    const currentEntry = from(this.backend.getChannel(channelId)).pipe(
      filter<ChannelStoreEntry>(c => !!c)
    );

    return merge(currentEntry, newEntries);
  }

  get objectiveFeed(): Observable<Objective> {
    const newObjectives = fromEvent<Objective>(this._eventEmitter, 'newObjective');
    const currentObjectives = of(this.objectives).pipe(concatAll());

    return merge(newObjectives, currentObjectives);
  }

  get outboxFeed(): Observable<Payload> {
    return fromEvent(this._eventEmitter, 'addToOutbox');
  }

  private initializeChannel = (
    state: State,
    applicationDomain?: string
  ): Promise<ChannelStoreEntry> =>
    this.backend.transaction(
      'readwrite',
      [ObjectStores.privateKeys, ObjectStores.nonces, ObjectStores.channels],
      async () => {
        const addresses = state.participants.map(x => x.signingAddress);
        const privateKeys = await this.backend.privateKeys();
        const myIndex = addresses.findIndex(address => !!privateKeys[address]);
        if (myIndex === -1) throw Error(Errors.notInChannel);

        await this.setNonce(addresses, state.channelNonce);

        const data: ChannelStoredData = {
          channelConstants: state,
          stateVariables: [{...state, stateHash: hashState(state), signatures: []}],
          myIndex,
          funding: undefined,
          applicationDomain
        };

        await this.backend.setChannel(calculateChannelId(state), data);
        return new ChannelStoreEntry(data);
      }
    );

  public setFunding = (channelId: string, funding: Funding) =>
    this.backend.transaction('readwrite', [ObjectStores.channels], async () => {
      const channelEntry = await this.getEntry(channelId);

      if (channelEntry.funding) {
        logger.error({funding: channelEntry.funding}, 'Channel %s already funded', channelId);
        throw Error(Errors.channelFunded);
      }
      channelEntry.setFunding(funding);

      await this.backend.setChannel(channelEntry.channelId, channelEntry.data());
    });

  private ledgerLock = new AsyncLock();
  public async acquireChannelLock(channelId: string): Promise<ChannelLock> {
    return new Promise(resolve =>
      // TODO: Does this need a timeout?
      this.ledgerLock.acquire(channelId, release => resolve({release, channelId}))
    );
  }

  public getLedger = async (peerId: string) =>
    this.backend.transaction(
      'readonly',
      [ObjectStores.ledgers, ObjectStores.channels],
      async () => {
        const ledgerId = await this.backend.getLedger(peerId);
        if (!ledgerId) throw Error(Errors.noLedger + `: ${peerId}`);

        return await this.getEntry(ledgerId);
      }
    );

  public setapplicationDomain = (channelId: string, applicationDomain: string) =>
    this.backend.transaction('readwrite', [ObjectStores.channels], async () => {
      const entry = await this.getEntry(channelId);

      if (typeof entry.applicationDomain === 'string') throw Error(Errors.domainExistsOnChannel);

      await this.backend.setChannel(channelId, {...entry.data(), applicationDomain});
    });

  public setLedger = (ledgerId: string) =>
    this.backend.transaction(
      'readwrite',
      [ObjectStores.ledgers, ObjectStores.channels, ObjectStores.privateKeys],
      async () => {
        const entry = await this.getEntry(ledgerId);

        // This is not on the Store interface itself -- it is useful to set up a test store
        await this.backend.setChannel(entry.channelId, entry.data());
        const address = await this.getAddress();
        const hub = entry.participants.find(p => p.signingAddress !== address) as Participant;
        await this.backend.setLedger(hub.participantId, entry.channelId);
      }
    );

  public getApplicationChannels = (applicationDomain: string, includeClosed = false) =>
    this.backend.transaction('readonly', [ObjectStores.channels], async () =>
      recordToArray(await this.backend.channels()).filter(
        channel =>
          !!channel &&
          channel.applicationDomain === applicationDomain &&
          (!channel.hasConclusionProof || includeClosed) &&
          !BN.isZero(channel.channelConstants.appDefinition)
      )
    );

  public createChannel = (
    participants: Participant[],
    challengeDuration: number,
    stateVars: StateVariables,
    appDefinition = constants.AddressZero,
    applicationDomain?: string
  ) =>
    this.backend
      .transaction(
        'readwrite',
        [ObjectStores.privateKeys, ObjectStores.nonces, ObjectStores.channels],
        async () => {
          stateVars = _.pick(stateVars, 'outcome', 'turnNum', 'appData', 'isFinal');
          const addresses = participants.map(x => x.signingAddress);
          const privateKeys = await this.backend.privateKeys();
          const myIndex = addresses.findIndex(address => !!privateKeys[address]);
          if (myIndex === -1) {
            throw Error(Errors.notInChannel);
          }

          const channelNonce = (await this.getNonce(addresses)) + 1;
          const chainId = CHAIN_NETWORK_ID;

          const entry = await this.initializeChannel(
            {
              chainId,
              challengeDuration,
              channelNonce,
              participants,
              appDefinition: makeAddress(appDefinition),
              ...stateVars
            },
            applicationDomain
          );
          return this.signAndAddStateWithinTx(entry.channelId, stateVars);
        }
      )
      .then(({entry, signedState}) => this.emitChannelUpdatedEventAfterTX(entry, signedState));

  private async getNonce(addresses: string[]): Promise<number> {
    return (await this.backend.getNonce(this.nonceKeyFromAddresses(addresses))) ?? -1;
  }

  private async setNonce(addresses: string[], value: number) {
    if (value <= (await this.getNonce(addresses))) throw Error(Errors.invalidNonce);

    await this.backend.setNonce(this.nonceKeyFromAddresses(addresses), value);
  }

  private nonceKeyFromAddresses = (addresses: string[]): string => addresses.join('::');

  public async getPrivateKey(signingAddress: string): Promise<string> {
    const ret = await this.backend.getPrivateKey(signingAddress);
    if (!ret) throw Error(Errors.cannotFindPrivateKey);
    return ret;
  }

  public updateChannel = (
    channelId: string,
    updateData: Partial<{outcome: SimpleAllocation; appData: string; isFinal: boolean}>
  ) =>
    this.backend
      .transaction('readwrite', [ObjectStores.channels, ObjectStores.privateKeys], async () => {
        const {supported: existingState, myTurn} = await this.getEntry(channelId);
        if (!myTurn) {
          logger.error({channelId, updateData, existingState}, 'Updating channel when not my turn');
          throw Error(Errors.notMyTurn);
        }

        const newState = _.merge(existingState, {
          turnNum: existingState.turnNum + 1,
          ...updateData
        });

        return this.signAndAddStateWithinTx(channelId, newState);
      })
      .then(({entry, signedState}) => this.emitChannelUpdatedEventAfterTX(entry, signedState));

  public signFinalState = (channelId: string) =>
    this.backend
      .transaction('readwrite', [ObjectStores.channels, ObjectStores.privateKeys], async () => {
        const {supported, latestSignedByMe} = await this.getEntry(channelId);
        if (!supported.isFinal) throw new Error('Supported state not final');
        if (latestSignedByMe.turnNum === supported.turnNum) return; // already signed
        return await this.signAndAddStateWithinTx(channelId, supported);
      })
      .then(result => {
        if (result) this.emitChannelUpdatedEventAfterTX(result.entry, result.signedState);
      });

  private emitChannelUpdatedEventAfterTX(entry: ChannelStoreEntry, signedState?: SignedState) {
    // These events trigger callbacks that should not run within the transaction scope
    // See https://github.com/dfahlander/Dexie.js/issues/1029

    if (this.backend.transactionOngoing) throw Error(Errors.emittingDuringTransaction);

    this._eventEmitter.emit('channelUpdated', entry);
    if (signedState)
      this._eventEmitter.emit('addToOutbox', {
        walletVersion: WALLET_VERSION,
        signedStates: [signedState]
      });

    return entry;
  }

  public signAndAddState = (channelId: string, stateVars: StateVariables) =>
    this.signAndAddStateWithinTx(channelId, stateVars).then(({entry, signedState}) =>
      this.emitChannelUpdatedEventAfterTX(entry, signedState)
    );

  public supportState = (state: State) =>
    this.backend
      .transaction('readwrite', [ObjectStores.channels, ObjectStores.privateKeys], async () => {
        const stateHash = hashState(state);
        const channelId = calculateChannelId(state);
        const entry = await this.getEntry(channelId);
        const {isSupportedByMe} = entry;

        // We only sign the state if we haven't signed it already
        if (!isSupportedByMe || entry.latestSignedByMe.stateHash !== stateHash) {
          return await this.signAndAddStateWithinTx(channelId, state);
        } else {
          // The support state machine was started with a state that we already support
          // That's fine but we output a warning in case that's unexpected
          logger.warn({state}, 'The state is already supported');
          return;
        }
      })
      .then(args => {
        if (!args) return;
        this.emitChannelUpdatedEventAfterTX(args.entry, args.signedState);
      });

  private signAndAddStateWithinTx = (channelId: string, stateVars: StateVariables) =>
    this.backend.transaction(
      'readwrite',
      [ObjectStores.channels, ObjectStores.privateKeys],
      async () => {
        const entry = await this.getEntry(channelId);

        const signedState = entry.signAndAdd(
          _.pick(stateVars, 'outcome', 'turnNum', 'appData', 'isFinal'),
          await this.getPrivateKey(entry.myAddress)
        );
        await this.backend.setChannel(channelId, entry.data());
        return {entry, signedState};
      }
    );

  async addObjective(objective: Objective, _addToOutbox = true) {
    const objectives = this.objectives;
    if (!_.find(objectives, o => _.isEqual(o, objective))) {
      this.objectives.push(objective);
      // TODO: comment back in
      // addToOutbox &&
      // this._eventEmitter.emit('addToOutbox', {
      //   walletVersion: WALLET_VERSION,
      //   objectives: [objective]
      // });
    }
  }

  /**
   *
   * @param state State to add to the store
   * @param notifyOutbox Should this state get sent to other participants?
   */
  public async addState(state: SignedState, notifyOutbox = false) {
    const stateToSend = notifyOutbox ? state : undefined;

    return this.backend
      .transaction(
        'readwrite',
        [ObjectStores.channels, ObjectStores.nonces, ObjectStores.privateKeys],
        async () => {
          const channelId = calculateChannelId(state);
          const memoryChannelStorage =
            (await this.backend.getChannel(channelId)) || (await this.initializeChannel(state));
          // TODO: This is kind of awkward
          state.signatures.forEach(sig => memoryChannelStorage.addState(state, sig));
          await this.backend.setChannel(channelId, memoryChannelStorage.data());
          return memoryChannelStorage;
        }
      )
      .then(entry => this.emitChannelUpdatedEventAfterTX(entry, stateToSend));
  }

  public async getAddress(): Promise<string> {
    const privateKeys = await this.backend.privateKeys();
    return Object.keys(privateKeys)[0];
  }

  async pushMessage(message: Payload) {
    await Promise.all(message.signedStates?.map(signedState => this.addState(signedState)) || []);
    message.objectives?.map(o => this.addObjective(o, false));

    this.pushMessage2(message.signedStates, message.objectives);
  }

  public async getEntry(channelId: string): Promise<ChannelStoreEntry> {
    const entry = await this.backend.getChannel(channelId);
    if (!entry) {
      logger.error('Channel %s not found', channelId);
      throw Error(Errors.channelMissing);
    }

    return entry;
  }

  public createBudget = (budget: DomainBudget) =>
    this.backend.transaction('readwrite', [ObjectStores.budgets], async tx => {
      const existingBudget = await this.backend.getBudget(budget.domain);
      if (existingBudget) {
        logger.error(Errors.budgetAlreadyExists);
        tx.abort();
      }

      await this.backend.setBudget(budget.domain, budget);
    });

  public clearBudget = domain =>
    this.backend.transaction('readwrite', [ObjectStores.budgets], () =>
      this.backend.deleteBudget(domain)
    );

  public releaseFunds = (asset: string, ledgerChannelId: string, targetChannelId: string) =>
    this.backend.transaction(
      'readwrite',
      [ObjectStores.budgets, ObjectStores.channels, ObjectStores.privateKeys],
      async () => {
        const {applicationDomain, supported, participants} = await this.getEntry(ledgerChannelId);
        const {outcome} = supported;
        if (typeof applicationDomain !== 'string') throw Error(Errors.noDomainForChannel);

        const currentBudget = await this.getBudget(applicationDomain);

        const assetBudget = currentBudget?.forAsset[asset];

        if (!currentBudget || !assetBudget) throw Error(Errors.noBudget);

        const channelBudget = assetBudget.channels[targetChannelId];
        if (!channelBudget) throw Error(Errors.channelNotInBudget);
        const playerAddress = await this.getAddress();

        const playerDestination = participants.find(p => p.signingAddress === playerAddress)
          ?.destination;
        if (!playerDestination) {
          throw Error(Errors.cannotFindDestination);
        }
        // Simply set the budget to the current ledger outcome
        assetBudget.availableSendCapacity = getAllocationAmount(outcome, playerDestination);
        assetBudget.availableReceiveCapacity = getAllocationAmount(outcome, HUB.destination);

        // Delete the funds assigned to the channel
        delete assetBudget.channels[targetChannelId];

        await this.backend.setBudget(applicationDomain, currentBudget);
        return currentBudget;
      }
    );

  public reserveFunds = (
    asset: string,
    channelId: string,
    amount: {send: Uint256; receive: Uint256}
  ) =>
    this.backend.transaction(
      'readwrite',
      [ObjectStores.budgets, ObjectStores.channels],
      async () => {
        const entry = await this.getEntry(channelId);
        const domain = entry.applicationDomain;
        if (typeof domain !== 'string') throw Error(Errors.noDomainForChannel + ' ' + channelId);
        const currentBudget = await this.backend.getBudget(domain);

        // TODO?: Create a new budget if one doesn't exist
        if (!currentBudget) throw Error(Errors.noBudget + domain);

        const assetBudget = currentBudget?.forAsset[asset];
        if (!assetBudget) throw Error(Errors.noAssetBudget);

        if (
          BN.lt(assetBudget.availableSendCapacity, amount.send) ||
          BN.lt(assetBudget.availableReceiveCapacity, amount.receive)
        ) {
          throw Error(Errors.budgetInsufficient);
        }

        currentBudget.forAsset[asset] = {
          ...assetBudget,
          availableSendCapacity: BN.sub(assetBudget.availableSendCapacity, amount.send),
          availableReceiveCapacity: BN.sub(assetBudget.availableReceiveCapacity, amount.receive),
          channels: {
            ...assetBudget.channels,
            [channelId]: {amount: BN.add(amount.send, amount.receive)}
          }
        };
        this.backend.setBudget(currentBudget.domain, currentBudget);

        return currentBudget;
      }
    );

  /**
   *  START of wallet 2.0
   */

  async pushMessage2(signedStates: SignedState[] | undefined, objectives: Objective[] | undefined) {
    if (objectives)
      await Promise.all(
        objectives.map(_.bind(this.createAndStoreRichObjectiveFromObjective, this))
      );

    if (signedStates?.length) {
      // TODO: account for the case a message containing states for many channels
      const channelId = calculateChannelId(signedStates[0]);
      if (this.richObjectives[channelId]) {
        this.richObjectiveEventFeed.next({
          type: 'StatesReceived',
          states: signedStates,
          channelId
        });
      }
    }
  }

  public async createAndStoreOpenChannelObjective(
    params: OpenChanneObjectiveParams
  ): Promise<DirectFunder.OpenChannelObjective> {
    const addresses = params.participants.map(x => x.signingAddress);
    // TODO: this is not concurrency safe as the new nonce is not saved to the store until a state is added to the store
    const channelNonce = (await this.getNonce(addresses)) + 1;
    const channelId = calculateChannelId({...params, channelNonce});

    if (this.richObjectives[channelId]) {
      // TODO: should include the channel id in the error
      throw new Error(Errors.objectiveAlreadyExists);
    }
    const openingState: State = {
      ...params,
      turnNum: 0,
      isFinal: false,
      channelNonce
    };
    const newObjective = DirectFunder.initialize(openingState, 0);
    this.richObjectives[channelId] = newObjective;
    this.registerChannelWithChain(channelId);
    this.richObjectiveFeed.next(newObjective);
    return this.richObjectives[channelId];
  }

  private async createAndStoreRichObjectiveFromObjective(objective: Objective) {
    switch (objective.type) {
      case 'OpenChannel':
        if (this.richObjectives[objective.data.targetChannelId]) {
          throw new Error(
            `Rich objective already exists for channel ${objective.data.targetChannelId}`
          );
        }

        const channel = await this.getEntry(objective.data.targetChannelId);
        const richObjective: DirectFunder.OpenChannelObjective = DirectFunder.initialize(
          channel.latestState,
          channel.myIndex
        );
        this.richObjectives[richObjective.channelId] = richObjective;

        this.registerChannelWithChain(richObjective.channelId);
        this.richObjectiveFeed.next(richObjective);

        break;
      default:
        throw new Error(`addRichObjective not implemented for an objective type ${objective.type}`);
    }
  }

  private registerChannelWithChain(channelId): void {
    this.chain.chainUpdatedFeed(channelId).subscribe(chainInfo =>
      this.richObjectiveEventFeed.next({
        type: 'FundingUpdated',
        amount: chainInfo.amount,
        finalized: true,
        channelId
      })
    );
  }

  /**
   *  END of wallet 2.0
   */
}

export function supportedStateFeed(store: Store, channelId: string) {
  return store.channelUpdatedFeed(channelId).pipe(
    filter(e => e.isSupported),
    map(({supported}) => ({state: supported}))
  );
}

function getAllocationAmount(outcome: Outcome, destination: string) {
  const {allocationItems} = checkThat(outcome, isSimpleEthAllocation);
  const amount = allocationItems.find(a => a.destination === destination)?.amount;
  if (!amount) throw Error(Errors.amountNotFound + ` ${destination}`);

  return amount;
}
