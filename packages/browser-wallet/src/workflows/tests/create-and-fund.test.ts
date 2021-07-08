import {interpret} from 'xstate';
import waitForExpect from 'wait-for-expect';
import {
  firstState,
  calculateChannelId,
  createSignatureEntry,
  ChannelConstants,
  Outcome,
  State,
  checkThat,
  isSimpleEthAllocation,
  BN
} from '@statechannels/wallet-core';

import {Store} from '../../store';
import {FakeChain} from '../../chain';
import {TestStore} from '../../test-store';
import {HUB, zeroAddress} from '../../config';
import {Init, machine} from '../create-and-fund';
import {MessagingService, MessagingServiceInterface} from '../../messaging';

import {
  wallet1,
  wallet2,
  participants,
  wallet3,
  ledgerState,
  first,
  third,
  second,
  TEST_APP_DOMAIN,
  budget
} from './data';
import {subscribeToMessages} from './message-service';
import {SimpleHub} from './simple-hub';

jest.setTimeout(20000);

const {add} = BN;
const EXPECT_TIMEOUT = process.env.CI ? 9500 : 2000;

const chainId = '0x01';
const challengeDuration = 10;
const appDefinition = zeroAddress;

const targetChannel: ChannelConstants = {
  channelNonce: 0,
  chainId,
  challengeDuration,
  participants,
  appDefinition
};
const targetChannelId = calculateChannelId(targetChannel);

const ledgerChannel: ChannelConstants = {
  channelNonce: 1,
  chainId,
  challengeDuration,
  participants,
  appDefinition
};

const destinations = participants.map(p => p.destination);
const amounts = [BN.from(7), BN.from(5)];
const totalAmount = amounts.reduce((a, b) => add(a, b));

const allocation: Outcome = {
  type: 'SimpleAllocation',
  asset: zeroAddress,
  allocationItems: [0, 1].map(i => ({
    destination: destinations[i],
    amount: amounts[i]
  }))
};

const ledgerAmounts = amounts.map(a => add(a, 2));
const depositAmount = ledgerAmounts.reduce(add);

const context: Init = {channelId: targetChannelId, funding: 'Direct'};

let aStore: TestStore;
let bStore: TestStore;
let aMessaging: MessagingServiceInterface;
let bMessaging: MessagingServiceInterface;
const allSignState = (state: State) => ({
  ...state,
  signatures: [wallet1, wallet2].map(({privateKey}) => createSignatureEntry(state, privateKey))
});

let chain: FakeChain;

beforeEach(async () => {
  chain = new FakeChain();
  aStore = new TestStore(chain);
  await aStore.initialize([wallet1.privateKey]);
  aMessaging = new MessagingService(aStore);
  bStore = new TestStore(chain);
  await bStore.initialize([wallet2.privateKey]);
  bMessaging = new MessagingService(bStore);
  const hubStore = new SimpleHub(wallet3.privateKey);

  [aStore, bStore].forEach(async (store: TestStore) => {
    await store.createEntry(allSignState(firstState(allocation, targetChannel)), {
      applicationDomain: TEST_APP_DOMAIN
    });
    const ledgerEntry = await store.createEntry(
      allSignState(firstState(allocation, ledgerChannel))
    );
    await store.setLedgerByEntry(ledgerEntry);
  });

  subscribeToMessages({
    [participants[0].participantId]: aStore,
    [participants[1].participantId]: bStore,
    [HUB.participantId]: hubStore
  });
});

test('it uses direct funding when told', async () => {
  const connectToStore = ([store, messagingService]) =>
    interpret(machine(store, messagingService).withContext(context)).start();
  const [aService, bService] = [
    [aStore, aMessaging],
    [bStore, bMessaging]
  ].map(connectToStore);

  await waitForExpect(async () => {
    expect(bService.state.value).toEqual('success');
    expect(aService.state.value).toEqual('success');
  }, EXPECT_TIMEOUT);

  const {supported: supportedState} = await aStore.getEntry(targetChannelId);
  const outcome = checkThat(supportedState.outcome, isSimpleEthAllocation);

  expect(outcome).toMatchObject(allocation);
  expect((await aStore.getEntry(targetChannelId)).funding).toMatchObject({type: 'Direct'});
  expect((await aStore.chain.getChainInfo(targetChannelId)).amount).toBe(totalAmount);
});

// eslint-disable-next-line jest/no-disabled-tests
test.skip('it uses virtual funding when enabled', async () => {
  let state = ledgerState([first, third], ledgerAmounts);
  let ledgerId = calculateChannelId(state);
  let signatures = [wallet1, wallet3].map(({privateKey}) =>
    createSignatureEntry(state, privateKey)
  );
  await aStore.createBudget(budget(BN.from(7), BN.from(7)));
  await bStore.createBudget(budget(BN.from(7), BN.from(7)));
  chain.depositSync(ledgerId, '0', depositAmount);
  await aStore.setLedgerByEntry(await aStore.createEntry({...state, signatures}));

  state = ledgerState([second, third], ledgerAmounts);
  ledgerId = calculateChannelId(state);
  signatures = [wallet2, wallet3].map(({privateKey}) => createSignatureEntry(state, privateKey));

  chain.depositSync(ledgerId, '0', depositAmount);
  await bStore.setLedgerByEntry(await bStore.createEntry({...state, signatures}));

  const [aService, bService] = [
    [aStore, aMessaging],
    [bStore, bMessaging]
  ].map(([store, messagingService]) =>
    interpret(
      machine(store as Store, messagingService as MessagingServiceInterface).withContext({
        ...context,
        funding: 'Virtual'
      })
    ).start()
  );

  await waitForExpect(async () => {
    expect(aService.state.value).toEqual('success');
    expect(bService.state.value).toEqual('success');
  }, EXPECT_TIMEOUT);

  const {supported: supportedState} = await aStore.getEntry(targetChannelId);
  const outcome = checkThat(supportedState.outcome, isSimpleEthAllocation);

  expect(outcome).toMatchObject(allocation);
  expect((await aStore.getEntry(targetChannelId)).funding).toMatchObject({type: 'Virtual'});

  // Verify the budgets are allocated to the channel
  const aBudget = await aStore.getBudget(TEST_APP_DOMAIN);
  const aChannelAmount = aBudget?.forAsset[zeroAddress]?.channels[targetChannelId].amount;
  expect(aChannelAmount).toEqual(totalAmount);

  const bBudget = await bStore.getBudget(TEST_APP_DOMAIN);
  const bChannelAmount = bBudget?.forAsset[zeroAddress]?.channels[targetChannelId].amount;
  expect(bChannelAmount).toEqual(totalAmount);
});
