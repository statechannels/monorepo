import {Contract, BigNumber} from 'ethers';
import shuffle from 'lodash.shuffle';

import {computeNewAllocationWithGuarantee} from '../../../../src/ninja-nitro/helpers';
import {AllocationItem, Guarantee, randomChannelId} from '../../../../src';
import {getTestProvider, setupContract, randomExternalDestination} from '../../../test-helpers';
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

const randomAllocation = (numAllocationItems: number): AllocationItem[] => {
  return numAllocationItems > 0
    ? [...Array(numAllocationItems)].map(() => ({
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

    const result = (await MasterCopy._computeNewAllocationWithGuarantee(
      BigNumber.from(heldBefore),
      allocation,
      indices,
      guarantee
    )) as ReturnType<typeof computeNewAllocationWithGuarantee>;

    expect(result).toBeDefined();
    expect(result.newAllocation).toMatchObject(
      locallyComputedNewAllocation.newAllocation.map(a => ({
        ...a,
        amount: BigNumber.from(a.amount),
      }))
    );

    expect((result as any).safeToDelete).toEqual(locallyComputedNewAllocation.deleted);
    expect(result.payOuts).toMatchObject(
      locallyComputedNewAllocation.payOuts.map(a => ({
        ...a,
        amount: BigNumber.from(a.amount),
      }))
    );
  });
});
