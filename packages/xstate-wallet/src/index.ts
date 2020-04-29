import {ChannelWallet} from './channel-wallet';
import {MessagingService} from './messaging';
import {ChainWatcher} from './chain';
import {MemoryBackend} from './store/memory-backend';
import {Store} from './store';

import Url from 'url-parse';
import './render';

import {logger} from './logger';
import {Backend} from './store/dexie-backend';
import {CLEAR_STORAGE_ON_START, USE_INDEXED_DB, ADD_LOGS} from './config';

const log = logger.info.bind(logger);

(async function() {
  const chain = new ChainWatcher();

  const backend = USE_INDEXED_DB ? new Backend() : new MemoryBackend();
  const store = new Store(chain, backend);

  await store.initialize([], CLEAR_STORAGE_ON_START);
  const messagingService = new MessagingService(store);
  const channelWallet = new ChannelWallet(store, messagingService);

  // Communicate via postMessage
  window.addEventListener('message', event => {
    if (event.data && event.data.jsonrpc && event.data.jsonrpc === '2.0') {
      ADD_LOGS && log({jsonRpcRequest: event.data}, 'INCOMING JSONRPC REQUEST:');
      const {host} = new Url(event.origin);
      channelWallet.pushMessage(event.data, host);
    }
  });
  channelWallet.onSendMessage(message => {
    window.parent.postMessage(message, '*');
    ADD_LOGS && log({jsonRpcResponse: message}, 'OUTGOING JSONRPC REQUEST:');
  });

  window.parent.postMessage('WalletReady', '*');
})();
