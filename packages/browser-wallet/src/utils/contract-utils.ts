import {INFURA_API_KEY, TARGET_NETWORK} from '../config';
import {providers} from 'ethers';

let provider: providers.Web3Provider | providers.JsonRpcProvider;

export function getProvider(): providers.Web3Provider | providers.JsonRpcProvider {
  if (provider) return provider;

  if (window.ethereum) {
    if (window.ethereum.mockingInfuraProvider) {
      provider = new providers.InfuraProvider(TARGET_NETWORK, INFURA_API_KEY);
    } else {
      // https://github.com/ethers-io/ethers.js/issues/861#issuecomment-638031278
      provider = new providers.Web3Provider(window.ethereum, 'any');
      provider.on('network', (_, oldNetwork) => {
        // When a Provider makes its initial connection, it emits a "network"
        // event with a null oldNetwork along with the newNetwork. So, if the
        // oldNetwork exists, it represents a changing network
        if (oldNetwork) {
          window.location.reload();
        }
      });
    }
  } else {
    provider = new providers.JsonRpcProvider(`http://localhost:${process.env.GANACHE_PORT}`);
  }

  return provider;
}
