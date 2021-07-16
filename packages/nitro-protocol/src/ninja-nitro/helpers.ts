import {BigNumber, constants} from 'ethers';

import {AllocationItem, Guarantee} from '../contract/outcome';

/**
 *
 * Emulates solidity code. TODO replace with PureEVM implementation?
 * @param initialHoldings
 * @param allocation
 * @param indices
 */
export function computeNewAllocationWithGuarantee(
  initialHoldings: string,
  allocation: AllocationItem[], // we must index this with a JS number that is less than 2**32 - 1
  indices: number[],
  guarantee: Guarantee
): {newAllocation: AllocationItem[]; deleted: boolean; payOuts: AllocationItem[]} {
  let safeToDelete = true;
  let surplus = BigNumber.from(initialHoldings);
  let k = 0;

  // copy allocation
  const newAllocation: AllocationItem[] = [];
  const payOuts: AllocationItem[] = [];
  const payOutsLength = indices.length > 0 ? indices.length : allocation.length;
  for (let i = 0; i < payOutsLength; i++) {
    // This mirrors the way arrays are intialized in solidity
    payOuts.push({
      destination: constants.HashZero,
      amount: '0x00',
    });
  }
  for (let i = 0; i < allocation.length; i++) {
    newAllocation.push({
      destination: allocation[i].destination,
      amount: allocation[i].amount,
    });
  }

  // for each guarantee destination
  for (let j = 0; j < guarantee.destinations.length; j++) {
    if (surplus.isZero()) break;
    for (let i = 0; i < newAllocation.length; i++) {
      if (surplus.isZero()) break;
      // search for it in the allocation
      if (
        BigNumber.from(guarantee.destinations[j]).eq(BigNumber.from(newAllocation[i].destination))
      ) {
        // if we find it, compute new amount
        const affordsForDestination = min(BigNumber.from(newAllocation[i].amount), surplus);
        // decrease surplus by the current amount regardless of hitting a specified index
        surplus = surplus.sub(affordsForDestination);
        if (indices.length === 0 || (k < indices.length && indices[k] === i)) {
          // only if specified in supplied indices, or we if we are doing "all"
          // reduce the current allocationItem.amount
          newAllocation[i].amount = BigNumber.from(newAllocation[i].amount)
            .sub(affordsForDestination)
            .toHexString();
          // increase the relevant payout
          payOuts[k].destination = allocation[i].destination;
          payOuts[k].amount = affordsForDestination.toHexString();
          ++k;
        }
        break;
      }
    }
  }

  for (let i = 0; i < allocation.length; i++) {
    if (!BigNumber.from(newAllocation[i].amount).isZero()) {
      safeToDelete = false;
      break;
    }
  }

  return {
    newAllocation,
    deleted: safeToDelete,
    payOuts,
  };
}
function min(a: BigNumber, b: BigNumber) {
  return a.gt(b) ? b : a;
}
