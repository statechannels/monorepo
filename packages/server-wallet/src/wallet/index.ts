export {WalletEvent, SingleChannelOutput, MultipleChannelOutput} from './types';

import {IncomingServerWalletConfig} from '../config';

import {MultiThreadedWallet} from './multi-threaded-wallet';
import {SingleThreadedWallet} from './wallet';

export type Wallet = SingleThreadedWallet | MultiThreadedWallet;

export const Wallet = {
  create(walletConfig: IncomingServerWalletConfig): Wallet {
    if (walletConfig?.workerThreadAmount && walletConfig.workerThreadAmount > 0) {
      return MultiThreadedWallet.create(walletConfig);
    } else {
      return SingleThreadedWallet.create(walletConfig);
    }
  },
};

export * from '../config';
