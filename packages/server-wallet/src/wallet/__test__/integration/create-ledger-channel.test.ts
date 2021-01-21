import {constants} from 'ethers';
import {NULL_APP_DATA} from '@statechannels/wallet-core';

import {Channel} from '../../../models/channel';
import {Wallet} from '../..';
import {createChannelArgs} from '../fixtures/create-channel';
import {seedAlicesSigningWallet} from '../../../db/seeds/1_signing_wallet_seeds';
import {defaultTestConfig} from '../../../config';
import {DBAdmin} from '../../../db-admin/db-admin';

let w: Wallet;
beforeEach(async () => {
  w = Wallet.create(defaultTestConfig());
  await new DBAdmin(w.knex).truncateDB();
});

afterEach(async () => {
  await w.destroy();
});

describe('happy path', () => {
  beforeEach(async () => seedAlicesSigningWallet(w.knex));

  it('creates a ledger channel', async () => {
    expect(await Channel.query(w.knex).resultSize()).toEqual(0);

    const {participants, allocations, challengeDuration} = createChannelArgs();

    const createPromise = w.createLedgerChannel({participants, allocations, challengeDuration});

    await expect(createPromise).resolves.toMatchObject({
      outbox: [
        {
          params: {
            recipient: 'bob',
            sender: 'alice',
            data: {
              signedStates: [{turnNum: 0}],
              objectives: [
                {
                  participants: [], // TODO: remove when fully deprecated
                  data: {
                    fundingStrategy: 'Direct',
                  },
                  type: 'OpenChannel',
                },
              ],
            },
          },
        },
      ],
      channelResult: {channelId: expect.any(String), turnNum: 0},
    });

    const {channelId} = (await createPromise).channelResult;

    expect(await Channel.query(w.knex).resultSize()).toEqual(1);

    const updated = await Channel.forId(channelId, w.knex);
    const expectedState = {
      turnNum: 0,
      appData: NULL_APP_DATA,
      appDefinition: constants.AddressZero,
    };

    expect(updated).toMatchObject({
      latest: expectedState,
      latestSignedByMe: expectedState,
      supported: undefined,
    });

    await expect(
      w.getLedgerChannels(allocations[0].assetHolderAddress, participants)
    ).resolves.toMatchObject({
      channelResults: [
        {
          channelId,
        },
      ],
    });
  });
});
