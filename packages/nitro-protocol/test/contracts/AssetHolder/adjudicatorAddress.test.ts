import {Contract} from 'ethers';

import AssetHolderArtifact from '../../../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';
import {getTestProvider, setupContracts} from '../../test-helpers';

const provider = getTestProvider();
let AssetHolder: Contract;

beforeAll(async () => {
  AssetHolder = setupContracts(
    provider,
    AssetHolderArtifact,
    process.env.TEST_ASSET_HOLDER_ADDRESS
  );
});

describe('AdjudicatorAddress', () => {
  it('Exposes the address to a call', async () => {
    expect(await AssetHolder.AdjudicatorAddress()).toEqual(
      process.env.TEST_NITRO_ADJUDICATOR_ADDRESS
    );
  });
});
