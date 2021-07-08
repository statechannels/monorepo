import * as _ from 'lodash';
import Dexie, {Transaction, TransactionMode} from 'dexie';
import {
  Objective,
  DomainBudget,
  ChannelStoredData,
  AssetBudget,
  BN
} from '@statechannels/wallet-core';

import {unreachable} from '../utils';
import {logger} from '../logger';

import {ChannelStoreEntry} from './channel-store-entry';

import {DBBackend, ObjectStores, TXMode} from '.';

const STORES: ObjectStores[] = [
  ObjectStores.budgets,
  ObjectStores.channels,
  ObjectStores.ledgers,
  ObjectStores.nonces,
  ObjectStores.objectives,
  ObjectStores.privateKeys,
  ObjectStores.destinationAddress
];

// A running, functioning example can be seen and played with here: https://codesandbox.io/s/elastic-kare-m1jp8
export class Backend implements DBBackend {
  private _db: Dexie;

  constructor() {
    if (!indexedDB) {
      logger.error("Your browser doesn't support a stable version of IndexedDB.");
    }
  }
  /**
   * Initializes the Database and it's structure.
   * @param cleanSlate if true, it clears all the object stores of data
   * @param databaseName (optional) useful maybe for multiple tenants in the same page?
   */
  public async initialize(cleanSlate: boolean, databaseName: string) {
    const createdDB = await this.create(databaseName);

    if (cleanSlate) await Promise.all(STORES.map(this.clear.bind(this)));

    return createdDB;
  }

  private async create(databaseName: string) {
    this._db = new Dexie(databaseName, {indexedDB});
    this._db
      .version(3)
      .stores(
        _.reduce(
          STORES.map(s => ({[s]: ''})),
          _.merge
        )
      )
      .upgrade(tx => {
        const numberify = n => Number(BN.from(n));
        tx.table(ObjectStores.channels).each(
          ({key: channelId, value}: {key: string; value: ChannelStoredData}) => {
            const {challengeDuration, channelNonce} = value.channelConstants;

            value.channelConstants.challengeDuration = numberify(challengeDuration);
            value.channelConstants.channelNonce = numberify(channelNonce);
            value.stateVariables.map(s => (s.turnNum = numberify(s.turnNum)));

            this.setChannel(channelId, value);
          }
        );
        tx.table(ObjectStores.nonces).each(({key, value}) => this.setNonce(key, numberify(value)));
      });
  }

  public async clear(storeName: ObjectStores): Promise<string> {
    return this._db[storeName]?.clear();
  }

  // Generic Getters

  public async channels() {
    const channelData = (await this.getAll(ObjectStores.channels, true)) as {
      key: string;
      value: ChannelStoredData;
    }[];
    const channels = {};
    channelData.forEach(cd => {
      channels[cd.key] = ChannelStoreEntry.fromJson(cd.value);
    });
    return channels;
  }

  public async objectives() {
    return this.getAll(ObjectStores.objectives);
  }

  public async nonces() {
    const nonces = await this.getAll(ObjectStores.nonces);
    for (const key in nonces) {
      nonces[key] = nonces[key] ?? -1;
    }
    return nonces;
  }

  public async privateKeys() {
    return this.getAll(ObjectStores.privateKeys);
  }

  public async ledgers() {
    return this.getAll(ObjectStores.ledgers);
  }

  // Individual Getters
  public async getBudget(key: string): Promise<DomainBudget | undefined> {
    const budget: DomainBudget | undefined = await this.get(ObjectStores.budgets, key);
    if (!budget) return budget;

    return {
      ...budget,
      forAsset: _.mapValues(budget.forAsset, (assetBudget: AssetBudget) => ({
        asset: assetBudget.asset,
        availableReceiveCapacity: BN.from(assetBudget.availableReceiveCapacity),
        availableSendCapacity: BN.from(assetBudget.availableSendCapacity),
        channels: assetBudget.channels
      }))
    };
  }

  public async setBudget(key: string, value: DomainBudget) {
    const result = await this.put(ObjectStores.budgets, value, key);
    return result.value;
  }

  public async deleteBudget(key: string) {
    return this.delete(ObjectStores.budgets, key);
  }

  public async getChannel(key: string) {
    // TODO: This is typed to return ChannelStoredData, but it actually
    // returns ChannelStoreEntry.
    // This happens all over the place.
    const channel = await this.get(ObjectStores.channels, key);
    return channel && ChannelStoreEntry.fromJson(channel);
  }
  public async getObjective(key: number) {
    return this.get(ObjectStores.objectives, key);
  }
  public async getNonce(key: string) {
    return (await this.get(ObjectStores.nonces, key)) ?? -1;
  }
  public async getPrivateKey(key: string) {
    return this.get(ObjectStores.privateKeys, key);
  }
  public async getLedger(key: string) {
    return this.get(ObjectStores.ledgers, key);
  }

  public async getDestinationAddress() {
    return this.get(ObjectStores.destinationAddress, 0);
  }

  // Individual Setters

  public async setDestinationAddress(address: string) {
    return this.put(ObjectStores.destinationAddress, address, 0);
  }

  public async setPrivateKey(signingAddress: string, privateKey: string) {
    return this.put(ObjectStores.privateKeys, privateKey, signingAddress);
  }

  public async setChannel(key: string, value: ChannelStoredData) {
    return this.put(ObjectStores.channels, value, key);
  }

  public async setLedger(key: string, value: string) {
    return this.put(ObjectStores.ledgers, value, key);
  }
  public async setNonce(key: string, value: number) {
    await this.put(ObjectStores.nonces, value, key);

    return await this._db[ObjectStores.nonces].get(key);
  }
  public async setObjective(key: number, value: Objective) {
    return this.put(ObjectStores.objectives, value, Number(key)) as Promise<Objective>;
  }

  public get transactionOngoing() {
    return !!Dexie.currentTransaction;
  }

  public async transaction<T, S extends ObjectStores>(
    mode: TXMode,
    stores: S[],
    callback: (tx: Transaction) => Promise<T>
  ) {
    let dexieMode: TransactionMode;
    switch (mode) {
      case 'readwrite':
        dexieMode = 'rw';
        break;
      case 'readonly':
        dexieMode = 'r';
        break;
      default:
        return unreachable(mode);
    }

    try {
      return await this._db.transaction(dexieMode, stores, callback);
    } catch (error) {
      logger.error(
        {
          error: error.message ?? error,
          store: await this.dump(),
          callback: callback.toString().slice(0, 200) + '...}'
        },
        'Transaction error'
      );
      throw error;
    }
  }

  // Private Internal Methods

  /**
   * Gets all elements of a object store.
   * @param storeName
   * @param asArray if true, the result object, is transformed to an array
   */
  private async getAll(storeName: ObjectStores, asArray = false): Promise<any> {
    return asArray
      ? this._db[storeName].toArray()
      : _.mapValues(_.keyBy(await this._db[storeName].toArray(), 'key'), 'value');
  }

  /**
   * Gets an element from a object store
   * @param storeName
   * @param key required
   */
  private async get(storeName: ObjectStores, key: string | number): Promise<any> {
    try {
      return (await this._db[storeName].get(key))?.value;
    } catch (e) {
      if (/NotFoundError:/.test(e.message)) {
        logger.error('Attempting invalid access to store %s', storeName);
      }
      throw e;
    }
  }

  /**
   * Adds or replaces an element in a object store
   * @param storeName
   * @param value
   * @param key
   */
  private async put(storeName: ObjectStores, value: any, key: string | number): Promise<any> {
    await this._db[storeName].put({key, value}, key);

    return this._db[storeName].get(key);
  }

  /**
   * Deletes an element.
   * Not used, but added to have a complete CRUD, just in case.
   * @param storeName
   * @param key
   * @returns true on success, false on fail.
   */
  private async delete(storeName: ObjectStores, key: string | number): Promise<any> {
    return this._db[storeName].delete(key);
  }

  private async dump() {
    return this._db.transaction('r!', STORES, async () =>
      _.reduce(
        await Promise.all(
          STORES.map(async store => ({[store]: await this._db.table(store).toArray()}))
        ),
        _.merge
      )
    );
  }
}
