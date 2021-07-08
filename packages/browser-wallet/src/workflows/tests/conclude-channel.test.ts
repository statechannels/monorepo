import {interpret} from 'xstate';
import {
  firstState,
  calculateChannelId,
  createSignatureEntry,
  ChannelConstants,
  Outcome,
  State,
  BN,
  makeAddress
} from '@statechannels/wallet-core';

import {Store} from '../../store';
import {FakeChain} from '../../chain';
import {TestStore} from '../../test-store';
import {HUB, zeroAddress} from '../../config';
import {machine as concludeChannel} from '../conclude-channel';
import {Init, machine as createChannel} from '../create-and-fund';
import {MessagingService} from '../../messaging';

import {subscribeToMessages} from './message-service';
import {SimpleHub} from './simple-hub';
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

jest.setTimeout(20000);

const {add} = BN;
const chainId = '0x01';
const challengeDuration = 10;
const appDefinition = zeroAddress;

const targetChannel: ChannelConstants = {
  channelNonce: 0,
  chainId,
  challengeDuration,
  participants,
  appDefinition: makeAddress(appDefinition)
};
const targetChannelId = calculateChannelId(targetChannel);

const destinations = participants.map(p => p.destination);

const ledgerChannel: ChannelConstants = {...targetChannel, channelNonce: 1};

const amounts = [BN.from(7), BN.from(5)];
const ledgerAmounts = amounts.map(a => add(a, 2));
const depositAmount = ledgerAmounts.reduce(add);

const allocation: Outcome = {
  type: 'SimpleAllocation',
  asset: zeroAddress,
  allocationItems: [0, 1].map(i => ({
    destination: destinations[i],
    amount: amounts[i]
  }))
};

const context: Init = {channelId: targetChannelId, funding: 'Direct'};

let aStore: TestStore;
let bStore: TestStore;
const allSignedState = (state: State) => ({
  ...state,
  signatures: [wallet1, wallet2].map(({privateKey}) => createSignatureEntry(state, privateKey))
});

let chain: FakeChain;

const createLedgerChannels = async () => {
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

  const services = [
    [aStore, aMessagingService],
    [bStore, bMessagingService]
  ].map(([store, messaging]) =>
    interpret(createChannel(store, messaging).withContext({...context, funding: 'Virtual'})).start()
  );

  await Promise.all(
    services.map(
      service =>
        new Promise<void>(resolve =>
          service.onTransition(state => state.matches('success') && service.stop() && resolve())
        )
    )
  );
};

const resolveOnTransition = (service, passCond, rejectString?: string) =>
  new Promise<void>((resolve, reject) => {
    setTimeout(() => reject(rejectString), 5_000);
    service.onTransition(state => passCond(state) && service.stop() && resolve());
  });

const runUntilSuccess = async (machine, fundingType: 'Direct' | 'Virtual') => {
  const runMachine = (store: Store, messagingService) =>
    interpret(machine(store, messagingService).withContext(context)).start();
  const services = [runMachine(aStore, aMessagingService), runMachine(bStore, bMessagingService)];
  const targetState = fundingType == 'Direct' ? 'success' : {virtualDefunding: 'asLeaf'};

  await Promise.all(
    services.map(service =>
      resolveOnTransition(
        service,
        state => state.matches(targetState),
        `Did not hit target ${JSON.stringify(targetState)}`
      )
    )
  );
};

const concludeTwiceAndAssert = async (fundingType: 'Direct' | 'Virtual') => {
  // Both conclude the channel
  await runUntilSuccess(concludeChannel, fundingType);
  const amountA1 = (await aStore.chain.getChainInfo(targetChannelId)).amount;
  const amountB1 = (await bStore.chain.getChainInfo(targetChannelId)).amount;

  // store entries should have been udpated to finalized state
  const entryA1 = await aStore.getEntry(targetChannelId);
  const entryB1 = await bStore.getEntry(targetChannelId);
  expect(entryA1.hasConclusionProof).toBe(true);
  expect(entryB1.hasConclusionProof).toBe(true);

  // Conclude again
  await runUntilSuccess(concludeChannel, fundingType);
  const amountA2 = (await aStore.chain.getChainInfo(targetChannelId)).amount;
  const amountB2 = (await bStore.chain.getChainInfo(targetChannelId)).amount;

  const entryA2 = await aStore.getEntry(targetChannelId);
  const entryB2 = await bStore.getEntry(targetChannelId);

  expect(amountA2).toMatchObject(amountA1);
  expect(amountB2).toMatchObject(amountB1);

  // No change to the store entires, meaning that turnNum, etc. remain the same
  expect(entryA1).toMatchObject(entryA2);
  expect(entryB1).toMatchObject(entryB2);
};

const concludeAfterCrashAndAssert = async (fundingType: 'Direct' | 'Virtual') => {
  const crashState = fundingType == 'Direct' ? 'withdrawing' : {virtualDefunding: 'gettingRole'};
  const successState =
    fundingType == 'Direct' ? {withdrawing: 'submitTransaction'} : {virtualDefunding: 'asLeaf'};

  interpret(concludeChannel(bStore, bMessagingService).withContext(context)).start();

  // Simulate A crashes before withdrawing
  const aMachine = interpret(concludeChannel(aStore, aMessagingService).withContext(context))
    .onTransition(state => state.value === crashState && aMachine.stop())
    .start();

  const entryA1 = await aStore.getEntry(targetChannelId);
  expect(entryA1.hasConclusionProof).toBe(false);

  // A concludes again
  await resolveOnTransition(
    interpret(concludeChannel(aStore, aMessagingService).withContext(context)).start(),
    state => state.matches(successState),
    `Did not hit success state ${successState}`
  );

  const entryA2 = await aStore.getEntry(targetChannelId);
  expect(entryA2.hasConclusionProof).toBe(true);
};

let aMessagingService;
let bMessagingService;

beforeEach(async () => {
  chain = new FakeChain();
  aStore = new TestStore(chain);
  await aStore.initialize([wallet1.privateKey]);
  bStore = new TestStore(chain);
  await bStore.initialize([wallet2.privateKey]);
  const hubStore = new SimpleHub(wallet3.privateKey);
  aMessagingService = new MessagingService(aStore);
  bMessagingService = new MessagingService(bStore);

  [aStore, bStore].forEach(async (store: TestStore) => {
    await store.createEntry(allSignedState(firstState(allocation, targetChannel)), {
      applicationDomain: TEST_APP_DOMAIN
    });

    const ledgerEntry = await store.createEntry(
      allSignedState(firstState(allocation, ledgerChannel))
    );
    await store.setLedgerByEntry(ledgerEntry);
  });

  subscribeToMessages({
    [participants[0].participantId]: aStore,
    [participants[1].participantId]: bStore,
    [HUB.participantId]: hubStore
  });
});

async function signFinalState(finalizer: Store, other: Store) {
  const targetChannelState = (await finalizer.getEntry(targetChannelId)).supported;
  const {supported: finalState} = await finalizer.signAndAddState(targetChannelId, {
    ...targetChannelState,
    turnNum: targetChannelState.turnNum + 1,
    isFinal: true
  });

  await other.addState(finalState);
}

//TODO: Re-enable these tests
// https://github.com/statechannels/monorepo/issues/1831
// eslint-disable-next-line jest/expect-expect
// eslint-disable-next-line jest/no-disabled-tests
it.skip('concludes correctly when concluding twice using direct funding', async () => {
  await runUntilSuccess(createChannel, 'Direct');
  await signFinalState(aStore, bStore);

  await concludeTwiceAndAssert('Direct');
});

// eslint-disable-next-line jest/expect-expect
// eslint-disable-next-line jest/no-disabled-tests
it.skip('concludes correctly when concluding twice using virtual funding', async () => {
  await createLedgerChannels();
  await signFinalState(aStore, bStore);

  await concludeTwiceAndAssert('Virtual');
});

// eslint-disable-next-line jest/expect-expect
// eslint-disable-next-line jest/no-disabled-tests
it.skip('concludes correctly when A crashes during the first conclude using direct funding', async () => {
  // Let A and B create and fund channel
  await runUntilSuccess(createChannel, 'Direct');
  await signFinalState(aStore, bStore);

  await concludeAfterCrashAndAssert('Direct');
});

// eslint-disable-next-line jest/expect-expect
// eslint-disable-next-line jest/no-disabled-tests
it.skip('concludes correctly when A crashes during the first conclude using virtual funding', async () => {
  // Let A and B create and fund channel
  await createLedgerChannels();
  await signFinalState(aStore, bStore);

  await concludeAfterCrashAndAssert('Virtual');
});
