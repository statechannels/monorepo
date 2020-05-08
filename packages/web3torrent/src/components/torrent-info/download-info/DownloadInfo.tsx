import React from 'react';
import {cancel} from '../../../clients/web3torrent-client';
import './DownloadInfo.scss';
import {ProgressBar} from './progress-bar/ProgressBar';
import {TorrentUI} from '../../../types';

export type DownloadInfoProps = {torrent: TorrentUI};

export const DownloadInfo: React.FC<DownloadInfoProps> = ({torrent}: DownloadInfoProps) => (
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
          onClick={() => cancel(torrent.infoHash)}
        >
          Cancel Download
        </button>
      </>
    )}
  </section>
);
