import {simpleEthAllocation, serializeOutcome, BN} from '@statechannels/wallet-core';

import {Channel} from '../../../models/channel';
import {Wallet} from '../..';
import {seedAlicesSigningWallet} from '../../../db/seeds/1_signing_wallet_seeds';
import {truncate} from '../../../db-admin/db-admin-connection';
import {stateWithHashSignedBy} from '../fixtures/states';
import {bob} from '../fixtures/signing-wallets';
import {channel} from '../../../models/__test__/fixtures/channel';
import {alice} from '../fixtures/participants';
import {defaultConfig} from '../../../config';
import { connection } from '../../../db-admin/knexfile';

let w: Wallet;
beforeEach(async () => {
  w = new Wallet(defaultConfig);
  await truncate(w.knex);
});

afterEach(async () => {
  await w.destroy();
});

beforeEach(async () => seedAlicesSigningWallet(w.knex));

describe('directly funded app', () => {
  it('signs the prefund setup ', async () => {
    const appData = '0x0f00';
    const preFS = {turnNum: 0, appData};

    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)]});
    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.protocolState).toMatchObject({latest: preFS, supported: undefined});

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [{params: {recipient: 'bob', sender: 'alice', data: {signedStates: [preFS]}}}],
      // channelResults: [{channelId, turnNum: 0, appData, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: preFS, supported: preFS});
  });

  it('signs the prefund setup and postfund setup, when there are no deposits to make', async () => {
    const outcome = simpleEthAllocation([]);
    const preFS = {turnNum: 0, outcome};
    const postFS = {turnNum: 3, outcome};
    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)]});
    await Channel.query(w.knex).insert(c);

    const outcomeWire = serializeOutcome(outcome);
    const preFSWire = {turnNum: 0, outcome: outcomeWire};
    const postFSWire = {turnNum: 3, outcome: outcomeWire};

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS);

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {
          params: {
            recipient: 'bob',
            sender: 'alice',
            data: {signedStates: [preFSWire, postFSWire]},
          },
        },
      ],
      // TODO: channelResults is not calculated correctly: see the Channel model's channelResult
      // implementation
      // channelResults: [{channelId, turnNum: 3, outcome, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: postFS, supported: preFS});
  });

  it.skip('signs the prefund setup and makes a deposit, when I am first to deposit in a directly funded app', async () => {
    const outcome = simpleEthAllocation([{destination: alice().destination, amount: BN.from(5)}]);
    const preFS = {turnNum: 0, outcome};
    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)]});
    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS);

    const data = {signedStates: [preFS]};
    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {method: 'MessageQueued', params: {recipient: 'bob', sender: 'alice', data}},
        // TODO: It is unclear who will be responsible for making the deposit.
        // If the client does, we should expect this. If not,
        {method: 'SubmitTX', params: {transaction: expect.any(Object)}},
      ],
      // TODO: channelResults is not calculated correctly: see the Channel model's channelResult
      // implementation
      // channelResults: [{channelId, turnNum: 3, outcome, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: preFS, supported: preFS});
  });
});

describe('ledger funded app', () => {

  // Copy and pasted from directly funded, changing only the fundingStrategy
  it('signs the prefund setup ', async () => {
    const appData = '0x0f00';
    const preFS = {turnNum: 0, appData};

    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)], fundingStrategy: 'Ledger'});
    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.protocolState).toMatchObject({latest: preFS, supported: undefined});

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [{params: {recipient: 'bob', sender: 'alice', data: {signedStates: [preFS]}}}],
      // channelResults: [{channelId, turnNum: 0, appData, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: preFS, supported: preFS});
  });

  // Copy and pasted from directly funded, changing only the fundingStrategy
  it('signs the prefund setup and postfund setup, when there are no deposits to make', async () => {
    const outcome = simpleEthAllocation([]);
    const preFS = {turnNum: 0, outcome};
    const postFS = {turnNum: 3, outcome};
    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)], fundingStrategy: 'Ledger'});
    await Channel.query(w.knex).insert(c);

    const outcomeWire = serializeOutcome(outcome);
    const preFSWire = {turnNum: 0, outcome: outcomeWire};
    const postFSWire = {turnNum: 3, outcome: outcomeWire};

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS);

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {
          params: {
            recipient: 'bob',
            sender: 'alice',
            data: {signedStates: [preFSWire, postFSWire]},
          },
        },
      ],
      // TODO: channelResults is not calculated correctly: see the Channel model's channelResult
      // implementation
      // channelResults: [{channelId, turnNum: 3, outcome, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: postFS, supported: preFS});
  });

  it.only('signs the prefund setup and makes a ledger request', async () => {
    // FIXME: Put a ledger Channel in the DB
    {
      const outcome = simpleEthAllocation([{destination: alice().destination, amount: BN.from(5)}]);
      const running = {turnNum: 4, outcome};
      const ledger = channel({channelNonce:2 ,vars: [stateWithHashSignedBy(bob())(running)]});
      await Channel.query(w.knex).insert(ledger);
      w.__setLedger(ledger.channelId, outcome.assetHolderAddress)
    }

    const outcome = simpleEthAllocation([{destination: alice().destination, amount: BN.from(5)}]);
    const preFS = {turnNum: 0, outcome};
    const c = channel({
      fundingStrategy: 'Ledger',
      vars: [stateWithHashSignedBy(bob())(preFS)]
    });
    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS);

    const data = {signedStates: [preFS]};
    const ret = await w.joinChannel({channelId})
    console.log(JSON.stringify(ret, null, 2))
    expect(ret).toMatchObject({
      outbox: [
        {method: 'MessageQueued', params: {recipient: 'bob', sender: 'alice', data}},
      ],
      // TODO: channelResults is not calculated correctly: see the Channel model's channelResult
      // implementation
      // channelResults: [{channelId, turnNum: 3, outcome, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: preFS, supported: preFS});
  });

})

describe('virtually funded app', () => {
  it.skip('signs the prefund setup and messages the hub', async () => {
    const outcome = simpleEthAllocation([{destination: alice().destination, amount: BN.from(5)}]);
    const preFS = {turnNum: 0, outcome};
    const c = channel({vars: [stateWithHashSignedBy(bob())(preFS)]});
    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS);

    const data = {signedStates: [preFS]};
    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {method: 'MessageQueued', params: {recipient: 'bob', sender: 'alice', data}},
        {method: 'MessageQueued', params: {recipient: 'hub', sender: 'alice'}}, // TODO: Expect some specific data
      ],
      // TODO: channelResults is not calculated correctly: see the Channel model's channelResult
      // implementation
      // channelResults: [{channelId, turnNum: 3, outcome, status: 'funding'}],
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({latest: preFS, supported: preFS});
  });
});
