import {
  simpleEthAllocation,
  BN,
  serializeState,
  serializeAllocation,
  makeDestination,
  SignedStateWithHash,
  serializeOutcome,
  makeAddress,
  serializeRequest,
} from '@statechannels/wallet-core';
import {ETH_ASSET_HOLDER_ADDRESS} from '@statechannels/wallet-core/lib/src/config';
import Objection from 'objection';

import {Channel} from '../../../models/channel';
import {Wallet} from '../..';
import {seedBobsSigningWallet} from '../../../db/seeds/1_signing_wallet_seeds';
import {stateWithHashSignedBy} from '../fixtures/states';
import {bob, alice} from '../fixtures/signing-wallets';
import {bob as bobP} from '../fixtures/participants';
import {channel} from '../../../models/__test__/fixtures/channel';
import {defaultTestConfig} from '../../../config';
import {DBAdmin} from '../../../db-admin/db-admin';
import {getChannelResultFor, getSignedStateFor} from '../../../__test__/test-helpers';
import {ObjectiveModel} from '../../../models/objective';

let w: Wallet;
beforeEach(async () => {
  w = await Wallet.create(defaultTestConfig());
  await DBAdmin.truncateDataBaseFromKnex(w.knex);
  await seedBobsSigningWallet(w.knex);
});

afterEach(async () => {
  await w.destroy();
});

describe('directly funded app', () => {
  it('signs multiple prefund setups when joining multiple channels', async () => {
    const appData = '0x0f00';
    const preFS = {turnNum: 0, appData};
    const state1 = {...preFS, channelNonce: 1};
    const state2 = {...preFS, channelNonce: 2};

    const c1 = channel({
      signingAddress: bob().address,
      channelNonce: 1,
      vars: [stateWithHashSignedBy([alice()])(state1)],
    });

    await Channel.query(w.knex).insert(c1);
    const c2 = channel({
      signingAddress: bob().address,
      channelNonce: 2,
      vars: [stateWithHashSignedBy([alice()])(state2)],
    });

    await Channel.query(w.knex).insert(c2);
    const channelIds = [c1, c2].map(c => c.channelId);

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: c1.participants,
        data: {
          targetChannelId: c1.channelId,
          fundingStrategy: 'Direct',
          role: 'app',
        },
      },
      w.knex
    );

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: c2.participants,
        data: {
          targetChannelId: c2.channelId,
          fundingStrategy: 'Direct',
          role: 'app',
        },
      },
      w.knex
    );

    const {outbox, channelResults} = await w.joinChannels(channelIds);

    expect(getChannelResultFor(c1.channelId, channelResults)).toMatchObject({
      channelId: c1.channelId,
      turnNum: 0,
    });

    expect(getChannelResultFor(c2.channelId, channelResults)).toMatchObject({
      channelId: c2.channelId,
      turnNum: 0,
    });

    expect(getSignedStateFor(c1.channelId, outbox)).toMatchObject({...state1, turnNum: 0});
    expect(getSignedStateFor(c2.channelId, outbox)).toMatchObject({...state2, turnNum: 0});

    await Promise.all(
      channelIds.map(async c => {
        const updated = await Channel.forId(c, w.knex);
        expect(updated.protocolState).toMatchObject({
          latest: {turnNum: 0},
          supported: {turnNum: 0},
        });
      })
    );
  });

  it('signs the prefund setup ', async () => {
    const appData = '0x0f00';
    const preFS0 = {turnNum: 0, appData};
    const preFS1 = {turnNum: 0, appData};
    const c = channel({
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy([alice()])(preFS0)],
    });
    await Channel.query(w.knex).insert(c);
    const {channelId} = c;
    const current = await Channel.forId(channelId, w.knex);

    expect(current.protocolState).toMatchObject({latest: preFS0, supported: undefined});

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: current.participants,
        data: {
          targetChannelId: current.channelId,
          fundingStrategy: 'Direct',
          role: 'app',
        },
      },
      w.knex
    );

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [{params: {recipient: 'alice', sender: 'bob', data: {signedStates: [preFS1]}}}],
      channelResult: {channelId, turnNum: 0, appData, status: 'opening'},
    });

    const updated = await Channel.forId(channelId, w.knex);

    expect(updated.protocolState).toMatchObject({latest: preFS1, supported: preFS1});
  });

  it('signs the prefund setup and makes a deposit, when I am first to deposit in a directly funded app', async () => {
    const outcome = simpleEthAllocation([{destination: bobP().destination, amount: BN.from(5)}]);
    const preFS0 = {turnNum: 0, outcome};
    const preFS1 = {turnNum: 0, outcome};

    const c = channel({
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy([alice()])(preFS0)],
    });

    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);
    expect(current.latest).toMatchObject(preFS0);
    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: current.participants,
        data: {
          targetChannelId: current.channelId,
          fundingStrategy: 'Direct',
          role: 'app',
        },
      },
      w.knex
    );

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {
            recipient: 'alice',
            sender: 'bob',
            data: {signedStates: [{...preFS1, outcome: serializeOutcome(preFS1.outcome)}]},
          },
        },
      ],
      channelResult: {channelId, turnNum: 0, status: 'opening'},
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({
      latest: preFS1,
      supported: preFS1,
      chainServiceRequests: [
        {
          request: 'fund',
          attempts: 1,
          channelId,
        },
      ],
    });
  });
});

describe('ledger funded app scenarios', () => {
  let ledger: Channel;
  let app: Channel;
  let expectedUpdatedLedgerState: SignedStateWithHash;

  beforeEach(async () => {
    const someNonConflictingChannelNonce = 23364518;

    // NOTE: Put a ledger Channel in the DB
    ledger = await Channel.query(w.knex).insert(
      channel({
        signingAddress: bob().address,
        channelNonce: someNonConflictingChannelNonce,
        appDefinition: '0x0000000000000000000000000000000000000000',
        vars: [
          stateWithHashSignedBy([alice(), bob()])({
            appDefinition: '0x0000000000000000000000000000000000000000',
            channelNonce: someNonConflictingChannelNonce,
            turnNum: 4,
            outcome: simpleEthAllocation([{destination: bobP().destination, amount: BN.from(5)}]),
          }),
        ],
      })
    );

    await Channel.setLedger(ledger.channelId, ETH_ASSET_HOLDER_ADDRESS, w.knex);

    // Generate application channel
    app = channel({
      fundingStrategy: 'Ledger',
      fundingLedgerChannelId: ledger.channelId,
    });

    // Construct expected ledger update state
    expectedUpdatedLedgerState = {
      ...ledger.latest,
      turnNum: 6,
      outcome: {
        type: 'SimpleAllocation' as const,
        assetHolderAddress: makeAddress('0x0000000000000000000000000000000000000000'),
        allocationItems: [
          {
            destination: makeDestination(app.channelId), // Funds allocated to channel
            amount: BN.from(5), // As per channel outcome
          },
        ],
      },
    };
  });

  const putTestChannelInsideWallet = async (args: Objection.PartialModelObject<Channel>) => {
    const channel = await Channel.query(w.knex).insert(args);

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: channel.participants,
        data: {
          targetChannelId: channel.channelId,
          fundingStrategy: 'Ledger',
          fundingLedgerChannelId: ledger.channelId,
          role: 'app',
        },
      },
      w.knex
    );

    return channel;
  };

  it('countersigns a prefund setup and automatically proposes a ledger update', async () => {
    const outcome = simpleEthAllocation([{destination: bobP().destination, amount: BN.from(5)}]);
    const preFS0 = {turnNum: 0, outcome};
    const preFS1 = {turnNum: 0, outcome};

    const {channelId} = await putTestChannelInsideWallet({
      ...app,
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy([alice()])(preFS0)],
    });

    const signedPreFS1 = stateWithHashSignedBy([alice(), bob()])(preFS1);

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {
            recipient: 'alice',
            sender: 'bob',
            data: {
              signedStates: [serializeState(stateWithHashSignedBy([bob()])(signedPreFS1))],
              requests: [
                serializeRequest({
                  type: 'ProposeLedgerUpdate',
                  channelId: ledger.channelId,
                  outcome: expectedUpdatedLedgerState.outcome,
                  nonce: 1,
                  signingAddress: bob().address,
                }),
              ],
            },
          },
        },
      ],
      channelResult: {
        channelId,
        turnNum: 0,
        allocations: serializeAllocation(outcome),
        status: 'opening',
      },
    });

    const {protocolState} = await Channel.forId(channelId, w.knex);

    expect(protocolState).toMatchObject({
      latest: signedPreFS1,
      supported: signedPreFS1,
    });
  });
});
