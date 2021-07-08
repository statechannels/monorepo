import {
  Address,
  BN,
  DirectFunder,
  makeAddress,
  makeDestination,
  SimpleAllocation,
  State
} from '@statechannels/wallet-core';
import {storiesOf} from '@storybook/react';
import {ethers} from 'ethers';
import React from 'react';

import {Objective} from '../objective/objective';

import {renderComponentInFrontOfApp} from './helpers';

/**
 * Copy/paste from wallet-core direct-funder.test.ts
 * Should wallet-core export these sample test objectives?
 */

const addressZero = ethers.constants.AddressZero as Address;
export const participants = {
  A: {
    privateKey: '0x95942b296854c97024ca3145abef8930bf329501b718c0f66d57dba596ff1318',
    signingAddress: makeAddress('0x11115FAf6f1BF263e81956F0Cc68aEc8426607cf'),
    participantId: 'alice',
    destination: makeDestination(
      '0x00000000000000000000000000000000000000000000000000000000000aaaa1'
    )
  },
  B: {
    privateKey: '0xb3ab7b031311fe1764b657a6ae7133f19bac97acd1d7edca9409daa35892e727',
    signingAddress: makeAddress('0x2222E21c8019b14dA16235319D34b5Dd83E644A9'),
    participantId: 'bob',
    destination: makeDestination(
      '0x00000000000000000000000000000000000000000000000000000000000bbbb2'
    )
  },
  H: {
    privateKey: '0xc9a5f30ceaf2a0ccbb30d50aa9de3f273aa6e76f89e26090c42775e9647f5b6a',
    signingAddress: makeAddress('0x33335846dd121B14B4C313Cb6b766F09e75890dF'),
    participantId: 'hub',
    destination: makeDestination(
      '0x00000000000000000000000000000000000000000000000000000000000ffff3'
    )
  }
};

const deposits = {
  part: BN.from(2),
  A: BN.from(3),
  B: BN.from(5),
  total: BN.from(8)
};

const asset = makeAddress(addressZero); // must be even length
const outcome: SimpleAllocation = {
  type: 'SimpleAllocation',
  allocationItems: [
    {destination: participants.A.destination, amount: deposits.A},
    {destination: participants.B.destination, amount: deposits.B}
  ],
  asset
};

const openingState: State = {
  participants: [participants.A, participants.B],
  chainId: '0x01',
  challengeDuration: 86400, // one day
  channelNonce: 0,
  appDefinition: ethers.constants.AddressZero as Address,
  appData: makeAddress(ethers.constants.AddressZero), // must be even length
  turnNum: 0,
  outcome,
  isFinal: false
};

/**
 * End of copy/paste from wallet-core direct-funder.test.ts
 */

Object.keys(DirectFunder.WaitingFor).map(waitingForKey => {
  const objective = DirectFunder.initialize(openingState, 0);
  objective.status = DirectFunder.WaitingFor[waitingForKey];
  storiesOf('Objectives', module).add(
    waitingForKey,
    renderComponentInFrontOfApp(<Objective objective={objective} />)
  );
});
