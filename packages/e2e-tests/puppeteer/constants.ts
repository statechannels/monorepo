import {getEnvBool, configureEnvVariables} from '@statechannels/devtools';
configureEnvVariables();
export const HEADLESS = getEnvBool('HEADLESS');
export const USE_DAPPETEER = getEnvBool('USE_DAPPETEER');
export const USES_VIRTUAL_FUNDING = process.env.REACT_APP_FUNDING_STRATEGY === 'Virtual';
export const JEST_TIMEOUT = HEADLESS ? 200_000 : 1_000_000;
export const TARGET_NETWORK = process.env.TARGET_NETWORK ? process.env.TARGET_NETWORK : 'localhost';
export const WEB3TORRENT_URL = process.env.WEB3TORRENT_URL
  ? process.env.WEB3TORRENT_URL
  : 'http://localhost:3000';
