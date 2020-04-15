import {Browser, Page, Frame, launch} from 'puppeteer';

import * as fs from 'fs';
import * as path from 'path';
import {Dappeteer} from 'dappeteer';

export async function loadDapp(
  page: Page,
  ganacheAccountIndex: number,
  ignoreConsoleError?: boolean
): Promise<void> {
  page.on('pageerror', error => {
    throw error;
  });

  //   await evaluateOnNewDocument(`
  //     window.ethereum.selectedAddress = web3.eth.defaultAccount;
  // `);

  page.on('console', msg => {
    if (msg.type() === 'error' && !ignoreConsoleError) {
      throw new Error(`Error was logged into the console ${msg.text()}`);
    }
    console.log('Page console log: ', msg.text());
  });
}

// waiting for a css selector, and then clicking that selector is more robust than waiting for
// an XPath and then calling .click() on the resolved handle. We do not use the return value from the
// waitForSelector promise, so we avoid any errors where that return value loses its meaning
// https://github.com/puppeteer/puppeteer/issues/3496
// https://github.com/puppeteer/puppeteer/issues/2977
export async function waitForAndClickButton(
  page: Page,
  frame: Frame,
  selector: string
): Promise<void> {
  try {
    await frame.waitForSelector(selector);
  } catch (error) {
    console.error(
      'frame.waitForSelector(' + selector + ') failed on frame ' + (await frame.title())
    );
    await page.screenshot({path: 'e2e-wait.error.png'});
    throw error;
  }
  try {
    return await frame.click(selector);
  } catch (error) {
    console.error('frame.click(' + selector + ') failed on frame ' + (await frame.title()));
    await page.screenshot({path: 'e2e-click.error.png'});
    throw error;
  }
}

export async function setUpBrowser(headless: boolean, slowMo?: number): Promise<Browser> {
  const browser = await launch({
    headless,
    slowMo,
    devtools: !headless,
    // Keep code here for convenience... if you want to use redux-dev-tools
    // then download and unzip the release from Github and specify the location.
    // Github URL: https://github.com/zalmoxisus/redux-devtools-extension/releases
    // args: [
    //   '--disable-extensions-except=/Users/liam/Downloads/redux-dev-tools',
    //   '--load-extension=/Users/liam/Downloads/redux-dev-tools'
    // ],
    //, Needed to allow both windows to execute JS at the same time
    ignoreDefaultArgs: [
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding'
    ],
    args: [
      // Needed to inject web3.js code into wallet iframe
      // https://github.com/puppeteer/puppeteer/issues/2548#issuecomment-390077713
      '--disable-features=site-per-process'
    ]
  });

  return browser;
}

export async function waitForBudgetEntry(page: Page): Promise<void> {
  await page.waitForSelector('.site-budget-table > tbody > tr');
}

export async function waitForEmptyBudget(page: Page): Promise<void> {
  // eslint-disable-next-line no-undef
  await page.waitForFunction(() => !document.querySelector('.site-budget-table'));
}

export async function withdrawAndWait(page: Page): Promise<void> {
  console.log('Withdrawing funds');
  const walletIFrame = page.frames()[1];
  const web3TorrentIFrame = page.frames()[0];
  await waitForAndClickButton(page, web3TorrentIFrame, '#budget-withdraw');
  await waitForAndClickButton(page, walletIFrame, '#approve-withdraw');
}

export async function waitAndApproveBudget(page: Page): Promise<void> {
  console.log('Approving budget');

  const approveBudgetButton = '.approve-budget-button';

  const walletIFrame = page.frames()[1];
  await waitForAndClickButton(page, walletIFrame, approveBudgetButton);
}
export async function waitAndApproveMetaMask(page: Page, metamask: Dappeteer): Promise<void> {
  console.log('Approving metamask');

  const connectWithMetamaskButton = '#connect-with-metamask-button';

  const walletIFrame = page.frames()[1];
  await waitForAndClickButton(page, walletIFrame, connectWithMetamaskButton);
  await metamask.approve();
  await page.waitFor(1000);
}

interface Window {
  channelProvider: import('@statechannels/channel-provider').ChannelProviderInterface;
  channelRunning(): void;
}
declare let window: Window;

export const waitAndOpenChannel = (usingVirtualFunding: boolean) => async (
  page: Page
): Promise<void> => {
  if (!usingVirtualFunding) {
    console.log('Waiting for create channel button');

    const createChannelButton = 'div.application-workflow-prompt > div > button';

    const walletIFrame = page.frames()[1];
    await waitForAndClickButton(page, walletIFrame, createChannelButton);
  } else {
    return new Promise(resolve =>
      page.exposeFunction('channelRunning', resolve).then(() =>
        page.evaluate(() => {
          window.channelProvider.on('ChannelUpdated', () => {
            window.channelRunning();
            window.channelProvider.off('ChannelUpdated');
          });
        })
      )
    );
  }
};

export async function waitForClosingChannel(page: Page): Promise<void> {
  const closingText = 'div.application-workflow-prompt > h1';
  const closingIframeB = page.frames()[1];
  await closingIframeB.waitForSelector(closingText);
}

export function enableSlowMo(page, delay) {
  const origin = page._client._onMessage;
  page._client._onMessage = async (...args) => {
    await new Promise(x => setTimeout(x, 250));
    return origin.call(page._client, ...args);
  };
}
