import {interpret} from 'xstate';
import {ethers} from 'ethers';
import waitForExpect from 'wait-for-expect';
import {AddressZero} from 'ethers/constants';
import {XstateStore} from '../../store';
import {StateVariables, SignedState, isOpenChannel} from '../../store/types';
import {ChannelStoreEntry} from '../../store/channel-store-entry';
import {MessagingService, MessagingServiceInterface} from '../../messaging';
import {bigNumberify} from 'ethers/utils';
import {calculateChannelId} from '../../store/state-utils';
import {simpleEthAllocation, exists} from '../../utils';
import {ChannelUpdated, JoinChannelEvent} from '../../event-types';
import {Application} from '..';
import {participants, wallet1} from './data';
import {filter, first, map} from 'rxjs/operators';

jest.setTimeout(10000);

describe('Channel setup, CREATE_CHANNEL role', () => {
  test('with direct funding strategy', async () => {
    const context: Application.Init = {
      type: 'CREATE_CHANNEL',
      chainId: '0x0',
      appData: '0x0',
      appDefinition: ethers.constants.AddressZero,
      participants,
      outcome: simpleEthAllocation([]),
      challengeDuration: bigNumberify(500),
      requestId: 5,
      fundingStrategy: 'Direct',
      applicationSite: 'localhost'
    };

    const store = new XstateStore();
    await store.initialize([wallet1.privateKey]);
    const messagingService = new MessagingService(store);

    const spy = jest.fn(x => x);
    const service = interpret<any, any, any>(
      Application.workflow(store, messagingService, context).withConfig({
        services: {
          invokeCreateChannelAndFundProtocol: () =>
            new Promise(r => spy('Channel was funded') && r())
        }
      })
    );

    service.start();

    // It invokes confirmingWithUser
    await waitForExpect(
      async () => expect(service.state.value).toEqual('confirmingWithUser'),
      2000
    );

    const objective = store.outboxFeed
      .pipe(
        map(m => m.objectives),
        filter(exists),
        map(objectives => objectives[0]),
        filter(isOpenChannel),
        first()
      )
      .toPromise();

    service.state.children.invokeCreateChannelConfirmation.send({type: 'USER_APPROVES'});

    const result = await objective;
    expect(result).toMatchObject({type: 'OpenChannel'});

    await waitForExpect(() => expect(service.state.value).toEqual('running'));

    expect(spy).toHaveBeenLastCalledWith('Channel was funded');
  });
});

describe('Channel setup, JOIN_CHANNEL role', () => {
  test('with direct funding strategy', async () => {
    const channelId = '0xabc';
    const context: Application.Init = {
      fundingStrategy: 'Direct',
      channelId,
      type: 'JOIN_CHANNEL',
      applicationSite: 'localhost'
    };

    const store = new XstateStore();
    await store.initialize();
    const messagingService = new MessagingService(store);

    const spy = jest.fn(x => x);

    const enum expectations {
      channelFunded = 'Channel was funded',
      siteSet = 'applicationSite was set'
    }
    const service = interpret<any, any, any>(
      Application.workflow(store, messagingService, context).withConfig({
        actions: {sendJoinChannelResponse: spy, sendUpdateChannelResponse: spy},
        services: {
          invokeCreateChannelAndFundProtocol: () =>
            new Promise(resolve => spy(expectations.channelFunded) && resolve()),
          setApplicationSite: () => new Promise(resolve => spy(expectations.siteSet) && resolve())
        }
      })
    );

    service.start();

    await waitForExpect(
      async () => expect(service.state.value).toEqual({joiningChannel: 'joining'}),
      2000
    );

    const joinEvent: JoinChannelEvent = {
      type: 'JOIN_CHANNEL',
      channelId,
      requestId: 5,
      applicationSite: 'localhost'
    };

    service.send(joinEvent);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy).toHaveBeenCalledWith(context, joinEvent, expect.any(Object));
    expect(spy).toHaveBeenCalledWith(expectations.siteSet);

    // It invokes confirmingWithUser
    await waitForExpect(async () => {
      expect(service.state.value).toEqual('confirmingWithUser');
    }, 2000);

    service.state.children.invokeCreateChannelConfirmation.send({type: 'USER_APPROVES'});

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith(expectations.channelFunded);
    await waitForExpect(() => expect(service.state.value).toEqual('running'));
  });
});

it('raises an channel updated action when the channel is updated', async () => {
  const store = new XstateStore();
  await store.initialize();
  const messagingService: MessagingServiceInterface = new MessagingService(store);
  const mockOptions = {
    actions: {
      sendChannelUpdatedNotification: jest.fn()
    }
  };
  const service = interpret<any, any, any>(
    Application.workflow(store, messagingService).withConfig(mockOptions, {
      fundingStrategy: 'Direct',
      applicationSite: 'localhost'
    })
  );
  service.start();

  service.send({
    type: 'CHANNEL_UPDATED',
    channelId: '0x0'
  });

  await waitForExpect(async () => {
    expect(mockOptions.actions.sendChannelUpdatedNotification).toHaveBeenCalled();
  }, 2000);
});

it('starts concluding when requested', async () => {
  const store = new XstateStore();
  await store.initialize();
  const messagingService: MessagingServiceInterface = new MessagingService(store);
  const channelId = ethers.utils.id('channel');
  const services: Partial<Application.WorkflowServices> = {
    invokeClosingProtocol: jest.fn().mockReturnValue(
      new Promise(() => {
        /* mock */
      })
    )
  };
  const actions: Partial<Application.WorkflowActions> = {
    sendCloseChannelResponse: jest.fn().mockReturnValue(
      new Promise(() => {
        /* mock */
      })
    )
  };
  const service = interpret<any, any, any>(
    Application.workflow(store, messagingService).withConfig(
      {services, actions} as any, // TODO: Casting
      {fundingStrategy: 'Direct', applicationSite: 'localhost'}
    )
  );
  service.start('running');
  service.send({type: 'PLAYER_REQUEST_CONCLUDE', channelId});
  await waitForExpect(async () => {
    expect(service.state.value).toEqual('closing');
    expect(services.invokeClosingProtocol).toHaveBeenCalled();
    expect(service.state.actions.map(a => a.type)).toContain('displayUi');
  }, 2000);
});

it('starts challenging when requested', async () => {
  const store = new XstateStore();
  await store.initialize();
  const messagingService: MessagingServiceInterface = new MessagingService(store);
  const channelId = ethers.utils.id('channel');
  const services: Partial<Application.WorkflowServices> = {
    invokeChallengingProtocol: jest.fn().mockReturnValue(
      new Promise(() => {
        /* mock */
      })
    )
  };
  const actions: Partial<Application.WorkflowActions> = {
    sendChallengeChannelResponse: jest.fn().mockReturnValue(
      new Promise(() => {
        /* mock */
      })
    )
  };
  const service = interpret<any, any, any>(
    Application.workflow(store, messagingService).withConfig({services, actions} as any, {
      fundingStrategy: 'Direct',
      applicationSite: 'localhost'
    })
  );
  service.start('running');
  service.send({type: 'PLAYER_REQUEST_CHALLENGE', channelId});
  await waitForExpect(async () => {
    expect(service.state.value).toEqual('sendChallenge');
    expect(services.invokeChallengingProtocol).toHaveBeenCalled();
    expect(service.state.actions.map(a => a.type)).toContain('displayUi');
  }, 2000);
});

// TODO: (liam) I don't think `states` matters in this test, channelid could be any string
it('starts concluding when receiving a final state', async () => {
  const store = new XstateStore();
  await store.initialize();
  const messagingService: MessagingServiceInterface = new MessagingService(store);
  const states: SignedState[] = [
    {
      isFinal: true,
      appDefinition: AddressZero,
      appData: '0x0',
      outcome: simpleEthAllocation([]),
      turnNum: bigNumberify(55),
      challengeDuration: bigNumberify(500),
      chainId: '0x0',
      channelNonce: bigNumberify('0x0'),
      participants: [],
      signatures: [{signature: '0x0', signer: '0x0'}]
    }
  ];
  const services: Partial<Application.WorkflowServices> = {
    invokeClosingProtocol: jest.fn().mockReturnValue(
      new Promise(() => {
        /* mock */
      })
    )
  };
  const channelId = calculateChannelId(states[0]);
  const channelUpdate: ChannelUpdated = {
    type: 'CHANNEL_UPDATED',
    requestId: 5,
    storeEntry: {
      latest: {isFinal: true} as StateVariables
    } as ChannelStoreEntry
  };

  const service = interpret<any, any, any>(
    Application.workflow(store, messagingService).withConfig(
      {services} as any, //TODO: Casting
      {channelId, fundingStrategy: 'Direct', applicationSite: 'localhost'}
    )
  );
  service.start('running');

  service.send(channelUpdate);

  await waitForExpect(async () => {
    expect(service.state.value).toEqual('closing');
    expect(services.invokeClosingProtocol).toHaveBeenCalled();
  });
});
