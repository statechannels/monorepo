import {testKnex as knex} from '../../../jest/knex-setup-teardown';
import {DBAdmin} from '../../db-admin/db-admin';
import {ChallengeStatus} from '../challenge-status';
import {Channel} from '../channel';
import {seedAlicesSigningWallet} from '../../db/seeds/1_signing_wallet_seeds';
import {stateVars} from '../../wallet/__test__/fixtures/state-vars';

import {channel} from './fixtures/channel';

describe('ChallengeStatus model', () => {
  beforeEach(async () => {
    await new DBAdmin(knex).truncateDB();
    await seedAlicesSigningWallet(knex);
  });

  afterAll(async () => await knex.destroy());

  it('returns an active challenge status when the challenge is not finalized (finalizesAt>blockNumber)', async () => {
    const c = channel();
    const challengeState = {...stateVars(), ...c.channelConstants};
    await Channel.query(knex)
      .withGraphFetched('signingWallet')
      .insert(c);

    await ChallengeStatus.insertChallengeStatus(knex, c.channelId, 5, challengeState);

    const result = await ChallengeStatus.getChallengeStatus(knex, c.channelId);

    expect(result).toEqual({status: 'Challenge Active', finalizesAt: 5, challengeState});
  });

  it('returns no challenge when there is not an entry', async () => {
    const c = channel();
    await Channel.query(knex)
      .withGraphFetched('signingWallet')
      .insert(c);

    const result = await ChallengeStatus.getChallengeStatus(knex, c.channelId);

    expect(result).toEqual({status: 'No Challenge Detected'});
  });

  it('returns channel finalized when the channel is finalized (finalizedAt<=blockNumber)', async () => {
    const c = channel();
    const challengeState = {...stateVars(), ...c.channelConstants};
    await Channel.query(knex)
      .withGraphFetched('signingWallet')
      .insert(c);

    await ChallengeStatus.insertChallengeStatus(knex, c.channelId, 5, challengeState);
    await ChallengeStatus.setFinalized(knex, c.channelId, 10);

    const result = await ChallengeStatus.getChallengeStatus(knex, c.channelId);

    expect(result).toEqual({
      status: 'Challenge Finalized',
      finalizedAt: 5,
      finalizedBlockNumber: 10,
      challengeState,
    });
  });
});
