import {CreateChannelParams} from '@statechannels/client-api-schema';
import Knex from 'knex';

import {peerEngines, getPeersSetup, peersTeardown} from '../../jest/with-peers-setup-teardown';
import {WalletObjective, ObjectiveModel} from '../models/objective';
import {createChannelArgs} from '../engine/__test__/fixtures/create-channel';
import {bob} from '../engine/__test__/fixtures/participants';
import {getChannelResultFor, getPayloadFor} from '../__test__/test-helpers';

jest.setTimeout(10_000);

beforeAll(getPeersSetup(true));
afterAll(peersTeardown);

test('Objectives can be synced if a message is lost', async () => {
  const createChannelParams: CreateChannelParams = createChannelArgs();

  // We mimic not receiving a message containing objectives
  const messageToLose = await peerEngines.a.createChannel(createChannelParams);

  const channelId = messageToLose.channelResults[0].channelId;
  const objectiveId = `OpenChannel-${channelId}`;

  // Only A should have the objective since we "lost" the message
  expect(await getObjective(peerEngines.a.knex, objectiveId)).toBeDefined();
  expect(await getObjective(peerEngines.b.knex, objectiveId)).toBeUndefined();

  // We would then call sync after some time of waiting and not making progress
  const {outbox} = await peerEngines.a.syncObjectives([objectiveId]);

  // After sync funding should continue as normal
  const {channelResults} = await peerEngines.b.pushMessage(
    getPayloadFor(bob().participantId, outbox)
  );
  expect(getChannelResultFor(channelId, channelResults)).toMatchObject({
    status: 'proposed',
    turnNum: 0,
  });
});

test('handles the objective being synced even if no message is lost', async () => {
  const createChannelParams: CreateChannelParams = createChannelArgs();

  const messageResponse = await peerEngines.a.createChannel(createChannelParams);

  const channelId = messageResponse.channelResults[0].channelId;
  const objectiveId = `OpenChannel-${channelId}`;

  // The initial message is received
  await peerEngines.b.pushMessage(getPayloadFor(bob().participantId, messageResponse.outbox));

  // We expect both objectives to be there
  expect(await getObjective(peerEngines.a.knex, objectiveId)).toBeDefined();
  expect(await getObjective(peerEngines.b.knex, objectiveId)).toBeDefined();

  const {outbox: syncOutbox} = await peerEngines.a.syncObjectives([objectiveId]);

  // Now we push in the sync payload
  const {outbox, channelResults} = await peerEngines.b.pushMessage(
    getPayloadFor(bob().participantId, syncOutbox)
  );

  // The only expected result is a sync channel response
  expect(outbox).toHaveLength(1);
  expect(outbox[0]).toMatchObject({
    method: 'MessageQueued',
    params: {
      recipient: 'alice',
      sender: 'bob',
      data: {signedStates: [expect.objectContaining({turnNum: 0})]},
    },
  });

  // TODO: https://github.com/statechannels/statechannels/issues/3289
  //expect(newObjectives).toHaveLength(0);

  expect(channelResults).toHaveLength(1);
});

test('Can successfully push the sync objective message multiple times', async () => {
  const createChannelParams: CreateChannelParams = createChannelArgs();

  // We mimic not receiving a message containing objectives
  const messageToLose = await peerEngines.a.createChannel(createChannelParams);

  const channelId = messageToLose.channelResults[0].channelId;
  const objectiveId = `OpenChannel-${channelId}`;

  // Only A should have the objective since we "lost" the message
  expect(await getObjective(peerEngines.a.knex, objectiveId)).toBeDefined();
  expect(await getObjective(peerEngines.b.knex, objectiveId)).toBeUndefined();

  // We would then call sync after some time of waiting and not making progress
  const syncResult = await peerEngines.a.syncObjectives([objectiveId]);

  // We push the message to B
  await peerEngines.b.pushMessage(getPayloadFor(bob().participantId, syncResult.outbox));

  // We push the message to B again and check the results
  const {outbox, channelResults} = await peerEngines.b.pushMessage(
    getPayloadFor(bob().participantId, syncResult.outbox)
  );

  // The only expected result is a sync channel response
  expect(outbox).toHaveLength(1);
  expect(outbox[0]).toMatchObject({
    method: 'MessageQueued',
    params: {
      recipient: 'alice',
      sender: 'bob',
      data: {signedStates: [expect.objectContaining({turnNum: 0})]},
    },
  });

  expect(channelResults).toHaveLength(1);
  expect(channelResults[0]).toMatchObject({channelId});

  // TODO: https://github.com/statechannels/statechannels/issues/3289
  //expect(newObjectives).toHaveLength(0);
});

async function getObjective(knex: Knex, objectiveId: string): Promise<WalletObjective | undefined> {
  const model = await ObjectiveModel.query(knex).findById(objectiveId);
  return model?.toObjective();
}
