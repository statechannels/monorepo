import {AddressZero} from 'ethers/constants';
import {hexZeroPad, bigNumberify} from 'ethers/utils';
import {Destination} from './store';

// TODO: Use getEnvBool from devtools once working
function getBool(val: string | undefined): boolean {
  switch (val) {
    case undefined:
    case null:
    case 'null':
    case 'false':
    case 'FALSE':
    case '0':
      return false;
    default:
      return true;
  }
}

export const NODE_ENV: string = process.env.NODE_ENV as string;

export const WALLET_VERSION: string = process.env.WALLET_VERSION || 'xstate-wallet@VersionTBD';

export const CHAIN_NETWORK_ID: string = process.env.CHAIN_NETWORK_ID || '0';

export const CLEAR_STORAGE_ON_START = getBool(process.env.CLEAR_STORAGE_ON_START);

export const ETH_ASSET_HOLDER_ADDRESS: string = process.env.ETH_ASSET_HOLDER_ADDRESS || AddressZero;

export const HUB_ADDRESS: string =
  process.env.HUB_ADDRESS || '0xaaaa84838319627Fa056fC3FC29ab94d479B8502';

export const HUB_DESTINATION = (process.env.HUB_DESTINATION ||
  hexZeroPad('0x8199de05654e9afa5c081bce38f140082c9a7733', 32)) as Destination;

export const LOG_DESTINATION: string | undefined = process.env.LOG_DESTINATION;

export const NITRO_ADJUDICATOR_ADDRESS: string =
  process.env.NITRO_ADJUDICATOR_ADDRESS || AddressZero;

export const USE_INDEXED_DB = getBool(process.env.USE_INDEXED_DB);

export const CHALLENGE_DURATION = bigNumberify(process.env.CHALLENGE_DURATION || '0x12c');

// TODO: Embed this inside logger.ts
export const ADD_LOGS = !!LOG_DESTINATION;

export const HUB = {
  destination: HUB_DESTINATION,
  signingAddress: HUB_ADDRESS,
  participantId: 'firebase:simple-hub'
};
