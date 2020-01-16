import { EventObject, SendAction, StateMachine, forwardTo } from 'xstate';
import { Outcome, Allocation, State } from '@statechannels/nitro-protocol';
import { ChannelUpdated, IStore } from './store';
import {
  AllocationAssetOutcome,
  Guarantee,
  GuaranteeAssetOutcome,
  isAllocationOutcome,
  AssetOutcome,
} from '@statechannels/nitro-protocol/lib/src/contract/outcome';
import { Signature, hexZeroPad } from 'ethers/utils';
import { AddressZero } from 'ethers/constants';
export { Store, IStore } from './store';
export interface Balance {
  address: string;
  wei: string;
}

export function getEthAllocation(outcome: Outcome): Allocation {
  const ethOutcome: AssetOutcome | undefined = outcome.find(
    o => o.assetHolderAddress === AddressZero
  );
  return checkThat(ethOutcome, isAllocationOutcome).allocation;
}

export function ethAllocationOutcome(allocation: Allocation): AllocationAssetOutcome[] {
  return [
    {
      assetHolderAddress: AddressZero,
      allocation: allocation.map(a => ({ ...a, destination: hexZeroPad(a.destination, 32) })),
    },
  ];
}

export function ethGuaranteeOutcome(guarantee: Guarantee): GuaranteeAssetOutcome[] {
  return [
    {
      assetHolderAddress: AddressZero,
      guarantee,
    },
  ];
}

interface VariablePart {
  turnNum: number;
  outcome: Outcome;
  isFinal: boolean;
}

export function nextState(state: State, opts?: Partial<VariablePart>): State {
  return {
    ...state,
    turnNum: state.turnNum + 1,
    ...opts,
  };
}

export { Channel, getChannelId } from '@statechannels/nitro-protocol';

export interface SignedState {
  state: State;
  signatures: Signature[];
}

export interface Failure {
  value: 'failure';
  context: {
    reason: string;
  };
}

export interface Entry {
  type: '';
}

export { chain } from './chain';

// This stuff should be replaced with some big number logic
type numberish = string | number | undefined;
type MathOp = (a: numberish, b: numberish) => string;
export const add: MathOp = (a: numberish, b: numberish) =>
  (Number(a || 0) + Number(b || 0)).toString();
export const subtract: MathOp = (a: numberish, b: numberish) => {
  const numA = Number(a);
  const numB = Number(b);

  if (numB > numA) {
    throw new Error('Unsafe subtraction');
  }
  return (numA - numB).toString();
};

export const max: MathOp = (a: numberish, b: numberish) =>
  Math.max(Number(a), Number(b)).toString();
export const gt = (a: numberish, b: numberish) => Number(a) > Number(b);

export const success: { type: 'final' } = { type: 'final' };
export const failure: { type: 'final' } = { type: 'final' };

export type Without<T, K> = {
  [L in Exclude<keyof T, K>]: T[L];
};

export const pretty = o => JSON.stringify(o, null, 2);

type Transition<C> = { actions: SendAction<C, ChannelUpdated> };
export function forwardChannelUpdated<C>(id: string): Transition<C> {
  return { actions: forwardTo(id) };
}

// TODO
// Some machine factories require a context, and some don't
// Sort this out.
export type MachineFactory<I, E extends EventObject> = (
  store: IStore,
  context?: I
) => StateMachine<I, any, E>;

export function unreachable(x: never) {
  return x;
}

export function ensureExists<T>(t: T | undefined): T {
  if (!t) {
    throw new Error('Is undefined');
  }

  return t;
}

export function isDefined<T>(t: T | undefined): t is T {
  return !!t;
}

export const FINAL = 'final' as 'final';

export function outcomesEqual(left: Outcome, right: Outcome): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

const throwError = (fn: (t1: any) => boolean, t) => {
  throw new Error(`not valid, ${fn.name} failed on ${t}`);
};
type TypeGuard<T, S> = (t1: T | S) => t1 is T;
export function checkThat<T, S>(t: T | S, isTypeT: TypeGuard<T, S>): T {
  if (!isTypeT(t)) {
    throwError(isTypeT, t);
    // Typescrypt doesn't know that throwError throws an error.
    throw 'Unreachable';
  }
  return t;
}
