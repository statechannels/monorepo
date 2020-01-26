import {interpret} from 'xstate';
import {ethers} from 'ethers';
import waitForExpect from 'wait-for-expect';
import {
  Store,
  CreateChannelEvent,
  ConcludeChannel,
  SendStates,
  getChannelId,
  OpenChannelEvent,
  Channel,
  JoinChannel
} from '@statechannels/wallet-protocols';
import {applicationWorkflow} from '../application';
import {AddressZero} from 'ethers/constants';
import {
  findCalledActions,
  generateParticipant,
  generateAllocations
} from '../../utils/test-helpers';
let closingMachineMock;
let joinMachineMock;
beforeEach(() => {
  // TODO: Is this the best way to mock
  closingMachineMock = jest.fn().mockReturnValue(new Promise(() => {}));
  Object.defineProperty(ConcludeChannel, 'machine', {
    value: closingMachineMock
  });

  joinMachineMock = jest.fn().mockReturnValue(new Promise(() => {}));
  Object.defineProperty(JoinChannel, 'machine', {
    value: joinMachineMock
  });
});

jest.setTimeout(50000);

it('initializes and starts the create channel machine', async () => {
  const walletA = ethers.Wallet.createRandom();
  const walletB = ethers.Wallet.createRandom();
  const store = new Store({privateKeys: {[walletA.address]: walletA.privateKey}});
  const event: CreateChannelEvent = {
    type: 'CREATE_CHANNEL',
    chainId: '0x0',
    appData: '0x0',
    appDefinition: ethers.constants.AddressZero,
    participants: [generateParticipant(walletA), generateParticipant(walletB)],
    allocations: generateAllocations(walletA, walletB),
    challengeDuration: 500
  };
  const service = interpret<any, any, any>(applicationWorkflow(store, undefined));

  service.start();

  await waitForExpect(async () => {
    expect(service.state.value).toEqual('initializing');
  }, 2000);

  service.send(event);

  await waitForExpect(async () => {
    expect(service.state.value).toEqual('create');
    expect(service.state.children.createMachine).toBeDefined();
    expect(service.state.actions.map(a => a.type)).toContain('displayUi');
  }, 2000);
});
it('initializes and starts the join channel machine', async () => {
  const store = new Store();
  const channel: Channel = {chainId: '0x0', channelNonce: '0x0', participants: []};
  const event: OpenChannelEvent = {
    type: 'OPEN_CHANNEL',
    participants: [],
    signedState: {
      state: {
        turnNum: 0,
        appData: '0x0',
        appDefinition: '0x0',
        outcome: [],
        isFinal: false,
        channel,
        challengeDuration: 500
      },
      signatures: []
    }
  };
  const service = interpret<any, any, any>(applicationWorkflow(store, undefined));

  service.start();

  await waitForExpect(async () => {
    expect(service.state.value).toEqual('initializing');
  }, 2000);

  service.send(event);

  await waitForExpect(async () => {
    expect(service.state.value).toEqual('join');
    expect(joinMachineMock).toHaveBeenCalled();
    expect(findCalledActions(service.state)).toContainEqual({
      actionType: 'displayUi',
      stateType: 'join'
    });
    expect(service.state.context.channelId).toEqual(getChannelId(channel));
  }, 2000);
});
it('starts concluding when requested', async () => {
  const store = new Store();
  const channelId = ethers.utils.id('channel');
  const service = interpret<any, any, any>(applicationWorkflow(store, {channelId}));
  service.start('running');
  service.send({type: 'PLAYER_REQUEST_CONCLUDE', channelId});
  await waitForExpect(async () => {
    expect(service.state.value).toEqual('closing');
    expect(closingMachineMock).toHaveBeenCalled();
    expect(service.state.actions.map(a => a.type)).toContain('displayUi');
  }, 2000);
});

it('starts concluding when receiving a final state', async () => {
  const store = new Store();
  const sendStates: SendStates = {
    type: 'SendStates',
    signedStates: [
      {
        state: {
          isFinal: true,
          appDefinition: AddressZero,
          appData: '0x0',
          outcome: [],
          turnNum: 55,
          challengeDuration: 500,
          channel: {chainId: '0x0', channelNonce: '0x0', participants: []}
        },
        signatures: []
      }
    ]
  };
  store.receiveStates = jest.fn();
  const channelId = getChannelId(sendStates.signedStates[0].state.channel);
  const service = interpret<any, any, any>(applicationWorkflow(store, {channelId}));
  service.start('running');

  service.send(sendStates);

  await waitForExpect(async () => {
    expect(store.receiveStates).toHaveBeenCalled();
    expect(service.state.value).toEqual('closing');
    expect(closingMachineMock).toHaveBeenCalled();
    expect(findCalledActions(service.state)).toContainEqual({
      actionType: 'displayUi',
      stateType: 'closing'
    });
  }, 2000);
});
