import {utils} from 'ethers';

import {parseEventResult} from '../ethers-utils';
import {hexZeroPad} from 'ethers/utils';

export interface DepositedEvent {
  destination: string;
  amountDeposited: utils.BigNumber;
  destinationHoldings: utils.BigNumber;
}

export interface AssetTransferredEvent {
  channelId: string;
  destination: string;
  amount: utils.BigNumber;
}

export function getDepositedEvent(eventResult: any[]): DepositedEvent {
  const {destination, amountDeposited, destinationHoldings} = parseEventResult(eventResult);
  return {
    destination,
    amountDeposited: utils.bigNumberify(amountDeposited),
    destinationHoldings: utils.bigNumberify(destinationHoldings),
  };
}

export function getAssetTransferredEvent(eventResult: any[]): AssetTransferredEvent {
  const {channelId, destination, amount} = parseEventResult(eventResult);
  return {
    channelId,
    destination,
    amount: utils.bigNumberify(amount),
  };
}

export function convertBytes32ToAddress(bytes32: string): string {
  const normalized = utils.bigNumberify(bytes32).toHexString();
  return utils.getAddress(`0x${normalized.slice(-40)}`);
}

// e.g.,
// 0x9546E319878D2ca7a21b481F873681DF344E0Df8 becomes
// 0x0000000000000000000000009546E319878D2ca7a21b481F873681DF344E0Df8
export function convertAddressToBytes32(address: string): string {
  const normalizedAddress = utils.bigNumberify(address).toHexString();
  if (normalizedAddress.length !== 42) {
    throw new Error(
      `Address value is not right length. Expected length of 42 received length ${normalizedAddress.length} instead.`
    );
  }

  // We pad to 66 = (32*2) + 2('0x')
  return hexZeroPad(normalizedAddress, 32);
}
