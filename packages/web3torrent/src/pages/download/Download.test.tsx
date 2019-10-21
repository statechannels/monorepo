import Enzyme, {mount} from 'enzyme';
import Adapter from 'enzyme-adapter-react-16';
import {createMemoryHistory} from 'history';
import React from 'react';
import {MemoryRouter as Router, RouteComponentProps} from 'react-router-dom';
import {JsonRPCResponse} from 'web3/providers';
import {testSelector} from '../../utils/test-utils';
import * as EmbeddedWalletClient from './../../clients/embedded-wallet-client';
import Download from './Download';
import * as TorrentStatus from '../../utils/torrent-status-checker';
import * as Web3TorrentClient from './../../clients/web3torrent-client';
import {EmptyTorrent} from '../../constants';
import {Torrent, Status} from '../../types';
import {WebTorrentAddInput} from '../../library/types';
import {act} from 'react-dom/test-utils';

const mockDownloadURL =
  '/download/magnet#magnet:?xt=urn%3Abtih%3A148c62a7f7845c91e7d16ca9be85de6fbaed3a1f&dn=test.zip&xl=1398978&cost=0';

const mockResponse: JsonRPCResponse = {jsonrpc: '2.0', id: 123};

Enzyme.configure({adapter: new Adapter()});

function setup() {
  const history = createMemoryHistory({initialEntries: [mockDownloadURL]});
  const props: RouteComponentProps = {
    history,
    location: history.location,
    match: {
      isExact: true,
      params: {},
      path: '/',
      url: 'http://localhost/'
    }
  };

  const askForFunds = jest
    .spyOn(EmbeddedWalletClient, 'askForFunds')
    .mockImplementation(() => Promise.resolve(mockResponse));

  const torrentDownload = jest
    .spyOn(Web3TorrentClient, 'download')
    .mockImplementation(_pD => Promise.resolve({...EmptyTorrent, status: Status.Connecting}));

  const component = mount(
    <Router>
      <Download {...props} />
    </Router>
  );

  return {props, component, askForFunds, torrentDownload};
}

describe('<Download />', () => {
  let component: Enzyme.ReactWrapper;
  let askForFunds: jest.SpyInstance<Promise<JsonRPCResponse>, []>;
  let torrentDownload: jest.SpyInstance<Promise<Torrent>, [WebTorrentAddInput]>;

  beforeEach(() => {
    const mock = setup();
    component = mock.component;
    askForFunds = mock.askForFunds;
    torrentDownload = mock.torrentDownload;
    jest.useFakeTimers();
  });

  it('should render an Download button', () => {
    expect(component.find(testSelector('download-button')).text()).toBe('Start Download');
  });

  it('should run askForFunds functions when the Download Button is clicked', async () => {
    await act(async () => {
      await component.find(testSelector('download-button')).simulate('click');
    });
    expect(askForFunds).toHaveBeenCalled();
    expect(torrentDownload).toHaveBeenCalled();
  });

  it('should run checker function if the Download Button is clicked', async () => {
    const torrentStatusChecker = jest
      .spyOn(TorrentStatus, 'default')
      .mockImplementation((_pD: Torrent, _iH: any) => EmptyTorrent);

    await act(async () => {
      await component.find(testSelector('download-button')).simulate('click');
    });

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(torrentStatusChecker).toHaveBeenCalled();
  });
});
