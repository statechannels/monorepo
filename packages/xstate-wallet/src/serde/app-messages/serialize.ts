import {
  Allocation as AppAllocation,
  Allocations as AppAllocations,
  AllocationItem as AppAllocationItem,
  SiteBudget as AppSiteBudget
} from '@statechannels/client-api-schema';
import {
  Allocation,
  AllocationItem,
  SimpleAllocation,
  SiteBudget,
  BudgetItem,
  AssetBudget
} from '../../store/types';
import {tokenAddress} from '../../constants';
import {AddressZero} from 'ethers/constants';
import {checkThat, exists} from '../../utils';

export function serializeSiteBudget(budget: SiteBudget): AppSiteBudget {
  const budgets = Object.keys(budget.forAsset).map(assetHolderAddress => {
    const assetBudget = checkThat<AssetBudget>(budget.forAsset[assetHolderAddress], exists);

    return {
      token: tokenAddress(assetHolderAddress) || AddressZero,
      pending: serializeBudgetItem(assetBudget.pending),
      free: serializeBudgetItem(assetBudget.free),
      inUse: serializeBudgetItem(assetBudget.inUse),
      direct: serializeBudgetItem(assetBudget.direct)
    };
  });

  return {
    site: budget.site,
    hub: budget.hubAddress,
    budgets
  };
}
function serializeBudgetItem(budgetItem: BudgetItem): {playerAmount: string; hubAmount: string} {
  return {
    playerAmount: budgetItem.playerAmount.toHexString(),
    hubAmount: budgetItem.hubAmount.toHexString()
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
  const token = tokenAddress(allocation.assetHolderAddress);
  if (!token) {
    throw new Error(`Can't find token address for asset holder ${allocation.assetHolderAddress}`);
  }

  return {
    allocationItems: allocation.allocationItems.map(serializeAllocationItem),
    token
  };
}

function serializeAllocationItem(allocationItem: AllocationItem): AppAllocationItem {
  return {
    destination: allocationItem.destination,
    amount: allocationItem.amount.toHexString()
  };
}
