import * as _ from 'lodash';
import {ethers} from 'ethers';

import {
  AllocationItem,
  SimpleAllocation,
  SimpleGuarantee,
  Outcome,
  Allocation,
  Destination,
  Address,
  makeAddress
} from '../types';
import {BN, Zero} from '../bignumber';
import {zeroAddress} from '../config';

import {checkThat} from './helpers';

export function isSimpleAllocation(outcome: Outcome): outcome is SimpleAllocation {
  return outcome.type === 'SimpleAllocation';
}

export function isSimpleEthAllocation(outcome: Outcome): outcome is SimpleAllocation {
  return outcome.type === 'SimpleAllocation' && outcome.asset === ethers.constants.AddressZero;
}

export function assertSimpleEthAllocation(outcome: Outcome): SimpleAllocation {
  return checkThat(outcome, isSimpleEthAllocation);
}

export const simpleEthAllocation = (allocationItems: AllocationItem[]): SimpleAllocation => ({
  type: 'SimpleAllocation',
  asset: zeroAddress,
  allocationItems
});

export const simpleEthGuarantee = (
  targetChannelId: string,
  ...destinations: string[]
): SimpleGuarantee => ({
  type: 'SimpleGuarantee',
  destinations,
  targetChannelId,
  asset: zeroAddress
});

export const simpleTokenAllocation = (
  asset: Address,
  allocationItems: AllocationItem[]
): SimpleAllocation => ({
  type: 'SimpleAllocation',
  asset,
  allocationItems
});

export enum Errors {
  DestinationMissing = 'Destination missing from ledger channel',
  InsufficientFunds = 'Insufficient funds in ledger channel',
  InvalidOutcomeType = 'Invalid outcome type'
}

export const areAllocationItemsEqual = (a: AllocationItem, b: AllocationItem): boolean =>
  a.destination === b.destination && BN.eq(a.amount, b.amount);

export function allocateToTarget(
  currentOutcome: Outcome,
  deductions: readonly AllocationItem[],
  targetChannelId: string
): Allocation {
  if (currentOutcome.type !== 'SimpleAllocation') {
    throw new Error(Errors.InvalidOutcomeType);
  }

  currentOutcome = _.cloneDeep(currentOutcome);

  let total = Zero;
  let currentItems = currentOutcome.allocationItems;

  deductions
    .filter(i => BN.gt(i.amount, 0))
    .forEach(targetItem => {
      const ledgerItem = currentItems.find(i => i.destination === targetItem.destination);
      if (!ledgerItem) {
        throw new Error(Errors.DestinationMissing);
      }

      total = BN.add(total, targetItem.amount);
      ledgerItem.amount = BN.sub(ledgerItem.amount, targetItem.amount);

      if (BN.lt(ledgerItem.amount, 0)) throw new Error(Errors.InsufficientFunds);
    });

  currentItems.push({amount: total, destination: makeDestination(targetChannelId)});
  currentItems = currentItems.filter(i => BN.gt(i.amount, 0));

  currentOutcome.allocationItems = currentItems;
  return currentOutcome;
}

export function makeDestination(addressOrDestination: string): Destination {
  // '0x' + 20 byte ethereum address and 0x
  const addressLength = 20 * 2 + 2;
  // '0x' + 32 bytes
  const destinationLength = 32 * 2 + 2;
  const zeroPrefix =
    '0x' + _.range(destinationLength - addressLength).reduce(soFar => soFar.concat('0'), '');

  // If an ethereum address is passed in, prepend 0s
  if (addressOrDestination.length === addressLength) {
    return ethers.utils.hexZeroPad(makeAddress(addressOrDestination), 32) as Destination;
    // The full length destination might be a channel ID or an ethereum address prepended with 0s
  } else if (addressOrDestination.length === destinationLength) {
    // This is an etherum address prepended with 0s
    // Checksum the address
    if (addressOrDestination.startsWith(zeroPrefix)) {
      return ethers.utils.hexZeroPad(
        makeAddress(addressOrDestination.substr(zeroPrefix.length)),
        32
      ) as Destination;
    }
    return addressOrDestination.toLowerCase() as Destination;
  } else {
    throw new Error('Invalid input');
  }
}
