import {interpret} from 'xstate';
import waitForExpect from 'wait-for-expect';
import {
  checkThat,
  isSimpleEthAllocation,
  firstState,
  calculateChannelId,
  createSignatureEntry,
  ChannelConstants,
  Outcome,
  State,
  SignedState,
  BN
} from '@statechannels/wallet-core';
import _ from 'lodash';

import {FakeChain, Chain} from '../../chain';
import {TestStore} from '../../test-store';
import {Init, machine, Errors} from '../ledger-funding';
import {zeroAddress} from '../../config';

import {wallet1, wallet2, participants} from './data';
import {subscribeToMessages} from './message-service';

jest.setTimeout(10000);
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
const ledgerChannelId = calculateChannelId(ledgerChannel);

const destinations = participants.map(p => p.destination);
const amounts = [BN.from(7), BN.from(5)];
const deductionAmounts = [BN.from(3), BN.from(2)];
const outcome: Outcome = {
  type: 'SimpleAllocation',
  asset: zeroAddress,
  allocationItems: [0, 1].map(i => ({
    destination: destinations[i],
    amount: amounts[i]
  }))
};
const deductions = [0, 1].map(i => ({
  destination: destinations[i],
  amount: deductionAmounts[i]
}));

const context: Init = {targetChannelId, ledgerChannelId, deductions};

let chain: Chain;
let aStore: TestStore;
let bStore: TestStore;

const allSignState = (state: State) => ({
  ...state,
  signatures: [wallet1, wallet2].map(({privateKey}) => createSignatureEntry(state, privateKey))
});

describe('success', () => {
  beforeEach(async () => {
    aStore = new TestStore(chain);
    await aStore.initialize([wallet1.privateKey]);
    bStore = new TestStore(chain);
    await bStore.initialize([wallet2.privateKey]);

    await Promise.all(
      [aStore, bStore].map(async (store: TestStore) => {
        await store.createEntry(allSignState(firstState(outcome, targetChannel)));
        await store.setLedgerByEntry(
          await store.createEntry(allSignState(firstState(outcome, ledgerChannel)))
        );
      })
    );

    subscribeToMessages({
      [participants[0].participantId]: aStore,
      [participants[1].participantId]: bStore
    });
  });

  test('happy path', async () => {
    const _chain = new FakeChain();
    _chain.depositSync(ledgerChannelId, '0', amounts.reduce(add));
    [aStore, bStore].forEach((store: TestStore) => ((store as any).chain = _chain));

    const aService = interpret(machine(aStore).withContext(context));

    const bService = interpret(machine(bStore).withContext(context));
    [aService, bService].map(s => s.start());

    await waitForExpect(async () => {
      expect(bService.state.value).toEqual('success');
      expect(aService.state.value).toEqual('success');

      const {supported: supportedState} = await aStore.getEntry(ledgerChannelId);
      const outcome = checkThat(supportedState.outcome, isSimpleEthAllocation);

      expect(outcome.allocationItems).toMatchObject(
        [0, 1]
          .map(i => ({
            destination: destinations[i],
            amount: BN.sub(amounts[i], deductionAmounts[i])
          }))
          .concat([{destination: targetChannelId as any, amount: deductionAmounts.reduce(add)}])
      );

      expect((await aStore.getEntry(targetChannelId)).funding).toMatchObject({
        type: 'Indirect',
        ledgerId: ledgerChannelId
      });
    }, EXPECT_TIMEOUT);
  });

  test('locks', async () => {
    const _chain = new FakeChain();
    _chain.depositSync(ledgerChannelId, '0', amounts.reduce(add));
    [aStore, bStore].forEach((store: TestStore) => ((store as any).chain = _chain));

    const aService = interpret(machine(aStore).withContext(context));
    const bService = interpret(machine(bStore).withContext(context));
    // Note: We need player B to block on the lock since technically
    // if player B signs state 1 then state 1 is supported and it won't block
    // waiting for player A
    const {release} = await bStore.acquireChannelLock(context.ledgerChannelId);

    [aService, bService].map(s => s.start());

    await waitForExpect(async () => {
      expect(bService.state.value).toEqual('acquiringLock');
      expect(aService.state.value).toEqual({fundingTarget: 'supportState'});
    }, EXPECT_TIMEOUT);

    aService.onTransition(s => {
      if (_.isEqual(s.value, {fundTarget: 'getTargetOutcome'})) {
        expect((s.context as any).lock).toBeDefined();
      }
    });
    release();

    await waitForExpect(async () => {
      expect(aService.state.value).toEqual('success');
    }, EXPECT_TIMEOUT);
  });
});

describe('failure modes', () => {
  type Data = {
    ledgerOutcome?: Outcome;
    initialTargetState?: SignedState;
    chainInfo?: {amount: string; finalized: boolean};
  };
  const oneWeiDeposited: Data = {
    ledgerOutcome: outcome,
    chainInfo: {amount: '1', finalized: false}
  };
  const fiveTotalAllocated: Data = {
    ledgerOutcome: {
      type: 'SimpleAllocation',
      asset: zeroAddress,
      allocationItems: [0, 1].map(i => ({
        destination: destinations[i],
        amount: BN.sub(deductionAmounts[i], 1)
      }))
    }
  };

  const finalizedLedger: Data = {chainInfo: {finalized: true, amount: '12'}};
  const unsupportedTarget: Data = {
    initialTargetState: {...firstState(outcome, targetChannel), signatures: []}
  };

  test.each`
    description             | data                  | error
    ${'underfunded'}        | ${oneWeiDeposited}    | ${Errors.underfunded}
    ${'underallocated'}     | ${fiveTotalAllocated} | ${Errors.underallocated}
    ${'finalized'}          | ${finalizedLedger}    | ${Errors.finalized}
    ${'unsupported target'} | ${unsupportedTarget}  | ${Errors.unSupportedTargetChannel + targetChannelId}
  `('failure mode: $description', async ({error, data}: {error: string; data: Data}) => {
    const ledgerOutcome = data.ledgerOutcome ?? outcome;
    const initialTargetState =
      data.initialTargetState ?? allSignState(firstState(outcome, targetChannel));
    const chainInfo = data.chainInfo ?? {amount: '12', finalized: false};

    aStore = new TestStore(chain);
    await aStore.initialize([wallet1.privateKey]);
    bStore = new TestStore(chain);
    await bStore.initialize([wallet2.privateKey]);

    const initialLedgerState = allSignState(firstState(ledgerOutcome, ledgerChannel));
    await Promise.all(
      [aStore, bStore].map(async (store: TestStore) => {
        await store.createEntry(initialTargetState);
        await store.setLedgerByEntry(await store.createEntry(initialLedgerState));
      })
    );

    subscribeToMessages({
      [participants[0].participantId]: aStore,
      [participants[1].participantId]: bStore
    });

    const _chain = new FakeChain();
    _chain.depositSync(ledgerChannelId, '0', chainInfo.amount);
    chainInfo.finalized && _chain.finalizeSync(ledgerChannelId);
    (aStore as any).chain = _chain;

    aStore.createEntry(allSignState({...firstState(ledgerOutcome, ledgerChannel), turnNum: 1}));
    aStore.chain.initialize();

    const aService = interpret(machine(aStore).withContext(context), {
      parent: {send: () => undefined} as any // Consumes uncaught errors
    }).start();

    await waitForExpect(async () => {
      expect(aService.state.value).toEqual('failure');
      expect(aService.state.context).toMatchObject({error});
    }, EXPECT_TIMEOUT);
  });
});
