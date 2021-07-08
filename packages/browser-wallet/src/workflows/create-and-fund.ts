import {
  Machine,
  MachineConfig,
  StateNodeConfig,
  ActionTypes,
  DoneInvokeEvent,
  assign
} from 'xstate';
import {filter, map, first} from 'rxjs/operators';
import _ from 'lodash';
import {
  isVirtuallyFund,
  StateVariables,
  Outcome,
  isSimpleEthAllocation,
  simpleEthAllocation,
  checkThat,
  Zero,
  BN
} from '@statechannels/wallet-core';

import {Store} from '../store';
import {CHALLENGE_DURATION, HUB, zeroAddress} from '../config';
import {MessagingServiceInterface} from '../messaging';
import {getDataAndInvoke} from '../utils';

import {SupportState, VirtualFundingAsLeaf, Depositing} from '.';
const PROTOCOL = 'create-and-fund';
const {add} = BN;

export type Init = {
  channelId: string;
  funding: 'Direct' | 'Virtual' | 'Ledger';
};

const isDirect = (ctx: Init) => ctx.funding === 'Direct';
const isVirtual = (ctx: Init) => ctx.funding === 'Virtual';
const preFundSetup = getDataAndInvoke<Init, Service>(
  {src: 'getPreFundSetup'},
  {src: 'supportState'},
  [
    {target: 'direct', cond: isDirect},
    {target: 'virtual', cond: isVirtual}
  ]
);

const direct: StateNodeConfig<any, any, any> = {
  initial: 'depositing',
  states: {
    depositing: getDataAndInvoke<Init, Service>(
      {src: 'getDepositingInfo'},
      {src: 'depositing'},
      'updateFunding'
    ),
    updateFunding: {invoke: {src: 'setFundingToDirect', onDone: 'done'}},
    done: {type: 'final'}
  },
  onDone: 'postFundSetup'
};

const triggerObjective = (store: Store) => async (ctx: Init): Promise<void> => {
  const {channelConstants, supported: supportedState, myIndex} = await store.getEntry(
    ctx.channelId
  );
  if (myIndex !== 0) return;

  const {participants: targetParticipants} = channelConstants;
  const participants = [...targetParticipants, HUB];

  const {allocationItems} = checkThat(supportedState.outcome, isSimpleEthAllocation);

  const outcome: Outcome = simpleEthAllocation([
    allocationItems[0],
    {destination: HUB.destination, amount: allocationItems.map(i => i.amount).reduce(add)},
    allocationItems[1]
  ]);

  const stateVars: StateVariables = {turnNum: 0, outcome, appData: '0x', isFinal: false};

  const {channelId: jointChannelId} = await store.createChannel(
    participants,
    CHALLENGE_DURATION,
    stateVars
  );

  store.addObjective({
    type: 'VirtuallyFund',
    participants,
    data: {jointChannelId, targetChannelId: ctx.channelId}
  });
};

// Uses the any type to avoid flickering compile errors
const assignJointChannelId = assign<any>({
  jointChannelId: (_, event: DoneInvokeEvent<{jointChannelId: string}>) => event.data.jointChannelId
});

const reserveFunds = (
  store: Store,
  messagingService: MessagingServiceInterface
) => async context => {
  const channelEntry = await store.getEntry(context.channelId);
  const {allocationItems} = checkThat(channelEntry.supported.outcome, isSimpleEthAllocation);
  const playerAddress = await store.getAddress();
  const playerDestination =
    channelEntry.supported.participants.find(p => p.signingAddress === playerAddress)
      ?.destination || '0x00';
  const receive = allocationItems.find(a => a.destination !== playerDestination)?.amount || Zero;
  const send = allocationItems.find(a => a.destination === playerDestination)?.amount || Zero;

  const budget = await store.reserveFunds(zeroAddress, context.channelId, {
    receive,
    send
  });
  await messagingService.sendBudgetNotification(budget);
};

type VirtualFundingComplete = Init & {jointChannelId: string};
const virtual: StateNodeConfig<Init, any, any> = {
  initial: 'reserveFunds',
  entry: [triggerObjective.name],
  states: {
    reserveFunds: {invoke: {src: 'reserveFunds', onDone: 'virtualFunding'}},
    virtualFunding: getDataAndInvoke<Init, Service>(
      {src: 'getObjective'},
      {src: 'virtualFunding', opts: {entry: 'assignJointChannelId'}},
      'updateFunding'
    ),
    updateFunding: {invoke: {src: 'setFundingToVirtual', onDone: 'done'}},
    done: {type: 'final'}
  },
  onDone: 'postFundSetup'
};

const postFundSetup = getDataAndInvoke<Init, Service>(
  {src: 'getPostFundSetup'},
  {src: 'supportState'},
  'success'
);

export const config: MachineConfig<Init, any, any> = {
  key: PROTOCOL,
  initial: 'preFundSetup',

  on: {[ActionTypes.ErrorCustom]: {target: 'failure'}},
  states: {
    preFundSetup,
    direct,
    virtual,
    postFundSetup,
    success: {type: 'final'},
    failure: {}
  }
};

export const services = (store: Store, messagingService: MessagingServiceInterface) => ({
  depositing: Depositing.machine(store),
  supportState: SupportState.machine(store),
  virtualFunding: VirtualFundingAsLeaf.machine(store),
  getDepositingInfo: getDepositingInfo(store),
  getPreFundSetup: getPreFundSetup(store),
  getPostFundSetup: getPostFundSetup(store),
  setFundingToDirect: setFundingToDirect(store),
  setFundingToVirtual: setFundingToVirtual(store),
  getObjective: getObjective(store),
  reserveFunds: reserveFunds(store, messagingService)
});

type Service = keyof ReturnType<typeof services>;

const options = (store: Store, messagingService: MessagingServiceInterface) => ({
  services: services(store, messagingService),
  actions: {
    triggerObjective: triggerObjective(store),
    assignJointChannelId
  }
});

export const machine = (store: Store, messagingService: MessagingServiceInterface) =>
  Machine(config).withConfig(options(store, messagingService));

const getObjective = (store: Store) => (ctx: Init): Promise<VirtualFundingAsLeaf.Init> =>
  store.objectiveFeed
    .pipe(
      filter(isVirtuallyFund),
      map(
        ({data}): VirtualFundingAsLeaf.Init => ({
          targetChannelId: data.targetChannelId,
          jointChannelId: data.jointChannelId
        })
      ),
      filter(({targetChannelId}) => targetChannelId === ctx.channelId),
      first()
    )
    .toPromise();

/*
It's safe to use support state instead of advance-channel:
- If the latest state that I support has turn `n`, then other participants can support a state
  of turn at most `n + numParticipants - 1`
In the 2-party case,
- if I support state 1, then 2 is the highest supported state, and the appData
  cannot change
- if I am player A, and I support 3 instead of 2, then 3 is the highest supported state,
  since 4 needs to be signed by me
- if I am player B, then I would sign state 3 using advanceChannel anyway
*/
const getPreFundSetup = (store: Store) => (ctx: Init): Promise<SupportState.Init> =>
  store
    .channelUpdatedFeed(ctx.channelId)
    .pipe(
      map(e => _.sortBy(e.sortedStates, s => s.turnNum)[0]),
      filter(s => s.turnNum === 0),
      map(state => ({state})),
      first()
    )
    .toPromise();

const getPostFundSetup = (store: Store) => (ctx: Init): Promise<SupportState.Init> =>
  store
    .channelUpdatedFeed(ctx.channelId)
    .pipe(
      map(e => _.sortBy(e.sortedStates, s => s.turnNum)[0]),
      filter(s => s.turnNum === 0),
      map(s => ({state: {...s, turnNum: 3}})),
      first()
    )
    .toPromise();

const getDepositingInfo = (store: Store) => async ({channelId}: Init): Promise<Depositing.Init> => {
  const {supported: supportedState, myIndex} = await store.getEntry(channelId);
  const {allocationItems} = checkThat(supportedState.outcome, isSimpleEthAllocation);

  const fundedAt = allocationItems.map(a => a.amount).reduce(add);
  let depositAt = Zero;
  for (let i = 0; i < allocationItems.length; i++) {
    const {amount} = allocationItems[i];
    if (i !== myIndex) depositAt = add(depositAt, amount);
    else {
      const totalAfterDeposit = add(depositAt, amount);
      return {channelId, depositAt, totalAfterDeposit, fundedAt};
    }
  }

  throw Error(`Could not find an allocation for participant id ${myIndex}`);
};

const setFundingToDirect = (store: Store) => async (ctx: Init) =>
  await store.setFunding(ctx.channelId, {type: 'Direct'});

const setFundingToVirtual = (store: Store) => async (ctx: VirtualFundingComplete) => {
  await store.setFunding(ctx.channelId, {type: 'Virtual', jointChannelId: ctx.jointChannelId});
};
