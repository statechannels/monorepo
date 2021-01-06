import {Contract, BigNumber} from 'ethers';
import shuffle from 'lodash.shuffle';

import {
  getTestProvider,
  setupContracts,
  randomExternalDestination,
  randomChannelId,
} from '../../test-helpers';
// eslint-disable-next-line import/order
import AssetHolderArtifact from '../../../artifacts/contracts/test/TESTAssetHolder.sol/TESTAssetHolder.json';

const provider = getTestProvider();

let AssetHolder: Contract;

beforeAll(async () => {
  AssetHolder = await setupContracts(
    provider,
    AssetHolderArtifact,
    process.env.TEST_ASSET_HOLDER_ADDRESS
  );
});

import {AllocationItem, Guarantee} from '../../../src';
import {
  computeNewAllocation,
  computeNewAllocationWithGuarantee,
} from '../../../src/contract/asset-holder';

const randomAllocation = (numAllocationItems: number): AllocationItem[] => {
  return numAllocationItems > 0
    ? [...Array(numAllocationItems)].map(e => ({
        destination: randomExternalDestination(),
        amount: BigNumber.from(Math.ceil(Math.random() * 10)).toHexString(),
      }))
    : [];
};

const randomGuarantee = (allocation: AllocationItem[]): Guarantee => {
  return {
    targetChannelId: randomChannelId(),
    destinations: shuffle(allocation.map(a => a.destination)),
  };
};

const heldBefore = BigNumber.from(100).toHexString();
const allocation = randomAllocation(Math.ceil(Math.random() * 20));
const indices = shuffle([...Array(allocation.length).keys()]); // [0, 1, 2, 3,...] but shuffled
const guarantee = randomGuarantee(allocation);

describe('AsserHolder._computeNewAllocationWithGuarantee', () => {
  it(`matches on chain method for input \n heldBefore: ${heldBefore}, \n allocation: ${JSON.stringify(
    allocation,
    null,
    2
  )}, \n indices: ${indices}, \n guarantee: ${JSON.stringify(guarantee, null, 2)}`, async () => {
    // check local function works as expected
    const locallyComputedNewAllocation = computeNewAllocationWithGuarantee(
      heldBefore,
      allocation,
      indices,
      guarantee
    );

    const result = (await AssetHolder._computeNewAllocationWithGuarantee(
      BigNumber.from(heldBefore),
      allocation,
      indices,
      guarantee
    )) as ReturnType<typeof computeNewAllocation>;

    expect(result).toBeDefined();
    expect(result.newAllocation).toMatchObject(
      locallyComputedNewAllocation.newAllocation.map(a => ({
        ...a,
        amount: BigNumber.from(a.amount),
      }))
    );
    expect((result as any).safeToDelete).toEqual(locallyComputedNewAllocation.deleted);
    expect(result.totalPayouts).toEqual(BigNumber.from(locallyComputedNewAllocation.totalPayouts));
    expect(result.payouts).toMatchObject(
      locallyComputedNewAllocation.payouts.map(p => BigNumber.from(p))
    );
  });
});
