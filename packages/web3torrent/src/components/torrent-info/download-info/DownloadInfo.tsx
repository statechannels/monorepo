import React, {useContext} from 'react';
import './DownloadInfo.scss';
import {ProgressBar} from './progress-bar/ProgressBar';
import {TorrentUI} from '../../../types';
import {Web3TorrentClientContext} from '../../../clients/web3torrent-client';
import {track} from '../../../analytics';

export type DownloadInfoProps = {torrent: TorrentUI};

export const DownloadInfo: React.FC<DownloadInfoProps> = ({torrent}: DownloadInfoProps) => {
  const web3torrent = useContext(Web3TorrentClientContext);
  return (
    <section className="downloadingInfo">
      {!(torrent.done || torrent.paused) && (
        <>
          <ProgressBar
            downloaded={torrent.downloaded}
            length={torrent.length}
            status={torrent.status}
          />
          <button
            id="cancel-download-button"
            type="button"
            className="button cancel"
            onClick={() => {
              track('Torrent Cancelled', {
                infoHash: torrent.infoHash,
                magnetURI: torrent.magnetURI,
                filename: torrent.name,
                filesize: torrent.length
              });
              return web3torrent.cancel(torrent.infoHash);
            }}
          >
            Cancel Download
          </button>
        </>
      )}
    </section>
  );
};
