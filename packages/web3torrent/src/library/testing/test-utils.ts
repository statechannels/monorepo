import MemoryChunkStore from 'memory-chunk-store';
import fixtures from 'webtorrent-fixtures';
import {ChannelState} from '../../clients/payment-channel-client';
import {utils} from 'ethers';

export const defaultFile = new Blob([fixtures.leaves.content]);
export const defaultTorrentHash = fixtures.leaves.parsedTorrent.infoHash;
export const defaultFileMagnetURI = `${fixtures.leaves.magnetURI}&tr=${encodeURIComponent(
  process.env.TRACKER_URL as string
)}`;
export const defaultSeedingOptions = (randomizeName = true) => ({
  name: (randomizeName ? Math.random() * 1000 : '') + 'Leaves of Grass by Walt Whitman.epub',
  announce: [process.env.TRACKER_URL],
  store: MemoryChunkStore
});

export const defaultLeechingOptions = {
  name: 'Leaves of Grass by Walt Whitman.epub',
  store: MemoryChunkStore
};

export function mockMetamask() {
  async function enable() {
    return new Promise(r => r());
  }
  async function disable() {
    return new Promise(r => r());
  }

  const ethereum = {
    enable,
    disable,
    selectedAddress: '0x0'
  };
  // mock out window.ethereum.enable
  Object.defineProperty(window, 'ethereum', {
    enumerable: true,
    value: ethereum
  });
}

export const mockChannelState: ChannelState = {
  channelId: '0x0',
  turnNum: utils.bigNumberify(0),
  status: 'running',
  challengeExpirationTime: '0x0',
  beneficiary: '0x0',
  payer: '0x0',
  beneficiaryOutcomeAddress: '0x0',
  payerOutcomeAddress: '0x0',
  beneficiaryBalance: '0x0',
  payerBalance: '0x0'
};
