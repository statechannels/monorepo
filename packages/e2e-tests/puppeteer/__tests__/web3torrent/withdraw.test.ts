/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/explicit-function-return-type */
/* eslint-disable jest/expect-expect */
import {
  setUpBrowser,
  waitForBudgetEntry,
  withdrawAndWait,
  waitForEmptyBudget,
  setupLogging,
  setupFakeWeb3,
  takeScreenshot,
  waitForAndClickButton
} from '../../helpers';
import {
  JEST_TIMEOUT,
  USES_VIRTUAL_FUNDING,
  HEADLESS,
  USE_DAPPETEER,
  APP_URL as WEB3TORRENT_URL,
  CLOSE_BROWSERS
} from '../../constants';
import {Browser, Page} from 'puppeteer';
import {uploadFile} from '../../scripts/web3torrent';
import {Dappeteer} from 'dappeteer';

jest.setTimeout(JEST_TIMEOUT);
let browser: Browser;
let metamask: Dappeteer;

let web3tTabA: Page;
const itOrSkip = USES_VIRTUAL_FUNDING ? it : it.skip;
describe('withdrawal from a ledger channel', () => {
  beforeAll(async () => {
    // 100ms sloMo avoids some undiagnosed race conditions
    console.log('Opening browser');

    ({browser, metamask} = await setUpBrowser(HEADLESS, 2, 0));

    console.log('Waiting on pages');
    web3tTabA = (await browser.pages())[0];

    console.log('Loading dapps');
    await setupLogging(web3tTabA, 0, 'withdraw', true);
    if (!USE_DAPPETEER) await setupFakeWeb3(web3tTabA, 0);
    await web3tTabA.goto(WEB3TORRENT_URL + '/upload', {waitUntil: 'load'});
    await web3tTabA.bringToFront();
  });

  afterAll(async () => {
    await takeScreenshot(web3tTabA, 'withdraw');
    CLOSE_BROWSERS && browser && (await browser.close());
  });

  itOrSkip('allows a player to withdraw funds from the ledger channel', async () => {
    await uploadFile(web3tTabA, USES_VIRTUAL_FUNDING, metamask);

    await waitForBudgetEntry(web3tTabA);

    await waitForAndClickButton(web3tTabA, web3tTabA.frames()[0], '#cancel-download-button');
    await withdrawAndWait(web3tTabA, metamask);

    await waitForEmptyBudget(web3tTabA);
  });
});
