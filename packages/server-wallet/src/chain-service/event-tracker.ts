import {Logger} from 'pino';

import {
  HoldingUpdatedArg,
  AllocationUpdatedArg,
  ChannelFinalizedArg,
  ChallengeRegisteredArg,
  ChainEventSubscriberInterface,
} from './types';

/**
 * This class is a wrapper of ChainEventSubscriberInterface.
 * Purpose - 2 functions can trigger AssetHolder events to be played to ChainEventSubscriberInterface
 *    1. chainservice.getInitialHoldings
 *    2. chainservice.onAssetEvent
 * Some events can be played twice by both functions, order not predictable,
 * this class ensures each event is played once and in the right order
 */
export class EventTracker {
  private logger: Logger;
  private eventRecordFor: Map<string, {blockNumber: number; logIndex: number}>;
  private managedSubscriber: ChainEventSubscriberInterface;

  constructor(managedSubscriber: ChainEventSubscriberInterface, logger: Logger) {
    this.logger = logger;
    this.managedSubscriber = managedSubscriber;
    this.logger = logger;
    this.eventRecordFor = new Map<string, {blockNumber: number; logIndex: number}>();
  }

  private isNewEvent(queue: string, blockNumber: number, logIndex: number): boolean {
    const eventRecord = this.eventRecordFor.get(queue);
    this.logger.debug(
      `EventTracker.isNewEvent: ${queue}, ${blockNumber}, ${logIndex}, ${JSON.stringify(
        eventRecord
      )}`
    );

    let isNew = false;
    if (!eventRecord) {
      isNew = true;
    } else if (blockNumber > eventRecord.blockNumber) {
      isNew = true;
    } else if (blockNumber === eventRecord.blockNumber) {
      if (logIndex > eventRecord.logIndex) {
        isNew = true;
      }
    }

    if (isNew) {
      // Save latest event ever seen
      this.eventRecordFor.set(queue, {blockNumber: blockNumber, logIndex: logIndex});
      this.logger.debug('Event is new');
      return true;
    } else {
      this.logger.debug('Event is not new');
      return false;
    }
  }

  // Pass event to managed subscriber only if new
  holdingUpdated(
    arg: HoldingUpdatedArg,
    blockNumber: number,
    logIndex: number = Number.MAX_SAFE_INTEGER // Why default to max: getInitialHoldings can call this without logIndex,
    // in which case should be considered the latest balance in block
  ): void {
    if (this.isNewEvent(arg.asset, blockNumber, logIndex)) {
      this.managedSubscriber.holdingUpdated(arg);
    }
  }

  // Pass event to managed subscriber only if new
  allocationUpdated(arg: AllocationUpdatedArg, blockNumber: number, logIndex: number): void {
    if (this.isNewEvent('AllocationUpdatedQueue', blockNumber, logIndex)) {
      this.managedSubscriber.allocationUpdated(arg);
    }
  }

  // This event is not from AssetHolder so no check needed
  channelFinalized(arg: ChannelFinalizedArg): void {
    this.managedSubscriber.channelFinalized(arg);
  }

  // This event is not from AssetHolder so no check needed
  challengeRegistered(arg: ChallengeRegisteredArg): void {
    this.managedSubscriber.challengeRegistered(arg);
  }
}
