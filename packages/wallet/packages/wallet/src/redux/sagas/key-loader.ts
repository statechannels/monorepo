import { call, put, select } from 'redux-saga/effects';

import { default as firebase, reduxSagaFirebase } from '../../../gateways/firebase';
import ChannelWallet from '../../domain/ChannelWallet';
import { keysLoaded, metamaskLoadError } from '../actions';
import { getProvider, getAdjudicatorContractAddress } from '../../utils/contract-utils';
import { ethers } from 'ethers';
import { WAIT_FOR_ADDRESS, WalletState } from '../states';

interface WalletParams {
  uid: string;
  privateKey: string;
  address: string;
}

export function* keyLoader() {
  const state: WalletState = yield select((walletState: WalletState) => walletState);
  if (state.type !== WAIT_FOR_ADDRESS) { return; }
  const { uid } = state;
  let wallet = yield* fetchWallet(uid);

  if (!wallet) {
    yield* createWallet(uid);
    // fetch again instead of using return val, just in case another wallet was created in the interim
    wallet = yield* fetchWallet(uid);
  }
  if (typeof web3 === 'undefined') {
    yield put(metamaskLoadError());
  } else {
    const provider: ethers.providers.BaseProvider = yield call(getProvider);
    const network = yield provider.getNetwork();
    const adjudicator = yield getAdjudicatorContractAddress(provider);
    yield put(keysLoaded(wallet.address, wallet.privateKey, network.chainId, adjudicator));
  }
}

const walletTransformer = (data: any) =>
  ({
    ...data.val(),
    id: data.key,
  } as WalletParams);

const walletRef = uid => {
  return firebase
    .database()
    .ref('wallets')
    .orderByChild('uid')
    .equalTo(uid)
    .limitToFirst(1);
};

function* fetchWallet(uid: string) {
  const query = walletRef(uid);

  // const wallet = yield call(reduxSagaFirebase.database.read, query);
  // ^ doesn't work as it returns an object like {-LIGGQQEI6OlWoveTPsq: {address: ... } }
  // which doesn't have any useful methods on for extracting the part we want
  // It seems like rsf.database.read doesn't really work when the result is a collection

  const result = yield call([query, query.once], 'value');
  if (!result.exists()) {
    return null;
  }
  let wallet;
  result.forEach(data => {
    wallet = walletTransformer(data);
  }); // result should have size 1

  return new ChannelWallet(wallet.privateKey, wallet.id);
}

function* createWallet(uid: string) {
  const newWallet = new ChannelWallet();

  const walletParams = {
    uid,
    privateKey: newWallet.privateKey,
    address: newWallet.address,
  };

  return yield call(reduxSagaFirebase.database.create, 'wallets', walletParams);
}
