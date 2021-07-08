import {Wallet} from 'ethers';

import {getTestProvider, setupContract} from '../../test-helpers';
import {TESTNitroAdjudicator} from '../../../typechain/TESTNitroAdjudicator';
import TESTNitroAdjudicatorArtifact from '../../../artifacts/contracts/test/TESTNitroAdjudicator.sol/TESTNitroAdjudicator.json';

const testNitroAdjudicator = (setupContract(
  getTestProvider(),
  TESTNitroAdjudicatorArtifact,
  process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
) as unknown) as TESTNitroAdjudicator;

const participants = ['', '', ''];
const wallets = new Array(3);

// Populate wallets and participants array
for (let i = 0; i < 3; i++) {
  wallets[i] = Wallet.createRandom();
  participants[i] = wallets[i].address;
}

describe('isExternalDestination', () => {
  it('verifies an external destination', async () => {
    const zerosPaddedExternalDestination =
      '0x' + 'eb89373c708B40fAeFA76e46cda92f801FAFa288'.padStart(64, '0');
    expect(await testNitroAdjudicator.isExternalDestination(zerosPaddedExternalDestination)).toBe(
      true
    );
  });
  it('rejects a non-external-address', async () => {
    const onesPaddedExternalDestination =
      '0x' + 'eb89373c708B40fAeFA76e46cda92f801FAFa288'.padStart(64, '1');
    expect(await testNitroAdjudicator.isExternalDestination(onesPaddedExternalDestination)).toBe(
      false
    );
  });
});
