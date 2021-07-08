import {
  Allocation as AppAllocation,
  Allocations as AppAllocations,
  AllocationItem as AppAllocationItem,
  DomainBudget as AppDomainBudget,
  TokenBudget
} from '@statechannels/client-api-schema';
import {constants} from 'ethers';

import {Allocation, AllocationItem, SimpleAllocation, DomainBudget, AssetBudget} from '../../types';
import {checkThat, exists, formatAmount} from '../../utils';
import {BN} from '../../bignumber';

export function serializeDomainBudget(budget: DomainBudget): AppDomainBudget {
  const budgets: TokenBudget[] = Object.keys(budget.forAsset).map(asset => {
    const assetBudget = checkThat<AssetBudget>(budget.forAsset[asset], exists);
    const channels = Object.keys(assetBudget.channels).map(channelId => ({
      channelId,
      amount: formatAmount(BN.from(assetBudget.channels[channelId].amount))
    }));
    return {
      asset: asset || constants.AddressZero,
      availableReceiveCapacity: formatAmount(assetBudget.availableReceiveCapacity),
      availableSendCapacity: formatAmount(assetBudget.availableSendCapacity),
      channels
    };
  });

  return {
    domain: budget.domain,
    hubAddress: budget.hubAddress,
    budgets
  };
}

export function serializeAllocation(allocation: Allocation): AppAllocations {
  switch (allocation.type) {
    case 'SimpleAllocation':
      return [serializeSimpleAllocation(allocation)];
    case 'MixedAllocation':
      return allocation.simpleAllocations.map(serializeSimpleAllocation);
  }
}

function serializeSimpleAllocation(allocation: SimpleAllocation): AppAllocation {
  return {
    allocationItems: allocation.allocationItems.map(serializeAllocationItem),
    asset: allocation.asset
  };
}

function serializeAllocationItem(allocationItem: AllocationItem): AppAllocationItem {
  return {
    destination: allocationItem.destination,
    amount: formatAmount(allocationItem.amount)
  };
}
