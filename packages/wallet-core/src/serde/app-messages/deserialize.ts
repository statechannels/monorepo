import {
  Allocation as AppAllocation,
  Allocations as AppAllocations,
  AllocationItem as AppAllocationItem,
  DomainBudget as AppDomainBudget,
  ApproveBudgetAndFundParams as AppBudgetRequest
} from '@statechannels/client-api-schema';
import {constants} from 'ethers';

import {
  Allocation,
  AllocationItem,
  SimpleAllocation,
  DomainBudget,
  AssetBudget,
  makeAddress
} from '../../types';
import {BN} from '../../bignumber';
import {makeDestination} from '../../utils';
import {zeroAddress} from '../../config';

export function deserializeBudgetRequest(
  budgetRequest: AppBudgetRequest,
  domain: string
): DomainBudget {
  const assetBudget: AssetBudget = {
    asset: zeroAddress,
    availableSendCapacity: BN.from(budgetRequest.requestedSendCapacity),
    availableReceiveCapacity: BN.from(budgetRequest.requestedReceiveCapacity),
    channels: {}
  };
  return {
    domain,
    hubAddress: budgetRequest.hub.signingAddress,
    forAsset: {[zeroAddress]: assetBudget}
  };
}

export function deserializeDomainBudget(DomainBudget: AppDomainBudget): DomainBudget {
  const assetBudgets: AssetBudget[] = DomainBudget.budgets.map(b => ({
    asset: b.asset || constants.AddressZero,
    availableReceiveCapacity: BN.from(b.availableReceiveCapacity),
    availableSendCapacity: BN.from(b.availableSendCapacity),
    channels: b.channels.reduce((record, item) => {
      record[item.channelId] = {amount: BN.from(item.amount)};
      return record;
    }, {})
  }));
  const budgets = assetBudgets.reduce((record, a) => {
    record[a.asset] = a;
    return record;
  }, {});

  return {
    domain: DomainBudget.domain,
    hubAddress: DomainBudget.hubAddress,
    forAsset: budgets
  };
}

export function deserializeAllocations(allocations: AppAllocations): Allocation {
  switch (allocations.length) {
    case 0:
      throw new Error('Allocations is empty');
    case 1:
      return deserializeAllocation(allocations[0]);
    default:
      return {
        type: 'MixedAllocation',
        simpleAllocations: allocations.map(deserializeAllocation)
      };
  }
}

function deserializeAllocation(allocation: AppAllocation): SimpleAllocation {
  return {
    type: 'SimpleAllocation',
    allocationItems: allocation.allocationItems.map(deserializeAllocationItem),
    asset: makeAddress(allocation.asset)
  };
}

function deserializeAllocationItem(allocationItem: AppAllocationItem): AllocationItem {
  return {
    destination: makeDestination(allocationItem.destination),
    amount: BN.from(allocationItem.amount)
  };
}
