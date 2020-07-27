import Objection from 'objection';
import {StateVariables} from '@statechannels/wallet-core';

import {Store} from '../store';
import {channel} from '../../models/__test__/fixtures/channel';
import {seed} from '../../db/seeds/1_signing_wallet_seeds';
import knex from '../../db/connection';
import {Channel} from '../../models/channel';
import {Bytes32} from '../../type-aliases';
import {SignState} from '../../protocols/actions';

import {stateWithHashSignedBy} from './fixtures/states';
import {bob} from './fixtures/signingWallets';

function signState(channelId: Bytes32, vars: StateVariables): SignState {
  return {...vars, type: 'SignState', channelId};
}

let tx: Objection.Transaction;
beforeEach(async () => {
  // Make sure alice's PK is in the DB
  await seed(knex);

  // Start the transaction
  tx = await Channel.startTransaction();
});

afterEach(async () => tx.rollback());

describe('signState', () => {
  let c: Channel;

  beforeEach(async () => {
    c = await Channel.query().insert(channel({vars: [stateWithHashSignedBy(bob())()]}));
  });

  it('signs the state, ', async () => {
    await expect(Channel.query().where({id: c.id})).resolves.toHaveLength(1);
    expect(c.latestSignedByMe).toBeUndefined();

    const result = await Store.signState(signState(c.channelId, c.vars[0]), tx);
    expect(result).toMatchObject([
      {
        type: 'NotifyApp',
        notice: {
          method: 'MessageQueued',
          params: {data: {signedStates: [{...c.vars[0], signatures: expect.any(Object)}]}},
        },
      },
    ]);
  });

  it('uses a transaction', async () => {
    const updatedC = await Store.signState(signState(c.channelId, c.vars[0]), tx);
    expect(updatedC).toBeDefined();

    // Fetch the current channel outside the transaction context
    const currentC = await Channel.forId(c.channelId, undefined);
    expect(currentC.latestSignedByMe).toBeUndefined();

    const pendingC = await Channel.forId(c.channelId, tx);
    expect(pendingC.latestSignedByMe).toBeDefined();
  });
});
