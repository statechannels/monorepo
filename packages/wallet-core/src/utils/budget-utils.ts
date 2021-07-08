import {constants} from 'ethers';
import * as _ from 'lodash';

import {DomainBudget, AssetBudget, makeAddress} from '../types';
import {HUB_ADDRESS, zeroAddress} from '../config';

import {checkThat, exists} from './helpers';

export function ethBudget(domain: string, opts: Partial<AssetBudget>): DomainBudget {
  return {
    domain,
    hubAddress: HUB_ADDRESS,
    forAsset: {
      [zeroAddress]: _.assign(
        {
          asset: zeroAddress,
          availableReceiveCapacity: constants.Zero,
          availableSendCapacity: constants.Zero,
          channels: {}
        },
        opts
      )
    }
  };
}

export function forEthAsset(budget: DomainBudget): AssetBudget {
  const ethPart = budget.forAsset[makeAddress(constants.AddressZero)];
  if (!ethPart) throw 'No eth part!';
  return ethPart;
}

export function extractEthAssetBudget(budget: DomainBudget): AssetBudget {
  if (Object.keys(budget.forAsset).length !== 1) {
    throw new Error('Cannot handle mixed budget');
  }

  return checkThat<AssetBudget>(budget.forAsset[zeroAddress], exists);
}
