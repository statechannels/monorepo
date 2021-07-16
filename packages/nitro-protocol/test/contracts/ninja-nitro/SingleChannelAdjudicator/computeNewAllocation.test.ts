import {Contract, BigNumber} from 'ethers';
import shuffle from 'lodash.shuffle';

import {getTestProvider, setupContract, randomExternalDestination} from '../../../test-helpers';
// eslint-disable-next-line import/order
import SingleChannelAdjudicatorArtifact from '../../../../artifacts/contracts/ninja-nitro/SingleChannelAdjudicator.sol/SingleChannelAdjudicator.json';

const provider = getTestProvider();

let MasterCopy: Contract;

beforeAll(async () => {
  MasterCopy = await setupContract(
    provider,
    SingleChannelAdjudicatorArtifact,
    process.env.SINGLE_CHANNEL_ADJUDICATOR_MASTERCOPY_ADDRESS
  );
});

import {AllocationItem} from '../../../../src';
import {computeNewAllocation} from '../../../../src/contract/asset-holder';

const randomAllocation = (numAllocationItems: number): AllocationItem[] => {
  return numAllocationItems > 0
    ? [...Array(numAllocationItems)].map(() => ({
        destination: randomExternalDestination(),
        amount: BigNumber.from(Math.ceil(Math.random() * 10)).toHexString(),
      }))
    : [];
};

const heldBefore = BigNumber.from(100).toHexString();
const allocation = randomAllocation(Math.floor(Math.random() * 20));
const indices = shuffle([...Array(allocation.length).keys()]); // [0, 1, 2, 3,...] but shuffled

describe('MasterCopy._computeNewAllocation', () => {
  it(`matches on chain method for input \n heldBefore: ${heldBefore}, \n allocation: ${JSON.stringify(
    allocation,
    null,
    2
  )}, \n indices: ${indices}`, async () => {
    // check local function works as expected
    const locallyComputedNewAllocation = computeNewAllocation(heldBefore, allocation, indices);

    const result = (await MasterCopy._computeNewAllocation(
      heldBefore,
      allocation,
      indices
    )) as ReturnType<typeof computeNewAllocation>;
    expect(result).toBeDefined();
    expect(result.newAllocation).toMatchObject(
      locallyComputedNewAllocation.newAllocation.map(a => ({
        ...a,
        amount: BigNumber.from(a.amount),
      }))
    );

    expect((result as any).safeToDelete).toEqual(locallyComputedNewAllocation.deleted);

    expect(result.payouts).toMatchObject(
      locallyComputedNewAllocation.payouts.map(p => BigNumber.from(p))
    );

    expect(result.totalPayouts).toEqual(BigNumber.from(locallyComputedNewAllocation.totalPayouts));
  });
});
