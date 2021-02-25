import {providers, constants} from 'ethers';
import {Address, PrivateKey, SignedState, State} from '@statechannels/wallet-core';

import {Bytes32} from '../type-aliases';

import {ChainEventSubscriberInterface, ChainServiceInterface, FundChannelArg} from './';

const mockTransactionReceipt: providers.TransactionReceipt = {
  to: '',
  from: '',
  contractAddress: '',
  transactionIndex: 0,
  gasUsed: constants.Zero,
  logsBloom: '',
  blockHash: '',
  transactionHash: '',
  logs: [],
  blockNumber: 0,
  confirmations: 0,
  cumulativeGasUsed: constants.Zero,
  byzantium: false,
};

const mockTransactoinResponse: providers.TransactionResponse = {
  hash: '',
  confirmations: 0,
  from: '',
  wait: (_confirmations?: number): Promise<providers.TransactionReceipt> =>
    Promise.resolve(mockTransactionReceipt),
  nonce: 0,
  gasLimit: constants.Zero,
  gasPrice: constants.Zero,
  data: '',
  value: constants.Zero,
  chainId: 0,
};

export class MockChainService implements ChainServiceInterface {
  async checkChainId(_networkChainId: number): Promise<void> {
    // noop, a mock chain service will have the "correct" chain id
  }

  fundChannel(_arg: FundChannelArg): Promise<providers.TransactionResponse> {
    return Promise.resolve(mockTransactoinResponse);
  }

  registerChannel(
    _channelId: Bytes32,
    _assetHolders: Address[],
    _subscriber: ChainEventSubscriberInterface
  ): void {
    return;
  }

  unregisterChannel(_channelId: Bytes32): void {
    return;
  }

  concludeAndWithdraw(_finalizationProof: SignedState[]): Promise<providers.TransactionResponse> {
    return Promise.resolve(mockTransactoinResponse);
  }

  pushOutcomeAndWithdraw(
    _state: State,
    _challengerAddress: Address
  ): Promise<providers.TransactionResponse> {
    return Promise.resolve(mockTransactoinResponse);
  }

  challenge(
    _challengeStates: SignedState[],
    _privateKey: PrivateKey
  ): Promise<providers.TransactionResponse> {
    return Promise.resolve(mockTransactoinResponse);
  }

  async fetchBytecode(_appDefinition: string): Promise<string> {
    return '0x0';
  }

  destructor(): void {
    return;
  }
}
export class ErorringMockChainService extends MockChainService {
  pushOutcomeAndWithdraw(
    _state: State,
    _challengerAddress: Address
  ): Promise<providers.TransactionResponse> {
    throw new Error('Failed to submit transaction');
  }
}
