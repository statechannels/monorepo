import _ from 'lodash';
import {
  State,
  SignedState,
  simpleEthAllocation,
  SignedStateWithHash,
  SignedStateVariables,
  BN,
  signState,
  hashState,
} from '@statechannels/wallet-core';
import {fixture, Fixture} from './utils';
import {alice, bob} from './participants';
import {alice as aliceWallet} from './signingWallets';
import {addHash} from '../../../state-utils';
import {SigningWallet} from '../../../models/signing-wallet';

const defaultState: State = {
  appData: '0x0000000000000000000000000000000000000000000000000000000000000000',
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
const signatureCache: any = {};
const _signState = (s: State, pk: string): string => {
  const key = `${pk}-${hashState(s)}`;
  return (signatureCache[key] = signatureCache[key] || signState(s, pk));
};

export const createState = fixture(defaultState);
export const stateSignedBy = (
  defaultWallet = aliceWallet(),
  ...otherWallets: SigningWallet[]
): Fixture<SignedState> =>
  fixture<SignedState>(
    _.merge({signatures: []}, defaultState),
    (s: State): SignedState => ({
      ...s,
      signatures: [defaultWallet, ...otherWallets].map(sw => ({
        signature: _signState(s, sw.privateKey),
        signer: sw.address,
      })),
    })
  );

export const stateWithHashSignedBy = (pk = aliceWallet(), ...otherWallets: SigningWallet[]) => (
  opts?: Partial<SignedStateVariables>
): SignedStateWithHash => addHash(stateSignedBy(pk, ...otherWallets)(opts));
