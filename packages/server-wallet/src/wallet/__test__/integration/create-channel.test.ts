import {Wallet} from '../..';
import {seed} from '../../../db/seeds/1_signing_wallet_seeds';
import {createChannelArgs} from '../fixtures/create-channel';
import {Channel} from '../../../models/channel';
import knex from '../../../db/connection';
import {truncate} from '../../../db-admin/db-admin-connection';

let w: Wallet;
beforeEach(async () => {
  await truncate(knex);
  w = new Wallet();
});

describe('happy path', () => {
  // Make sure alice's PK is in the DB
  beforeEach(async () => seed(knex));

  it('creates a channel', async () => {
    expect(await Channel.query().resultSize()).toEqual(0);

    const appData = '0xa00f00';
    const createPromise = w.createChannel(createChannelArgs({appData}));
    await expect(createPromise).resolves.toMatchObject({
      channelId: expect.any(String),
    });
    const {channelId} = await createPromise;
    expect(await Channel.query().resultSize()).toEqual(1);

    const updated = await Channel.forId(channelId, undefined);
    expect(updated.latestSignedByMe).toMatchObject({
      turnNum: 0,
      appData,
    });
  });

  it('sends a message', async () => {
    await expect(w.createChannel(createChannelArgs())).resolves.toMatchObject({
      outbox: [{notice: {params: {recipient: 'bob', sender: 'alice'}}}],
    });
  });
});

it("doesn't create a channel if it doesn't have a signing wallet", () =>
  expect(w.createChannel(createChannelArgs())).rejects.toThrow(
    'null value in column "signing_address"'
  ));
