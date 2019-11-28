import {Zero} from "ethers/constants";
import {BigNumber} from "ethers/utils";
import {Uint256} from "@statechannels/nitro-protocol/src/contract/types";

export interface AssetHoldersState {
  [assetHolderAddress: string]: AssetHolderState;
}

export interface AssetHolderState {
  [channelId: string]: AssetHolderChannelState;
}

export interface AssetHolderChannelState {
  channelId: string;
  holdings: Uint256;
}

function getOrCreateAssetHolderChannelState(
  assetHoldersState: AssetHoldersState,
  assetHolderAddress: string,
  channelId: string
): AssetHolderChannelState {
  let assetHolderChannelState = getAssetHolderChannelState(
    assetHoldersState,
    assetHolderAddress,
    channelId
  );
  if (!assetHolderChannelState) {
    assetHolderChannelState = {channelId, holdings: Zero.toString()};
  }
  return assetHolderChannelState;
}

export function getAssetHolderState(
  assetHoldersState: AssetHoldersState,
  assetHolderAddress: string
): AssetHolderState | undefined {
  return assetHoldersState[assetHolderAddress];
}

export function getAssetHolderChannelState(
  assetHoldersState: AssetHoldersState,
  assetHolderAddress: string,
  channelId: string
): AssetHolderChannelState | undefined {
  const assetHolderState = assetHoldersState[assetHolderAddress];
  if (!assetHolderState) {
    return undefined;
  }
  return assetHolderState[channelId];
}

function setAssetHolderChannelState(
  assetHoldersState: AssetHoldersState,
  assetHolderAddress: string,
  assetHolderChannelState: AssetHolderChannelState
) {
  return {
    ...assetHoldersState,
    [assetHolderAddress]: {
      ...getAssetHolderState(assetHoldersState, assetHolderAddress),
      [assetHolderChannelState.channelId]: assetHolderChannelState
    }
  };
}

export function recordDeposit(
  assetHoldersState: AssetHoldersState,
  assetHolderAddress: string,
  channelId: string,
  holdings: BigNumber
): AssetHoldersState {
  const assetHolderChannelState = getOrCreateAssetHolderChannelState(
    assetHoldersState,
    assetHolderAddress,
    channelId
  );
  const newAssetHolderChannelState = {...assetHolderChannelState, holdings: holdings.toHexString()};
  return setAssetHolderChannelState(
    assetHoldersState,
    assetHolderAddress,
    newAssetHolderChannelState
  );
}
