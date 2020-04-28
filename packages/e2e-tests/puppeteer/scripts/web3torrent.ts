/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {Page} from 'puppeteer';
import * as fs from 'fs';

import {
  waitAndApproveBudget,
  waitAndApproveMetaMask,
  setUpBrowser,
  setupLogging,
  waitForBudgetEntry,
  withdrawAndWait,
  waitForEmptyBudget,
  waitAndApproveDepositWithHub
} from '../helpers';
import {Dappeteer} from 'dappeteer';

function prepareUploadFile(path: string): void {
  const content = 'web3torrent\n'.repeat(1000000);
  const buf = Buffer.from(content);
  fs.writeFile(path, buf, err => {
    if (err) {
      console.log(err);
      throw new Error('Failed to prepare the upload file');
    }
  });
}

export async function uploadFile(
  page: Page,
  handleBudgetPrompt: boolean,
  metamask: Dappeteer
): Promise<string> {
  await page.waitForSelector('input[type=file]');

  // Generate a /tmp file with deterministic data for upload testing
  const fileToUpload = '/tmp/web3torrent-tests-stub';
  prepareUploadFile(fileToUpload);

  // https://pub.dev/documentation/puppeteer/latest/puppeteer/FileChooser-class.html
  // Not clear why puppeteer FileChooser won't work out of box. We are doing it manually for now.
  const inputUploadHandle = await page.$('input[type=file]');
  await inputUploadHandle!.uploadFile(fileToUpload);
  await inputUploadHandle!.evaluate(upload => {
    // eslint-disable-next-line no-undef
    upload.dispatchEvent(new Event('change', {bubbles: true}));
  });

  await waitAndApproveMetaMask(page, metamask);

  if (handleBudgetPrompt) {
    await waitAndApproveBudget(page);
    await waitAndApproveDepositWithHub(page, metamask);
  }

  const downloadLinkSelector = '#download-link';
  await page.waitForSelector(downloadLinkSelector, {timeout: 60000}); // wait for my tx, which could be slow if on a real blockchain
  const downloadLink = await page.$eval(downloadLinkSelector, a => a.getAttribute('href'));

  return downloadLink ? downloadLink : '';
}

export async function startDownload(
  page: Page,
  url: string,
  handleBudgetPrompt: boolean,
  metamask: Dappeteer
): Promise<void> {
  await page.goto(url);
  await page.bringToFront();
  const downloadButton = '#download-button:not([disabled])';
  await page.waitForSelector(downloadButton);
  await page.click(downloadButton);

  await waitAndApproveMetaMask(page, metamask);

  if (handleBudgetPrompt) {
    await waitAndApproveBudget(page);
  }
}

export async function cancelDownload(page: Page): Promise<void> {
  await page.click('#cancel-download-button');
}

/**
 * Useful for local testing. Run with:
 *
 * yarn puppeteer:dev
 
 */
(async (): Promise<void> => {
  if (require.main === module) {
    // 100ms sloMo avoids some undiagnosed race conditions
    console.log('Opening browser');

    const {browser, metamask} = await setUpBrowser(false, 0);

    console.log('Waiting on pages');
    const web3tTabA = (await browser.pages())[0];

    console.log('Setting up logging...');
    await setupLogging(web3tTabA, 0, 'seed-download', true);

    await web3tTabA.goto('http://localhost:3000/upload', {waitUntil: 'load'});
    await web3tTabA.bringToFront();

    await uploadFile(web3tTabA, true, metamask);

    await waitForBudgetEntry(web3tTabA);

    await withdrawAndWait(web3tTabA, metamask);

    await waitForEmptyBudget(web3tTabA);
  }
})();
