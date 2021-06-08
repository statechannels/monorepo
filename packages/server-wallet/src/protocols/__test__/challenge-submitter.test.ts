import _ from 'lodash';
import {SubmitChallenge} from '@statechannels/wallet-core';

import {Store} from '../../engine/store';
import {testKnex as knex} from '../../../jest/knex-setup-teardown';
import {defaultTestConfig} from '../../config';
import {EngineResponse} from '../../engine/engine-response';
import {createLogger} from '../../logger';
import {WalletObjective, ObjectiveModel} from '../../models/objective';
import {ChallengeSubmitter} from '../challenge-submitter';
import {Channel} from '../../models/channel';
import {channel} from '../../models/__test__/fixtures/channel';
import {seedAlicesSigningWallet} from '../../db/seeds/1_signing_wallet_seeds';
import {AdjudicatorStatusModel} from '../../models/adjudicator-status';
import {stateSignedBy, stateWithHashSignedBy} from '../../engine/__test__/fixtures/states';
import {alice, bob} from '../../engine/__test__/fixtures/signing-wallets';
import {ChainServiceRequest} from '../../models/chain-service-request';
import {DBAdmin} from '../../db-admin/db-admin';

const logger = createLogger(defaultTestConfig());
const timingMetrics = false;

let store: Store;
beforeEach(async () => {
  store = new Store(
    knex,
    defaultTestConfig().metricsConfiguration.timingMetrics,
    defaultTestConfig().skipEvmValidation,
    '0'
  );

  await DBAdmin.truncateDataBaseFromKnex(knex);
  await seedAlicesSigningWallet(knex);
});

afterEach(async () => await DBAdmin.truncateDataBaseFromKnex(knex));

describe(`challenge-submitter`, () => {
  it(`takes no action if there is an existing chain service request`, async () => {
    const c = channel();

    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    // Add a existing request
    await ChainServiceRequest.insertOrUpdate(c.channelId, 'challenge', knex);

    const obj: SubmitChallenge = {
      type: 'SubmitChallenge',
      participants: [],
      data: {targetChannelId: c.channelId},
    };

    const walletObjective = await knex.transaction(async tx => ObjectiveModel.insert(obj, tx));

    await await crankAndAssert(walletObjective, {callsChallenge: false, completesObj: false});
  });
  it(`takes no action if there is an existing challenge`, async () => {
    const c = channel();

    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    const challengeState = stateSignedBy([alice()])();
    await AdjudicatorStatusModel.insertAdjudicatorStatus(knex, c.channelId, 100, [challengeState]);

    const obj: SubmitChallenge = {
      type: 'SubmitChallenge',
      participants: [],
      data: {targetChannelId: c.channelId},
    };

    const objective = await knex.transaction(tx => ObjectiveModel.insert(obj, tx));

    await await crankAndAssert(objective, {callsChallenge: false, completesObj: false});
  });

  it(`calls challenge when no challenge exists`, async () => {
    const c = channel({
      vars: [stateWithHashSignedBy([alice(), bob()])({turnNum: 1})],
      initialSupport: [stateWithHashSignedBy([alice(), bob()])({turnNum: 1})],
    });

    await Channel.query(knex).withGraphFetched('signingWallet').insert(c);

    const obj: SubmitChallenge = {
      type: 'SubmitChallenge',
      participants: [],
      data: {targetChannelId: c.channelId},
    };

    const objective = await knex.transaction(tx => ObjectiveModel.insert(obj, tx));
    await await crankAndAssert(objective, {
      callsChallenge: true,
      completesObj: true,
    });
  });
});

interface AssertionParams {
  callsChallenge?: boolean;
  completesObj?: boolean;
}

const crankAndAssert = async (
  objective: WalletObjective<SubmitChallenge>,
  args: AssertionParams
): Promise<void> => {
  const completesObj = args.completesObj || false;
  const callsChallenge = args.callsChallenge || false;

  const challengeSubmitter = ChallengeSubmitter.create(store, logger, timingMetrics);
  const response = EngineResponse.initialize();

  await store.transaction(async tx => {
    await challengeSubmitter.crank(objective, response, tx);
  });

  if (callsChallenge) {
    expect(response.chainRequests[0]).toMatchObject({type: 'Challenge'});
  } else {
    expect(response.chainRequests).toHaveLength(0);
  }

  const reloadedObjective = await store.getObjective(objective.objectiveId);

  if (completesObj) {
    expect(reloadedObjective.status).toEqual('succeeded');
  } else {
    expect(reloadedObjective.status).toEqual('pending');
  }
};
