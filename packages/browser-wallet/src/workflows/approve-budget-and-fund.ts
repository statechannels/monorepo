import {
  StateSchema,
  StateMachine,
  ActionObject,
  createMachine,
  Guard,
  assign,
  DoneInvokeEvent,
  Interpreter
} from 'xstate';
import {
  DomainBudget,
  Participant,
  SimpleAllocation,
  AssetBudget,
  State as ChannelState,
  statesEqual,
  checkThat,
  exists,
  simpleEthAllocation,
  BN,
  Uint256,
  serializeDomainBudget
} from '@statechannels/wallet-core';
import {filter, map, first} from 'rxjs/operators';

import {ChannelChainInfo} from '../chain';
import {Store} from '../store';
import {MessagingServiceInterface} from '../messaging';
import {sendUserDeclinedResponse, hideUI, displayUI} from '../utils/workflow-utils';
import {CHALLENGE_DURATION, zeroAddress} from '../config';
const {add} = BN;
interface ChainEvent {
  type: 'CHAIN_EVENT';
  blockNum: number;
  balance: Uint256;
}

type Event =
  | {type: 'USER_APPROVES_BUDGET'}
  | {type: 'USER_REJECTS_BUDGET'}
  | {type: 'USER_APPROVES_RETRY'}
  | {type: 'USER_REJECTS_RETRY'}
  | {type: 'SUFFICIENT_FUNDS_DETECTED'}
  | {type: 'INSUFFICIENT_FUNDS_DETECTED'}
  | ChainEvent;

interface Initial {
  budget: DomainBudget;
  player: Participant;
  hub: Participant;
  requestId: number;
}
interface LedgerExists extends Initial {
  ledgerId: string;
  ledgerState: ChannelState;
}
interface Deposit {
  depositAt: Uint256;
  totalAfterDeposit: Uint256;
  fundedAt: Uint256;
}

interface Chain {
  ledgerTotal: Uint256;
  lastChangeBlockNum: number;
  currentBlockNum: number;
}

interface Transaction {
  transactionId: string;
}

type Typestate =
  | {value: 'waitForUserApproval'; context: Initial}
  | {value: {waitForSufficientFunds: 'init'}; context: Initial}
  | {value: {waitForSufficientFunds: 'waitForFunds'}; context: Initial}
  | {value: 'createLedger'; context: Initial}
  | {value: 'createBudget'; context: Initial}
  | {value: 'waitForPreFS'; context: LedgerExists}
  | {value: {deposit: 'init'}; context: LedgerExists & Deposit}
  | {value: {deposit: 'waitTurn'}; context: LedgerExists & Deposit & Chain}
  | {value: {deposit: 'submitTransaction'}; context: LedgerExists & Deposit & Chain}
  | {value: {deposit: 'retry'}; context: LedgerExists & Deposit & Chain}
  | {value: {deposit: 'waitMining'}; context: LedgerExists & Deposit & Chain & Transaction}
  | {value: {deposit: 'waitFullyFunded'}; context: LedgerExists & Deposit & Chain}
  | {value: 'done'; context: LedgerExists}
  | {value: 'failure'; context: Initial};

type Context = Typestate['context'];

export interface Schema extends StateSchema<Context> {
  states: {
    waitForSufficientFunds: {};
    createLedger: {};
    createBudget: {};
    waitForPreFS: {};
    deposit: {
      states: {
        init: {};
        waitTurn: {};
        submitTransaction: {};
        retry: {};
        waitMining: {};
        waitFullyFunded: {};
      };
    };
    done: {};
    failure: {};
  };
}

export const machine = (
  store: Store,
  messagingService: MessagingServiceInterface,
  context: Initial
): StateMachine<Context, Schema, Event, Typestate> =>
  createMachine<Context, Event, Typestate>({
    id: 'approve-budget-and-fund',
    context,
    initial: 'waitForUserApproval',
    entry: displayUI(messagingService),
    states: {
      waitForUserApproval: {
        on: {
          USER_APPROVES_BUDGET: {target: 'waitForSufficientFunds'},
          USER_REJECTS_BUDGET: {target: 'failure'}
        }
      },

      createLedger: {
        invoke: {
          id: 'createLedger',
          src: createLedger(store),
          onDone: {target: 'waitForPreFS', actions: setLedgerInfo}
        }
      },
      waitForPreFS: {
        invoke: {
          id: 'subscribeToLedgerUpdates',
          src: notifyWhenPreFSSupported(store),
          onDone: {target: 'deposit', actions: assignDepositingInfo}
        }
      },
      createBudget: {
        invoke: {
          id: 'createBudget',
          src: createBudget(store, messagingService),
          onDone: {target: 'done'}
        }
      },
      waitForSufficientFunds: {
        initial: 'init',
        invoke: {
          id: 'subscribeToBalanceUpdates',
          src: notifyWhenSufficientFunds(store)
        },
        states: {
          init: {},
          waitForFunds: {}
        },
        on: {
          INSUFFICIENT_FUNDS_DETECTED: {target: '.waitForFunds'},
          SUFFICIENT_FUNDS_DETECTED: {target: 'createLedger'}
        }
      },
      deposit: {
        initial: 'init',
        invoke: {
          id: 'observeChain',
          src: observeLedgerOnChainBalance(store)
        },
        on: {
          CHAIN_EVENT: [
            {target: 'createBudget', actions: assignChainData, cond: fullAmountConfirmed},
            {target: '.waitFullyFunded', actions: assignChainData, cond: myAmountConfirmed}
          ]
        },
        states: {
          init: {
            on: {
              CHAIN_EVENT: [
                {target: 'submitTransaction', actions: assignChainData, cond: myTurnNow},
                {target: 'waitTurn', actions: assignChainData, cond: notMyTurnYet}
              ]
            }
          },
          waitTurn: {
            on: {
              CHAIN_EVENT: [
                {target: 'submitTransaction', actions: assignChainData, cond: myTurnNow}
              ]
            }
          },
          submitTransaction: {
            invoke: {
              id: 'submitTransaction',
              src: submitDepositTransaction(store),
              onDone: {target: 'waitMining', actions: setTransactionId}
              // onError: {target: 'retry'}
            }
          },
          retry: {
            on: {
              USER_APPROVES_RETRY: {target: 'submitTransaction'},
              USER_REJECTS_RETRY: {target: '#failure'}
            }
          },
          waitMining: {},
          waitFullyFunded: {}
        }
      },
      done: {
        id: 'done',
        type: 'final',
        entry: [hideUI(messagingService), sendResponse(messagingService)]
      },
      failure: {
        type: 'final',
        id: 'failure',
        entry: [hideUI(messagingService), sendUserDeclinedResponse(messagingService)]
      }
    }
  });

interface LedgerInitRetVal {
  ledgerId: string;
  ledgerState: ChannelState;
}
const createBudget = (store: Store, messagingService: MessagingServiceInterface) => async (
  context: Initial
): Promise<void> => {
  // create budget
  await store.createBudget(context.budget);
  await messagingService.sendBudgetNotification(context.budget);
};
const createLedger = (store: Store) => async (context: Initial): Promise<LedgerInitRetVal> => {
  // create ledger
  const initialOutcome = convertPendingBudgetToAllocation(context);
  const participants = [context.player, context.hub];

  const stateVars = {outcome: initialOutcome, turnNum: 0, isFinal: false, appData: '0x00'};
  const entry = await store.createChannel(participants, CHALLENGE_DURATION, stateVars);
  const ledgerId = entry.channelId;
  await store.setFunding(entry.channelId, {type: 'Direct'});
  await store.setLedger(entry.channelId);
  await store.setapplicationDomain(ledgerId, context.budget.domain);
  await store.addObjective({
    type: 'FundLedger',
    participants: participants,
    data: {ledgerId}
  });

  return {
    ledgerId,
    ledgerState: entry.latestState
  };
};

const setLedgerInfo = assign<Context, DoneInvokeEvent<LedgerInitRetVal>>({
  ledgerId: (context, event) => event.data.ledgerId,
  ledgerState: (context, event) => event.data.ledgerState
});

function convertPendingBudgetToAllocation({hub, player, budget}: Context): SimpleAllocation {
  // TODO: Eventually we will need to support more complex budgets
  if (Object.keys(budget.forAsset).length !== 1) {
    throw new Error('Cannot handle mixed budget');
  }
  // todo: this throws if the budget is undefined and casts it to a AssetBudget otherwise
  // maybe this should be called assertBudgetExists ??
  const ethBudget = checkThat<AssetBudget>(budget.forAsset[zeroAddress], exists);
  const playerItem = {
    destination: player.destination,
    amount: ethBudget.availableSendCapacity
  };
  const hubItem = {
    destination: hub.destination,
    amount: ethBudget.availableReceiveCapacity
  };
  return simpleEthAllocation([hubItem, playerItem]);
}

const sendResponse = (
  messagingService: MessagingServiceInterface
): ActionObject<Context, Event> => ({
  type: 'sendResponse',
  exec: context =>
    messagingService.sendResponse(context.requestId, serializeDomainBudget(context.budget))
});

const assignDepositingInfo = assign<Context>({
  // this is inefficient, but if use the other style of xstate assign, the devtools break ...
  depositAt: context => calculateDepositInfo(context).depositAt,
  totalAfterDeposit: context => calculateDepositInfo(context).totalAfterDeposit,
  fundedAt: context => calculateDepositInfo(context).fundedAt
});

const calculateDepositInfo = (context: Context) => {
  const ethBudget = checkThat<AssetBudget>(context.budget.forAsset[zeroAddress], exists);
  const ourAmount = ethBudget.availableSendCapacity;
  const hubAmount = ethBudget.availableSendCapacity;
  const totalAmount = add(ourAmount, hubAmount);

  const depositAt = hubAmount; // hub goes first
  const totalAfterDeposit = totalAmount;
  const fundedAt = totalAmount;
  return {depositAt, totalAfterDeposit, fundedAt};
};

const notifyWhenPreFSSupported = (store: Store) => ({ledgerState, ledgerId}: LedgerExists) =>
  store
    .channelUpdatedFeed(ledgerId)
    .pipe(
      filter(({isSupported}) => isSupported),
      filter(({supported}) => statesEqual(ledgerState, supported)), //store the hash?
      map(() => 'SUPPORTED'),
      first()
    )
    .toPromise();

const notifyWhenSufficientFunds = (store: Store) => ({budget}: Initial) => {
  const ethBudget = checkThat<AssetBudget>(budget.forAsset[zeroAddress], exists);
  if (!store.chain.selectedAddress) {
    throw new Error('No selected address');
  }
  const depositAmount = ethBudget.availableSendCapacity;
  return store.chain.balanceUpdatedFeed(store.chain.selectedAddress).pipe(
    map(b => ({
      type: BN.gte(b, depositAmount) ? 'SUFFICIENT_FUNDS_DETECTED' : 'INSUFFICIENT_FUNDS_DETECTED'
    }))
  );
};

const observeLedgerOnChainBalance = (store: Store) => ({ledgerId}: LedgerExists) =>
  store.chain.chainUpdatedFeed(ledgerId).pipe(
    map<ChannelChainInfo, ChainEvent>(({amount: balance, blockNum}) => ({
      type: 'CHAIN_EVENT',
      balance,
      blockNum
    }))
  );

// // for now don't wait for any number of blocks (until the chain is reporting blockNum)
const fullAmountConfirmed: Guard<Deposit, ChainEvent> = {
  type: 'xstate.guard',
  name: 'fullAmountConfirmed',
  predicate: (context, event) => BN.gte(event.balance, context.fundedAt)
};
const myTurnNow: Guard<Deposit, ChainEvent> = {
  type: 'xstate.guard',
  name: 'myTurnNow',
  predicate: (context, event) =>
    BN.gte(event.balance, context.depositAt) && BN.lt(event.balance, context.totalAfterDeposit)
};
const notMyTurnYet: Guard<Deposit, ChainEvent> = {
  type: 'xstate.guard',
  name: 'notMyTurnYet',
  predicate: (context, event) => BN.lt(event.balance, context.depositAt)
};
const myAmountConfirmed: Guard<Deposit, ChainEvent> = {
  type: 'xstate.guard',
  name: 'myAmountConfirmed',
  predicate: (context, event) =>
    BN.gte(event.balance, context.totalAfterDeposit) && BN.lt(event.balance, context.fundedAt)
};

const assignChainData = assign<Context, ChainEvent>({
  ledgerTotal: (context, event: ChainEvent) => event.balance,
  currentBlockNum: (context, event: ChainEvent) => event.blockNum,
  lastChangeBlockNum: (context, event: ChainEvent) =>
    context.ledgerTotal && context.ledgerTotal === event.balance
      ? context.lastChangeBlockNum
      : event.blockNum
});

const setTransactionId = assign<Context, DoneInvokeEvent<string>>({
  transactionId: (context, event) => event.data
});

const submitDepositTransaction = (store: Store) => async (
  ctx: LedgerExists & Deposit & Chain
): Promise<string | undefined> => {
  const amount = BN.sub(ctx.totalAfterDeposit, ctx.ledgerTotal);
  if (BN.lte(amount, 0)) {
    // sanity check: we shouldn't be in this state, if this is the case
    throw new Error(
      `Something is wrong! Shouldn't be trying to deposit when the remaining amount is ${amount.toString()}.`
    );
  }

  return store.chain.deposit(ctx.ledgerId, BN.from(ctx.ledgerTotal), amount);
};

export type ApproveBudgetAndFundService = Interpreter<Context, any, Event, Typestate>;
