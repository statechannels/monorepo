import {CreateChannelParams, Participant, Allocation} from '@statechannels/client-api-schema';
import {makeDestination} from '@statechannels/wallet-core';
import {BigNumber, ethers} from 'ethers';

import {defaultConfig} from '../../config';
import {Wallet} from '../../wallet';
import {getChannelResultFor, getPayloadFor} from '../test-helpers';

const a = new Wallet({...defaultConfig, postgresDBName: 'TEST_A'});
const b = new Wallet({...defaultConfig, postgresDBName: 'TEST_B'});

beforeAll(async () => {
  await a.dbAdmin().createDB();
  await b.dbAdmin().createDB();
  await Promise.all([a.dbAdmin().migrateDB(), b.dbAdmin().migrateDB()]);
});
afterAll(async () => {
  await Promise.all([a.destroy(), b.destroy()]);
  await a.dbAdmin().dropDB();
  await b.dbAdmin().dropDB();
});

it('Create a fake-funded channel between two wallets ', async () => {
  const participantA: Participant = {
    signingAddress: await a.getSigningAddress(),
    participantId: 'a',
    destination: makeDestination(
      '0xaaaa000000000000000000000000000000000000000000000000000000000001'
    ),
  };
  const participantB: Participant = {
    signingAddress: await b.getSigningAddress(),
    participantId: 'b',
    destination: makeDestination(
      '0xbbbb000000000000000000000000000000000000000000000000000000000002'
    ),
  };

  const allocation: Allocation = {
    allocationItems: [
      {destination: participantA.destination, amount: BigNumber.from(1).toHexString()},
      {destination: participantB.destination, amount: BigNumber.from(1).toHexString()},
    ],
    token: '0x00', // must be even length
  };

  const channelParams: CreateChannelParams = {
    participants: [participantA, participantB],
    allocations: [allocation],
    appDefinition: ethers.constants.AddressZero,
    appData: '0x00', // must be even length
    fundingStrategy: 'Unfunded',
  };

  //        A <> B
  // PreFund0
  const resultA0 = await a.createChannel(channelParams);

  // TODO compute the channelId for a better test
  const channelId = resultA0.channelResults[0].channelId;

  expect(getChannelResultFor(channelId, resultA0.channelResults)).toMatchObject({
    status: 'opening',
    turnNum: 0,
  });

  //    > PreFund0A
  const resultB0 = await b.pushMessage(getPayloadFor(participantB.participantId, resultA0.outbox));

  expect(resultB0.objectivesToApprove).toBeDefined();
  expect(resultB0.objectivesToApprove).toHaveLength(1);
  const objective = /* eslint-disable-line */ resultB0.objectivesToApprove![0]
  expect(objective).toMatchObject({
    type: 'OpenChannel',
    data: {
      fundingStrategy: 'Unfunded',
      targetChannelId: channelId,
    },
  });

  expect(getChannelResultFor(channelId, resultB0.channelResults)).toMatchObject({
    status: 'proposed',
    turnNum: 0,
  });

  //      PreFund0B
  const resultB1 = await b.approveObjective(objective.objectiveId);
  expect(getChannelResultFor(channelId, [resultB1.channelResult])).toMatchObject({
    status: 'opening',
    turnNum: 0,
  });

  //  PreFund0B & PostFund3B <
  // PostFund3A
  const resultA1 = await a.pushMessage(getPayloadFor(participantA.participantId, resultB1.outbox));

  /**
   * In this case, resultA1 auto-signed PostFundA0
   */
  expect(getChannelResultFor(channelId, resultA1.channelResults)).toMatchObject({
    status: 'running',
    turnNum: 3,
  });
  const resultB2 = await b.pushMessage(getPayloadFor(participantB.participantId, resultA1.outbox));
  expect(getChannelResultFor(channelId, resultB2.channelResults)).toMatchObject({
    status: 'running',
    turnNum: 3,
  });
});
