import {Worker} from 'worker_threads';
import path from 'path';

import {Pool} from 'tarn';
import {UpdateChannelParams} from '@statechannels/client-api-schema';
import {Either} from 'fp-ts/lib/Either';
import {isLeft} from 'fp-ts/lib/These';
import _ from 'lodash';
import {Logger} from 'pino';

import {ServerWalletConfig} from '../../config';
import {createLogger} from '../../logger';
import {MultipleChannelOutput, SingleChannelOutput} from '../types';

import {StateChannelWorkerData} from './worker-data';

const ONE_DAY = 86400000;

export class WorkerManager {
  private pool?: Pool<Worker>;
  private threadAmount: number;
  private logger: Logger;
  constructor(walletConfig: ServerWalletConfig) {
    this.logger = createLogger(walletConfig).child({module: 'Worker-Manager'});
    this.threadAmount = walletConfig.workerThreadAmount;
    if (this.threadAmount > 0) {
      this.pool = new Pool({
        create: (): Worker => {
          this.logger.trace('Starting worker');

          const worker = new Worker(path.resolve(__dirname, './loader.js'), {
            workerData: walletConfig,
          });

          worker.on('error', err => {
            throw err;
          });
          this.logger.trace('Started worker %o', worker.threadId);
          return worker;
        },
        destroy: (worker: Worker): Promise<number> => worker.terminate(),
        min: this.threadAmount,
        max: this.threadAmount,
        reapIntervalMillis: ONE_DAY,
        idleTimeoutMillis: ONE_DAY,
      });
    }
  }
  public async warmUpThreads(): Promise<void> {
    this.logger.trace('Warming up threads');
    const acquire = _.range(this.threadAmount).map(() => this.pool?.acquire().promise);
    const workers = await Promise.all(acquire);
    workers.forEach(w => {
      if (w) this.pool?.release(w);
      else throw Error('No worker acquired');
    });
  }
  public async pushMessage(args: unknown): Promise<MultipleChannelOutput> {
    this.logger.trace('PushMessage called');
    if (!this.pool) throw new Error(`Worker threads are disabled`);
    const worker = await this.pool.acquire().promise;
    const data: StateChannelWorkerData = {operation: 'PushMessage', args};
    const resultPromise = new Promise<MultipleChannelOutput>((resolve, reject) =>
      worker.once('message', (response: Either<Error, MultipleChannelOutput>) => {
        this.pool?.release(worker);

        if (isLeft(response)) {
          reject(response.left);
        } else {
          resolve(response.right);
        }
      })
    );

    worker.postMessage(data);

    return resultPromise;
  }

  public async pushUpdate(args: unknown): Promise<SingleChannelOutput> {
    this.logger.trace('PushUpdate called');
    if (!this.pool) throw new Error(`Worker threads are disabled`);
    const worker = await this.pool.acquire().promise;
    const data: StateChannelWorkerData = {operation: 'PushUpdate', args};
    const resultPromise = new Promise<SingleChannelOutput>((resolve, reject) =>
      worker.once('message', (response: Either<Error, SingleChannelOutput>) => {
        this.pool?.release(worker);

        if (isLeft(response)) {
          reject(response.left);
        } else {
          resolve(response.right);
        }
      })
    );

    worker.postMessage(data);

    return resultPromise;
  }

  public async updateChannel(args: UpdateChannelParams): Promise<SingleChannelOutput> {
    this.logger.trace('UpdateChannel called');
    if (!this.pool) throw new Error(`Worker threads are disabled`);
    const worker = await this.pool.acquire().promise;
    const data: StateChannelWorkerData = {operation: 'UpdateChannel', args};
    const resultPromise = new Promise<SingleChannelOutput>((resolve, reject) =>
      worker.once('message', (response: Either<Error, SingleChannelOutput>) => {
        this.pool?.release(worker);
        if (isLeft(response)) {
          this.logger.error(response);
          reject(response.left);
        } else {
          resolve(response.right);
        }
      })
    );

    worker.postMessage(data);

    return resultPromise;
  }

  public async destroy(): Promise<void> {
    await this.pool?.destroy();
  }
}
