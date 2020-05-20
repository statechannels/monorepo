import WebTorrent, {TorrentOptions} from 'webtorrent';
import {PaidStreamingTorrent, WebTorrentAddInput, WebTorrentSeedInput} from '../library/types';
import {TorrentCallback} from '../library/web3torrent-lib';
import {Status} from '../types';
import {createMockExtendedTorrent, createMockTorrentPeers, pseAccount} from '../utils/test-utils';
import {download, getTorrentPeers, upload, web3TorrentClient} from './web3torrent-client';
import {getStatus} from '../utils/torrent-status-checker';

describe('Web3TorrentClient', () => {
  describe('download()', () => {
    let torrent: WebTorrent.Torrent;
    let addSpy: jest.SpyInstance<
      PaidStreamingTorrent,
      [
        WebTorrentAddInput,
        (WebTorrent.TorrentOptions | TorrentCallback | undefined)?,
        (TorrentCallback | undefined)?
      ]
    >;

    beforeEach(() => {
      torrent = createMockExtendedTorrent();
      addSpy = jest
        .spyOn(web3TorrentClient, 'add')
        .mockImplementation(
          (_: WebTorrentAddInput, callback: TorrentOptions | TorrentCallback | undefined) => {
            return (callback as TorrentCallback)(torrent as PaidStreamingTorrent);
          }
        );
    });

    afterAll(() => {
      web3TorrentClient.destroy();
    });

    it('should return a torrent with a status of Connecting', async () => {
      torrent = createMockExtendedTorrent({createdBy: 'random'});
      const {magnetURI} = torrent;

      const result = await download(magnetURI as WebTorrentAddInput);

      expect(addSpy).toHaveBeenCalled();
      expect(result.magnetURI).toEqual(magnetURI);
      expect(getStatus(torrent, pseAccount)).toEqual(Status.Connecting);
    });

    afterEach(() => {
      addSpy.mockRestore();
    });
  });

  describe('upload()', () => {
    let torrent: WebTorrent.Torrent;
    let seedSpy: jest.SpyInstance<
      PaidStreamingTorrent,
      [
        WebTorrentSeedInput,
        (WebTorrent.TorrentOptions | TorrentCallback | undefined)?,
        (TorrentCallback | undefined)?
      ]
    >;

    beforeEach(() => {
      torrent = createMockExtendedTorrent();
      seedSpy = jest
        .spyOn(web3TorrentClient, 'seed')
        .mockImplementation(
          (
            _: WebTorrentSeedInput,
            __?: TorrentOptions | TorrentCallback,
            callback?: TorrentCallback
          ) => {
            return (callback as TorrentCallback)(torrent as PaidStreamingTorrent);
          }
        );
    });

    it('should return a torrent with a status of Seeding', async () => {
      const mockBuffer = Buffer.from(new Array(torrent.length)).fill(
        Math.ceil(Math.random() * 255)
      );

      const result = await upload(mockBuffer);

      expect(seedSpy).toHaveBeenCalled();
      expect(result.length).toEqual(torrent.length);
      expect(getStatus(result, pseAccount)).toEqual(Status.Seeding);
    });

    afterEach(() => {
      seedSpy.mockRestore();
    });
  });

  describe('getTorrentPeers()', () => {
    const mockInfoHash = '124203';

    beforeEach(() => {
      web3TorrentClient.peersList[mockInfoHash] = createMockTorrentPeers();
    });

    it('should return peers for a given torrent', () => {
      expect(getTorrentPeers(mockInfoHash)).toEqual(web3TorrentClient.peersList[mockInfoHash]);
    });

    afterEach(() => {
      web3TorrentClient.peersList = {};
    });
  });
});
