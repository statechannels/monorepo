import {
  BN,
  SignedState,
  SignedStateWithHash,
  State,
  hashState,
  simpleEthAllocation,
  SignatureEntry,
} from '@statechannels/wallet-core';
import _ from 'lodash';
import {flow} from 'fp-ts/lib/function';

import {SigningWallet} from '../../../models/signing-wallet';
import {addHash} from '../../../state-utils';

import {Fixture, fixture, overwriteOutcome} from './utils';
import {alice, bob} from './participants';
import {alice as aliceWallet} from './signing-wallets';

const defaultState: State = {
  appData: '0x',
  appDefinition: '0x0000000000000000000000000000000000000000',
  isFinal: false,
  turnNum: 0,
  outcome: simpleEthAllocation([
    {destination: alice().destination, amount: BN.from(1)},
    {destination: bob().destination, amount: BN.from(3)},
  ]),
  participants: [alice(), bob()],
  channelNonce: 1,
  chainId: '0x01',
  challengeDuration: 9001,
};

// Caching signatures saves about 200ms per signature
// TODO: Persist these signatures between tests
const signatureCache: Record<string, SignatureEntry> = {};
const _signState = (s: State, sw: SigningWallet): SignatureEntry => {
  const key = `${sw.privateKey}-${hashState(s)}`;
  return (signatureCache[key] = signatureCache[key] || sw.signState(s));
};

export const createState = fixture(defaultState, overwriteOutcome);

const addSignatures = (wallets: SigningWallet[]) => (s: State): SignedState => ({
  ...s,
  signatures: wallets.map(sw => _signState(s, sw)),
});

export const stateSignedBy = (
  defaultWallet = aliceWallet(),
  ...otherWallets: SigningWallet[]
): Fixture<SignedState> =>
  fixture<SignedState>(
    _.merge({signatures: []}, defaultState),
    flow(overwriteOutcome, addSignatures([defaultWallet, ...otherWallets]))
  );

export const stateWithHashSignedBy = (
  pk = aliceWallet(),
  ...otherWallets: SigningWallet[]
): Fixture<SignedStateWithHash> =>
  fixture(stateSignedBy(pk, ...otherWallets)() as SignedStateWithHash, addHash);
