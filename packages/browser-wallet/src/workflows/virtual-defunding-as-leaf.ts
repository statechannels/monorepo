import {
  checkThat,
  isSimpleEthAllocation,
  simpleEthAllocation,
  nextState,
  isVirtualFunding,
  isIndirectFunding,
  isGuarantee,
  BN
} from '@statechannels/wallet-core';
import {StateNodeConfig, assign, DoneInvokeEvent, Machine, ServiceConfig} from 'xstate';
import _ from 'lodash';

import {ChannelLock} from '../store/store';
import {Store} from '../store';
import {getDataAndInvoke} from '../utils/helpers';
import {MessagingServiceInterface} from '../messaging';
import {zeroAddress} from '../config';

import {OutcomeIdx, ParticipantIdx} from './virtual-funding-as-leaf';

import {SupportState} from '.';

export type Init = {targetChannelId: string};
const PROTOCOL = 'virtual-defunding-as-leaf';

export const enum Errors {
  finalized = 'Ledger channel is finalized',
  invalidOutcome = 'Invalid ledger channel outcome',
  targetNotFinalized = 'Target channel not finalized',
  noSupportedJointState = 'No supported state in joint channel'
}

const enum Services {
  checkChannelsService = 'checkChannelsService',
  defundGuarantorInLedger = 'defundGuarantorInLedger',
  finalJointChannelUpdate = 'finalJointChannelUpdate',
  finalTargetState = 'finalTargetState',
  supportState = 'supportState',
  releaseFunds = 'releaseFunds',
  acquireLock = 'acquireLock',
  getApplicationDomain = 'getApplicationDomain'
}

const checkChannelsService = (store: Store) => async (ctx: Init): Promise<ChannelIds> => {
  const {funding: targetFunding} = await store.getEntry(ctx.targetChannelId);
  const {jointChannelId} = checkThat(targetFunding, isVirtualFunding);

  const {funding: jointFunding, myIndex} = await store.getEntry(jointChannelId);
  const {guarantorChannelId} = checkThat(jointFunding, isGuarantee);
  const role = myIndex === ParticipantIdx.A ? OutcomeIdx.A : OutcomeIdx.B;

  const {funding: guarantorFunding} = await store.getEntry(guarantorChannelId);
  const {ledgerId} = checkThat(guarantorFunding, isIndirectFunding);

  return {jointChannelId, guarantorChannelId, ledgerId, role};
};

type ChannelIds = {
  jointChannelId: string;
  guarantorChannelId: string;
  ledgerId: string;
  role: OutcomeIdx;
};
type ChannelsSet = Init & ChannelIds;

const checkChannels: StateNodeConfig<ChannelsSet, any, any> = {
  invoke: {src: checkChannelsService.name, onDone: 'closeTarget'},
  exit: assign<ChannelsSet>((_: Init, {data}: DoneInvokeEvent<ChannelIds>) => data)
};

const finalTargetState = (store: Store) => async (ctx: Init): Promise<SupportState.Init> => {
  const {supported} = await store.getEntry(ctx.targetChannelId);
  return {state: {...supported, turnNum: supported.turnNum + 1, isFinal: true}};
};

const closeTarget: StateNodeConfig<any, any, any> = getDataAndInvoke(
  {src: finalTargetState.name},
  {src: Services.supportState},
  'defundTarget'
);

const finalJointChannelUpdate = (store: Store) => async (
  ctx: ChannelsSet
): Promise<SupportState.Init> => {
  const {jointChannelId, targetChannelId} = ctx;

  const {supported: targetChannelState} = await store.getEntry(targetChannelId);
  if (!targetChannelState.isFinal) throw Error(Errors.targetNotFinalized);

  const {supported: jointState} = await store.getEntry(jointChannelId);
  if (!jointState) throw Error(Errors.noSupportedJointState);

  const jointAllocation = checkThat(jointState.outcome, isSimpleEthAllocation).allocationItems;
  const targetOutcome = checkThat(targetChannelState.outcome, isSimpleEthAllocation)
    .allocationItems;
  const outcome = simpleEthAllocation([
    targetOutcome[0],
    jointAllocation[OutcomeIdx.Hub],
    targetOutcome[1]
  ]);

  return {state: nextState(jointState, outcome)};
};

const defundTarget: StateNodeConfig<any, any, any> = _.merge(
  getDataAndInvoke(
    {src: finalJointChannelUpdate.name},
    {src: Services.supportState},
    'defundGuarantor'
  )
  // TODO: implement deleteTargetChannel
  // {exit: ['deleteTargetChannel']}
);

const defundGuarantorInLedger = (store: Store) => async ({
  jointChannelId,
  ledgerId,
  guarantorChannelId,
  role
}: ChannelsSet): Promise<SupportState.Init> => {
  if ((await store.chain.getChainInfo(ledgerId)).finalized) throw Error(Errors.finalized);

  const {supported: jointState} = await store.getEntry(jointChannelId);
  const jAlloc = checkThat(jointState.outcome, isSimpleEthAllocation).allocationItems;

  const {supported: ledgerState} = await store.getEntry(ledgerId);
  const {allocationItems: lAlloc} = checkThat(ledgerState.outcome, isSimpleEthAllocation);
  const ledgerWithoutGuarantor = _.filter(lAlloc, a => a.destination !== guarantorChannelId);

  const [hub, leaf] = ledgerWithoutGuarantor.slice(0, 2);

  const BadOutcome = new Error(Errors.invalidOutcome);
  if (hub.destination !== jAlloc[OutcomeIdx.Hub].destination) throw BadOutcome;
  if (leaf.destination !== jAlloc[role].destination) throw BadOutcome;

  const outcome = simpleEthAllocation([
    {destination: hub.destination, amount: BN.add(hub.amount, jAlloc[2 - role].amount)},
    {destination: leaf.destination, amount: BN.add(leaf.amount, jAlloc[role].amount)},
    ...ledgerWithoutGuarantor.slice(2)
  ]);
  return {state: nextState(ledgerState, outcome)};
};
export {defundGuarantorInLedger};

const acquireLock = (store: Store) => ({ledgerId}: ChannelsSet): Promise<ChannelLock> =>
  store.acquireChannelLock(ledgerId);

type WithLock = Init & {lock: ChannelLock};

const releaseLock = (ctx: WithLock) => ctx.lock.release();

const defundGuarantor: StateNodeConfig<any, any, any> = {
  initial: 'acquireLock',
  states: {
    acquireLock: {
      invoke: {src: acquireLock.name, onDone: 'ledgerUpdate'},
      exit: assign<WithLock>({lock: (_, event: DoneInvokeEvent<ChannelLock>) => event.data})
    },
    ledgerUpdate: getDataAndInvoke(
      {src: defundGuarantorInLedger.name},
      {src: Services.supportState},
      'done'
    ),
    done: {type: 'final'}
  },
  // TODO: implement deleteJointChannel and deleteJointChannel
  // exit: ['deleteJointChannel', 'deleteJointChannel', releaseLock.name],
  exit: [releaseLock.name],
  onDone: 'releaseFundsFromBudget'
};

const releaseFundsFromBudget: StateNodeConfig<any, any, any> = {
  invoke: {
    src: Services.releaseFunds,
    onDone: {target: 'success'}
  }
};

const releaseFunds = (store: Store, messagingService: MessagingServiceInterface) => async (
  context: ChannelsSet
) => {
  const budget = await store.releaseFunds(zeroAddress, context.ledgerId, context.targetChannelId);
  await messagingService.sendBudgetNotification(budget);
};

const getApplicationDomain = (store: Store) => async (context: ChannelsSet) => {
  const ledgerEntry = await store.getEntry(context.ledgerId);
  if (!ledgerEntry.applicationDomain) {
    throw new Error(`No app domain set for ledger channel ${context.ledgerId}`);
  }
  return ledgerEntry.applicationDomain;
};

export const config: StateNodeConfig<any, any, any> = {
  key: PROTOCOL,
  initial: 'checkChannels',
  states: {
    checkChannels,
    closeTarget,
    defundTarget,
    defundGuarantor,
    releaseFundsFromBudget,
    success: {type: 'final'}
  }
};

type WorkflowServices = Record<Services, ServiceConfig<any>>;

const services = (store: Store, messagingService: MessagingServiceInterface): WorkflowServices => ({
  checkChannelsService: checkChannelsService(store),
  acquireLock: acquireLock(store),
  defundGuarantorInLedger: defundGuarantorInLedger(store),
  finalJointChannelUpdate: finalJointChannelUpdate(store),
  finalTargetState: finalTargetState(store),
  supportState: SupportState.machine(store),
  releaseFunds: releaseFunds(store, messagingService),
  getApplicationDomain: getApplicationDomain(store)
});
const options = (store: Store, messagingService: MessagingServiceInterface) => ({
  services: services(store, messagingService),
  actions: {releaseLock}
});

export const machine = (store: Store, messagingService: MessagingServiceInterface) =>
  Machine(config).withConfig(options(store, messagingService));
