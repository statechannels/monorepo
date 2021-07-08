import {constants} from 'ethers';

import {makeDestination} from '../utils';
import {outcomesEqual} from '../state-utils';
import {SimpleAllocation, makeAddress} from '../types';
import {BN} from '../bignumber';

const AddressZero = makeAddress(constants.AddressZero);
const HashZero = constants.HashZero;

const simpleAllocation1: SimpleAllocation = {
  type: 'SimpleAllocation',
  asset: AddressZero,
  allocationItems: [{destination: makeDestination(HashZero), amount: BN.from('0x2')}]
};

const simpleAllocation2: SimpleAllocation = {
  type: 'SimpleAllocation',
  asset: AddressZero,
  allocationItems: [{destination: makeDestination(HashZero), amount: BN.from('0x02')}]
};

describe('outcomesEqual', () => {
  it('returns equal for identical SimpleAllocations', async () => {
    expect(outcomesEqual(simpleAllocation1, simpleAllocation1)).toEqual(true);
  });

  it('returns equal for equivalent SimpleAllocations', async () => {
    expect(outcomesEqual(simpleAllocation1, simpleAllocation2)).toEqual(true);
  });
});
