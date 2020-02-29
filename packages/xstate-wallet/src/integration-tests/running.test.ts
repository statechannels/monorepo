import {FakeChain} from '../chain';
import {Player, hookUpMessaging, generatePlayerUpdate} from './helpers';
import {SimpleEthAllocation} from '../store/types';
jest.setTimeout(30000);
import waitForExpect from 'wait-for-expect';
import {toHex} from '../utils/hex-number-utils';

test('accepts states when running', async () => {
  const fakeChain = new FakeChain();

  const playerA = new Player(
    '0x275a2e2cd9314f53b42246694034a80119963097e3adf495fbf6d821dc8b6c8e',
    'PlayerA',
    fakeChain
  );
  const playerB = new Player(
    '0x3341c348ea8ade1ba7c3b6f071bfe9635c544b7fb5501797eaa2f673169a7d0d',
    'PlayerB',
    fakeChain
  );
  const outcome: SimpleEthAllocation = {
    allocationItems: [
      {
        destination: playerA.destination,
        amount: toHex('0x06f05b59d3b20000')
      },
      {
        destination: playerA.destination,
        amount: toHex('0x06f05b59d3b20000')
      }
    ],
    type: 'SimpleEthAllocation'
  };

  hookUpMessaging(playerA, playerB);
  const stateVars = {
    outcome,
    turnNum: toHex('0x4'),
    appData: '0x0',
    isFinal: false
  };
  playerA.store.createChannel([playerA.participant, playerB.participant], toHex('0x4'), stateVars);
  const channelId = '0x1823994d6d3b53b82f499c1aca2095b94108ba3ff59f55c6e765da1e24874ab2';
  playerA.startAppWorkflow('running', {channelId});
  playerB.startAppWorkflow('running', {channelId});
  await playerA.messagingService.receiveMessage(
    generatePlayerUpdate(channelId, playerA.participant, playerB.participant)
  );

  await waitForExpect(async () => {
    expect(playerA.workflowState).toEqual('running');
    expect(playerB.workflowState).toEqual('running');
    const playerATurnNum = (await playerA.store.getEntry(channelId)).latest.turnNum;
    expect(playerATurnNum).toBe(toHex(5));
    const playerBTurnNum = (await playerB.store.getEntry(channelId)).latest.turnNum;
    expect(playerBTurnNum).toBe(toHex(5));
  }, 3000);

  await playerB.messagingService.receiveMessage(
    generatePlayerUpdate(channelId, playerA.participant, playerB.participant)
  );
  await waitForExpect(async () => {
    expect(playerA.workflowState).toEqual('running');
    expect(playerB.workflowState).toEqual('running');
    const playerATurnNum = (await playerA.store.getEntry(channelId)).latest.turnNum;
    expect(playerATurnNum).toBe(toHex(6));
    const playerBTurnNum = (await playerB.store.getEntry(channelId)).latest.turnNum;
    expect(playerBTurnNum).toBe(toHex(6));
  }, 3000);
});
