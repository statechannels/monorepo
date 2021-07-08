import _ from 'lodash';
import {
  AllocationItem,
  BN,
  makeDestination,
  SimpleAllocation,
  Destination,
} from '@statechannels/wallet-core';

import {Uint256} from '../../type-aliases';

export class SimpleAllocationOutcome {
  private outcome: SimpleAllocation;

  constructor(outcome: SimpleAllocation) {
    this.outcome = outcome;
  }

  public get destinations(): Destination[] {
    return this.outcome.allocationItems.map(i => i.destination);
  }

  public balanceFor(destination: Destination): Uint256 | undefined {
    return this.itemFor(destination)?.amount;
  }

  public get toLegacyAllocation(): SimpleAllocation {
    return this.outcome;
  }

  public get items(): SimpleAllocation['allocationItems'] {
    return this.outcome.allocationItems;
  }

  public dup(): SimpleAllocationOutcome {
    const newOutcome = _.cloneDeep(this.outcome);
    return new SimpleAllocationOutcome(newOutcome);
  }

  public isEqualTo(otherOutcome: SimpleAllocationOutcome | undefined): boolean {
    return (
      !!otherOutcome &&
      this.outcome.type === otherOutcome.toLegacyAllocation.type &&
      this.outcome.asset === otherOutcome.toLegacyAllocation.asset &&
      _.every(_.zip(this.items, otherOutcome.items).map(([a, b]) => allocationItemsEqual(a, b)))
    );
  }

  public remove(
    channelId: Destination,
    refundDestinations: Destination[],
    refundAmounts: Uint256[]
  ): SimpleAllocationOutcome | undefined {
    if (refundDestinations.length !== refundAmounts.length)
      throw new Error('Destinations and amounts have different lengths');
    // check that channelId exists
    const itemToRemove = this.itemFor(channelId);
    const refundItems = refundDestinations.map(d => this.itemFor(d));

    // check that all destinations exist
    if (!itemToRemove || _.some(refundItems, _.isUndefined)) return undefined;

    // and the refund amounts tally with the amount in the channel
    if (!BN.eq(itemToRemove.amount, refundAmounts.reduce(BN.add))) return undefined;

    // remove the item
    _.remove(this.outcome.allocationItems, itemToRemove);

    // and increase the amounts
    for (const [item, amt] of _.zip(refundItems, refundAmounts)) {
      if (item && amt) {
        // we've already checked that items aren't undefined and the two arrays have the
        // same length, so we'll always up in here. Typescript doesn't know that though
        item.amount = BN.add(item.amount, amt);
      }
    }

    return this;
  }

  private itemFor(destination: Destination): AllocationItem | undefined {
    return this.outcome.allocationItems.find(i => i.destination === destination);
  }

  public add(
    channelId: Destination,
    fundingSources: Destination[],
    fundingAmounts: Uint256[]
  ): SimpleAllocationOutcome | undefined {
    if (fundingSources.length !== fundingAmounts.length)
      throw new Error('Sources and amounts have different lengths');
    // check that channelId exists
    const sourceItems = fundingSources.map(d => this.itemFor(d));

    for (const [item, amt] of _.zip(sourceItems, fundingAmounts)) {
      // check that all sources exist
      if (!item) return undefined;
      // shouldn't ever happen, as we checked the lengths above, but typescript doesn't know this
      if (!amt) throw new Error('More sources that amounts');
      // and have enough funds
      if (!BN.gte(item.amount, amt)) return undefined;
    }

    // add the new amount
    this.outcome.allocationItems.push({
      destination: makeDestination(channelId),
      amount: BN.from(fundingAmounts.reduce(BN.add)),
    });

    // and decrease the amounts
    for (const [item, amt] of _.zip(sourceItems, fundingAmounts)) {
      if (item && amt) {
        // we've already checked that items aren't undefined and the two arrays have the
        // same length, so we'll always up in here. Typescript doesn't know that though
        item.amount = BN.sub(item.amount, amt);
      }
    }

    return this;
  }
}

function allocationItemsEqual(
  a: AllocationItem | undefined,
  b: AllocationItem | undefined
): boolean {
  if (a && b) {
    return a.destination === b.destination && BN.eq(a.amount, b.amount);
  } else {
    return false;
  }
}
