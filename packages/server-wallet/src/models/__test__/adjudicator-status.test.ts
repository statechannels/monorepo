import {testKnex as knex} from '../../../jest/knex-setup-teardown';
import {DBAdmin} from '../../db-admin/db-admin';
import {AdjudicatorStatusModel} from '../adjudicator-status';
import {Channel} from '../channel';
import {seedAlicesSigningWallet} from '../../db/seeds/1_signing_wallet_seeds';
import {stateSignedBy} from '../../wallet/__test__/fixtures/states';
import {alice} from '../../wallet/__test__/fixtures/signing-wallets';

import {channel} from './fixtures/channel';

describe('AdjudicatorStatus model', () => {
  beforeEach(async () => {
    await new DBAdmin(knex).truncateDB();
    await seedAlicesSigningWallet(knex);
  });

  afterAll(async () => await knex.destroy());

  it('returns an active challenge status when the challenge is not finalized (finalizesAt>blockNumber)', async () => {
    const c = channel();
    const challengeState = stateSignedBy([alice()])();
    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    await AdjudicatorStatusModel.insertAdjudicatorStatus(knex, c.channelId, 5, [challengeState]);

    const result = await AdjudicatorStatusModel.getAdjudicatorStatus(knex, c.channelId);

    expect(result).toEqual({channelMode: 'Challenge', states: [challengeState]});
  });

  it('returns no challenge when there is not an entry', async () => {
    const c = channel();
    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    const result = await AdjudicatorStatusModel.getAdjudicatorStatus(knex, c.channelId);

    expect(result).toEqual({channelMode: 'Open'});
  });

  it('returns channel finalized when the channel is finalized (finalizedAt<=blockNumber)', async () => {
    const c = channel();
    const challengeState = stateSignedBy([alice()])();
    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    await AdjudicatorStatusModel.insertAdjudicatorStatus(knex, c.channelId, 5, [challengeState]);
    await AdjudicatorStatusModel.setFinalized(knex, c.channelId, 2, 10);

    const result = await AdjudicatorStatusModel.getAdjudicatorStatus(knex, c.channelId);

    expect(result).toEqual({
      channelMode: 'Finalized',
      states: [challengeState],
    });
  });
});
