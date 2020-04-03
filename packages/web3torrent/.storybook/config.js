import {configure} from '@storybook/react';
import {Web3TorrentContext, web3torrent} from '../../../clients/web3torrent-client';

configure(require.context('../src', true, /\.stories\.tsx$/), module);

const contextWrapper = storyFn => (
  <Web3TorrentContext.Provider value={web3torrent}>{storyFn()}</Web3TorrentContext.Provider>
);

addDecorator(contextWrapper);
