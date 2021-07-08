import {
  ChannelResult,
  ChannelStatus,
  Allocation as AppAllocation,
  Allocations as AppAllocations,
  AllocationItem as AppAllocationItem
} from '@statechannels/client-api-schema';
import {
  Allocation,
  AllocationItem,
  formatAmount,
  isAllocation,
  SimpleAllocation
} from '@statechannels/wallet-core';

import {ChannelStoreEntry} from '../store/channel-store-entry';

export function serializeChannelEntry(channelEntry: ChannelStoreEntry): ChannelResult {
  const {
    latest: {appData, turnNum, outcome}, // TODO: This should be supported
    channelConstants: {participants, appDefinition},
    channelId
  } = channelEntry;

  if (!isAllocation(outcome)) {
    throw new Error('Can only send allocations to the app');
  }

  let status: ChannelStatus = 'running';
  if (turnNum == 0) {
    status = 'proposed';
  } else if (turnNum < 2 * participants.length - 1) {
    status = 'opening';
  } else if (channelEntry.hasConclusionProof) {
    status = 'closed';
  } else if (channelEntry.isSupported && channelEntry.supported.isFinal) {
    status = 'closing';
  }

  return {
    participants,
    allocations: serializeAllocation(outcome),
    appDefinition,
    appData,
    status,
    turnNum,
    channelId,
    // TODO: remove this hardcoding
    adjudicatorStatus: 'Open'
  };
}

function serializeAllocation(allocation: Allocation): AppAllocations {
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
