import {Contract} from 'ethers';
import {Web3Provider} from 'ethers/providers';
import {Interface} from 'ethers/utils';
import {ContractArtifacts} from '@statechannels/nitro-protocol';

export function getProvider(): Web3Provider {
  return new Web3Provider(window.web3.currentProvider);
}

export async function getEthAssetHolderContract() {
  const provider = await getProvider();
  return new Contract(
    process.env.ETH_ASSET_HOLDER_ADDRESS || '0x0',
    getETHAssetHolderInterface(),
    provider
  );
}

export function getETHAssetHolderInterface(): Interface {
  return new Interface(
    // @ts-ignore https://github.com/ethers-io/ethers.js/issues/602#issuecomment-574671078
    ContractArtifacts.EthAssetHolderArtifact['abi']
  );
}
