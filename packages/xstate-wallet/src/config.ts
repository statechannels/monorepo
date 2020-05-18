import {AddressZero} from 'ethers/constants';
import {bigNumberify} from 'ethers/utils';
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

export const GIT_VERSION = process.env.GIT_VERSION;

export const NODE_ENV: string = process.env.NODE_ENV as string;

export const CHAIN_NETWORK_ID: string = process.env.CHAIN_NETWORK_ID || '0';

export const CLEAR_STORAGE_ON_START = getBool(process.env.CLEAR_STORAGE_ON_START);

export const ETH_ASSET_HOLDER_ADDRESS: string = process.env.ETH_ASSET_HOLDER_ADDRESS || AddressZero;

export const HUB_ADDRESS: string =
  process.env.HUB_ADDRESS || '0xaaaa84838319627Fa056fC3FC29ab94d479B8502';

if (!process.env.HUB_DESTINATION) {
  throw new Error('HUB_DESTINATION environment variable must be defined');
}
export const HUB_DESTINATION = process.env.HUB_DESTINATION as Destination;

export const LOG_DESTINATION: string | undefined = process.env.LOG_DESTINATION;

export const NITRO_ADJUDICATOR_ADDRESS: string =
  process.env.NITRO_ADJUDICATOR_ADDRESS || AddressZero;

export const USE_INDEXED_DB = getBool(process.env.USE_INDEXED_DB);

export const CHALLENGE_DURATION = bigNumberify(process.env.CHALLENGE_DURATION || '0x12c');

export const JEST_WORKER_ID: string | undefined = process.env.JEST_WORKER_ID;

// TODO: Embed this inside logger.ts
export const ADD_LOGS = !!LOG_DESTINATION;

export const HUB = {
  destination: HUB_DESTINATION,
  signingAddress: HUB_ADDRESS,
  participantId: 'firebase:simple-hub'
};
