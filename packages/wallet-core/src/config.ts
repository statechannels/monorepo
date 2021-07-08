import {constants} from 'ethers';

import {Destination, makeAddress} from './types';

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

export const INFURA_API_KEY: string | undefined = process.env.INFURA_API_KEY;

export const CLEAR_STORAGE_ON_START = getBool(process.env.CLEAR_STORAGE_ON_START);

export const HUB_PARTICIPANT_ID = 'firebase:simple-hub';
export const HUB_ADDRESS: string =
  process.env.HUB_ADDRESS || '0xaaaa84838319627Fa056fC3FC29ab94d479B8502';

export const HUB_DESTINATION = process.env.HUB_DESTINATION as Destination;

export const LOG_DESTINATION: string | undefined = process.env.LOG_DESTINATION
  ? process.env.LOG_DESTINATION === 'console'
    ? 'console'
    : `${process.env.LOG_DESTINATION}/wallet.log`
  : undefined;

export const NITRO_ADJUDICATOR_ADDRESS: string =
  process.env.NITRO_ADJUDICATOR_ADDRESS || constants.AddressZero;

export const zeroAddress = makeAddress(constants.AddressZero);

export const TRIVIAL_APP_ADDRESS: string = process.env.TRIVIAL_APP_ADDRESS || constants.AddressZero;

export const USE_INDEXED_DB = getBool(process.env.USE_INDEXED_DB);

export const CHALLENGE_DURATION = Number(process.env.CHALLENGE_DURATION || 300);

export const JEST_WORKER_ID: string | undefined = process.env.JEST_WORKER_ID;

export const ADD_LOGS = !!LOG_DESTINATION;
export const LOG_LEVEL = ADD_LOGS
  ? process.env.LOG_LEVEL
    ? process.env.LOG_LEVEL
    : 'info'
  : 'silent';

export const HUB = {
  destination: HUB_DESTINATION,
  signingAddress: HUB_ADDRESS,
  participantId: 'firebase:simple-hub'
};

export const TARGET_NETWORK = process.env.TARGET_NETWORK || 'development';
export const FAUCET_LINK =
  TARGET_NETWORK === 'goerli' ? 'https://goerli-faucet.slock.it/' : 'https://faucet.ropsten.be/';
