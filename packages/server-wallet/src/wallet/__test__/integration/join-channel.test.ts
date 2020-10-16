import {
  simpleEthAllocation,
  BN,
  serializeState,
  serializeAllocation,
  makeDestination,
  SignedStateWithHash,
} from '@statechannels/wallet-core';
import {ETH_ASSET_HOLDER_ADDRESS} from '@statechannels/wallet-core/lib/src/config';
import Objection from 'objection';

import {Channel} from '../../../models/channel';
import {Wallet} from '../..';
import {seedBobsSigningWallet} from '../../../db/seeds/1_signing_wallet_seeds';
import {stateWithHashSignedBy} from '../fixtures/states';
import {bob, alice} from '../fixtures/signing-wallets';
import {alice as aliceP, bob as bobP} from '../fixtures/participants';
import {channel} from '../../../models/__test__/fixtures/channel';
import {defaultTestConfig} from '../../../config';
import {Objective as ObjectiveModel} from '../../../models/objective';

let w: Wallet;
beforeEach(async () => {
  w = new Wallet(defaultTestConfig);
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
      vars: [stateWithHashSignedBy(alice())(state1)],
    });

    await Channel.query(w.knex).insert(c1);
    const c2 = channel({
      signingAddress: bob().address,
      channelNonce: 2,
      vars: [stateWithHashSignedBy(alice())(state2)],
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
        },
        status: 'pending',
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
        },
        status: 'pending',
      },
      w.knex
    );

    const result = await w.joinChannels(channelIds);
    expect(result).toMatchObject({
      outbox: [
        {
          params: {
            recipient: 'alice',
            sender: 'bob',
            data: {
              signedStates: [
                {...state1, turnNum: 1},
                {...state2, turnNum: 1},
              ],
            },
          },
        },
      ],
      channelResults: [{channelId: c1.channelId}, {channelId: c2.channelId}],
    });

    await Promise.all(
      channelIds.map(async c => {
        const updated = await Channel.forId(c, w.knex);
        expect(updated.protocolState).toMatchObject({
          latest: {turnNum: 1},
          supported: {turnNum: 1},
        });
      })
    );
  });

  it('signs the prefund setup ', async () => {
    const appData = '0x0f00';
    const preFS0 = {turnNum: 0, appData};
    const preFS1 = {turnNum: 1, appData};
    const c = channel({
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy(alice())(preFS0)],
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
        },
        status: 'pending',
      },
      w.knex
    );

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [{params: {recipient: 'alice', sender: 'bob', data: {signedStates: [preFS1]}}}],
      channelResult: {channelId, turnNum: 1, appData, status: 'opening'},
    });

    const updated = await Channel.forId(channelId, w.knex);

    expect(updated.protocolState).toMatchObject({latest: preFS1, supported: preFS1});
  });

  it.skip('signs the prefund setup and makes a deposit, when I am first to deposit in a directly funded app', async () => {
    const outcome = simpleEthAllocation([{destination: aliceP().destination, amount: BN.from(5)}]);
    const preFS0 = {turnNum: 0, outcome};
    const preFS1 = {turnNum: 1, outcome};

    const c = channel({
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy(alice())(preFS0)],
    });

    await Channel.query(w.knex).insert(c);

    const channelId = c.channelId;
    const current = await Channel.forId(channelId, w.knex);

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        participants: current.participants,
        data: {
          targetChannelId: current.channelId,
          fundingStrategy: 'Direct',
        },
        status: 'pending',
      },
      w.knex
    );

    const signedPreFS1 = stateWithHashSignedBy(bob())(preFS1);

    expect(current.latest).toMatchObject(preFS0);

    await w.store.addObjective(
      {
        type: 'OpenChannel',
        participants: current.participants,
        data: {
          targetChannelId: current.channelId,
          fundingStrategy: 'Direct',
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
            data: {signedStates: [serializeState(signedPreFS1)]},
          },
        },
      ],
      channelResult: {channelId, turnNum: 1, status: 'opening'},
    });

    const updated = await Channel.forId(channelId, w.knex);
    expect(updated.protocolState).toMatchObject({
      latest: preFS1,
      supported: preFS1,
      chainServiceRequests: ['fund'], // FIXME: Does not work yet because out of order turn numbers
    });
  });
});

describe('ledger funded app scenarios', () => {
  let ledger: Channel;
  let app: Channel;
  let expectedUpdatedLedgerState: SignedStateWithHash;

  beforeEach(async () => {
    // TODO: Add to the truncate() method
    w.store.eraseLedgerDataFromMemory();

    const someNonConflictingChannelNonce = 23364518;

    // NOTE: Put a ledger Channel in the DB
    ledger = await Channel.query(w.knex).insert(
      channel({
        signingAddress: bob().address,
        channelNonce: someNonConflictingChannelNonce,
        vars: [
          stateWithHashSignedBy(
            alice(),
            bob()
          )({
            channelNonce: someNonConflictingChannelNonce,
            turnNum: 4,
            outcome: simpleEthAllocation([{destination: bobP().destination, amount: BN.from(5)}]),
          }),
        ],
      })
    );

    // Update the in-memory Ledgers table
    w.__setLedger(ledger.channelId, ETH_ASSET_HOLDER_ADDRESS);

    // Generate application channel
    app = channel({
      fundingStrategy: 'Ledger',
    });

    // Construct expected ledger update state
    expectedUpdatedLedgerState = {
      // eslint-disable-next-line
      ...ledger.latest!,
      turnNum: 6,
      outcome: {
        type: 'SimpleAllocation' as const,
        // TODO: Avoid hardcoded response
        assetHolderAddress: '0x0000000000000000000000000000000000000000',
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

    // Add the objective into the wallets store (normally would have happened
    // during createChannel or pushMessage call by the wallet)
    await w.store.addObjective(
      {
        type: 'OpenChannel',
        participants: channel.participants,
        data: {
          targetChannelId: channel.channelId,
          fundingStrategy: 'Ledger',
        },
      },
      w.knex
    );

    // Approve the open channel request (normally would have happened
    // during createChannel or joinChannel call by the wallet)
    w.store.objectives[channel.channelNonce].status = 'approved';

    return channel;
  };

  it('countersigns a prefund setup and automatically creates a ledger update', async () => {
    const outcome = simpleEthAllocation([{destination: bobP().destination, amount: BN.from(5)}]);
    const preFS0 = {turnNum: 0, outcome};
    const preFS1 = {turnNum: 1, outcome};

    const {channelId} = await putTestChannelInsideWallet({
      ...app,
      signingAddress: bob().address,
      vars: [stateWithHashSignedBy(alice())(preFS0)],
    });

    const signedPreFS1 = stateWithHashSignedBy(bob())(preFS1);

    await expect(w.joinChannel({channelId})).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {
            recipient: 'alice',
            sender: 'bob',
            data: {
              signedStates: [
                serializeState(stateWithHashSignedBy(bob())(signedPreFS1)),
                serializeState(stateWithHashSignedBy(bob())(expectedUpdatedLedgerState)),
              ],
            },
          },
        },
      ],
      channelResult: {
        channelId,
        turnNum: 1,
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
