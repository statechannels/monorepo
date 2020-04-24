import Enzyme, {mount, ReactWrapper} from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import React from 'react';
import {TorrentFile} from 'webtorrent';

import {TorrentUI} from '../../../types';
import {createMockTorrentUI} from '../../../utils/test-utils';
import {getFormattedETA} from '../../../utils/torrent-status-checker';
import {DownloadInfo, DownloadInfoProps} from './DownloadInfo';
import {ProgressBar, ProgressBarProps} from './progress-bar/ProgressBar';
import {
  mockTorrentClientContext,
  MockContextProvider
} from '../../../library/testing/mock-context-provider';

Enzyme.configure({adapter: new Adapter()});

type MockDownloadInfo = {
  downloadInfoWrapper: ReactWrapper<DownloadInfoProps>;
  torrentProps: Partial<TorrentUI>;
  downloadInfoContainer: ReactWrapper;
  progressBarElement: ReactWrapper<ProgressBarProps>;
  textElement: ReactWrapper;
  cancelButton: ReactWrapper;
};

const mockDownloadInfo = (torrentProps?: Partial<TorrentUI>): MockDownloadInfo => {
  const torrent = createMockTorrentUI(torrentProps);
  const downloadInfoWrapper = mount(
    <MockContextProvider>
      <DownloadInfo torrent={torrent} channelCache={{}} mySigningAddress="0x0" />
    </MockContextProvider>
  );

  return {
    downloadInfoWrapper,
    torrentProps: torrent,
    downloadInfoContainer: downloadInfoWrapper.find('.downloadingInfo'),
    progressBarElement: downloadInfoWrapper.find(ProgressBar),
    textElement: downloadInfoWrapper.find('.downloadingInfo > p'),
    cancelButton: downloadInfoWrapper.find('.cancel')
  };
};

describe('<DownloadInfo />', () => {
  let downloadInfo: MockDownloadInfo;

  beforeEach(() => {
    downloadInfo = mockDownloadInfo({
      parsedTimeRemaining: getFormattedETA(false, 3000),
      numPeers: 3,
      downloadSpeed: 10240,
      uploadSpeed: 5124
    });
  });

  it('can be instantiated', () => {
    const {
      downloadInfoContainer,
      progressBarElement,
      textElement,
      torrentProps,
      cancelButton
    } = downloadInfo;

    expect(downloadInfoContainer.exists()).toEqual(true);
    expect(progressBarElement.exists()).toEqual(true);
    expect(textElement.exists()).toEqual(true);
    expect(cancelButton.exists()).toEqual(true);

    expect(progressBarElement.props()).toEqual({
      downloaded: torrentProps.downloaded,
      length: torrentProps.length,
      status: torrentProps.status
    });
    expect(textElement.html()).toEqual(
      `<p>ETA 3s. 10 KB/s down, 5.1 KB/s up<br>Connected to <strong>3</strong> peers.</p>`
    );
  });

  it('can call Web3TorrentClient.cancel() when clicking the Cancel button', () => {
    const {cancelButton} = downloadInfo;

    cancelButton.simulate('click');
    expect(mockTorrentClientContext.cancel).toHaveBeenCalledWith(
      downloadInfo.torrentProps.infoHash
    );
  });

  it('hides the cancel button when finished', () => {
    const {cancelButton} = mockDownloadInfo({
      downloaded: 128913,
      done: true,
      files: [({getBlobURL: resolve => resolve(null, 'blob')} as unknown) as TorrentFile]
    });
    expect(cancelButton.exists()).toEqual(false);
  });
});
