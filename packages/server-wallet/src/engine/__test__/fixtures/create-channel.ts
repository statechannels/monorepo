import {CreateChannelParams} from '@statechannels/client-api-schema';
import {BN} from '@statechannels/wallet-core';
import {constants} from 'ethers';

import {ONE_DAY} from '../../../__test__/test-helpers';

import {alice, bob} from './participants';
import {fixture} from './utils';

const defaultVars: CreateChannelParams = {
  appData: '0x0abc',
  participants: [alice(), bob()],
  appDefinition: constants.AddressZero,
  fundingStrategy: 'Direct',
  challengeDuration: ONE_DAY,
  allocations: [
    {
      asset: constants.AddressZero,
      allocationItems: [
        {destination: alice().destination, amount: BN.from(1)},
        {destination: bob().destination, amount: BN.from(3)},
      ],
    },
  ],
};

export const createChannelArgs = fixture(defaultVars);
