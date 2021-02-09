import {constants} from 'ethers';
import {makeAddress} from '@statechannels/wallet-core';

import {Channel, ChannelError} from '../channel';
import {seedAlicesSigningWallet} from '../../db/seeds/1_signing_wallet_seeds';
import {stateWithHashSignedBy} from '../../wallet/__test__/fixtures/states';
import {testKnex as knex} from '../../../jest/knex-setup-teardown';
import {dropNonVariables} from '../../state-utils';
import {Funding} from '../funding';

import {channel} from './fixtures/channel';

beforeEach(async () => seedAlicesSigningWallet(knex));
afterAll(async () => await knex.destroy());

it('can insert Channel instances to, and fetch them from, the database', async () => {
  const vars = [stateWithHashSignedBy()({channelNonce: 1234})];
  const c1 = channel({channelNonce: 1234, vars});

  await Channel.query(knex).withGraphFetched('signingWallet').insert(c1);

  expect(c1.signingWallet).toBeDefined();

  const c2 = await Channel.query(knex).where({channel_nonce: 1234}).first();

  expect(c1.vars).toMatchObject(c2.vars);
});

it('does not store extraneous fields in the variables property', async () => {
  const vars = [{...stateWithHashSignedBy()(), extra: true}];
  const c1 = channel({vars});
  await Channel.transaction(knex, async tx => {
    await Channel.query(tx).insert(c1);

    const rawVars = (await tx.raw('select vars from channels')).rows[0].vars;
    const expectedVars = [dropNonVariables(stateWithHashSignedBy()())];
    expect(rawVars).toMatchObject(expectedVars);
  });
});

describe('validation', () => {
  it('throws when inserting a model where the channelId is inconsistent', () =>
    expect(
      Channel.query(knex).insert({
        ...channel({vars: [stateWithHashSignedBy()()]}),
        channelId: 'wrongId',
      })
    ).rejects.toThrow(ChannelError.reasons.invalidChannelId));
});

describe('fundingStatus', () => {
  it("should be undefined if funding wasn't fetched from db", async () => {
    const c1 = channel({vars: [stateWithHashSignedBy()()]});
    const {channelId} = await Channel.query(knex).insert(c1);
    await Funding.updateFunding(knex, channelId, '0x0a', makeAddress(constants.AddressZero));

    {
      const channel = await Channel.query(knex).first();
      expect(channel.channelResult.fundingStatus).toBeUndefined();
    }
  });

  it('should not be undefined if funding was fetched from db', async () => {
    const c1 = channel({vars: [stateWithHashSignedBy()()]});
    const {channelId} = await Channel.query(knex).insert(c1);
    await Funding.updateFunding(knex, channelId, '0x0a', makeAddress(constants.AddressZero));

    {
      const channel = await Channel.query(knex).withGraphJoined('funding').first();
      expect(channel.channelResult.fundingStatus).not.toBeUndefined();
    }
  });
});
