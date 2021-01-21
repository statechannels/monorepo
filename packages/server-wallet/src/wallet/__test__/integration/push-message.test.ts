import {
  calculateChannelId,
  simpleEthAllocation,
  serializeState,
  BN,
  makeDestination,
  SignedStateWithHash,
  SimpleAllocation,
  makeAddress,
  serializeRequest,
  serializeOutcome,
  NULL_APP_DATA,
} from '@statechannels/wallet-core';
import {ChannelResult} from '@statechannels/client-api-schema';
import {PartialModelObject} from 'objection';
import {constants} from 'ethers';

import {Channel} from '../../../models/channel';
import {addHash} from '../../../state-utils';
import {alice, bob, charlie} from '../fixtures/signing-wallets';
import {alice as aliceP, bob as bobP, charlie as charlieP} from '../fixtures/participants';
import {seedAlicesSigningWallet} from '../../../db/seeds/1_signing_wallet_seeds';
import {stateSignedBy, stateWithHashSignedBy} from '../fixtures/states';
import {channel, withSupportedState} from '../../../models/__test__/fixtures/channel';
import {stateVars} from '../fixtures/state-vars';
import {ObjectiveModel} from '../../../models/objective';
import {defaultTestConfig} from '../../../config';
import {DBAdmin} from '../../../db-admin/db-admin';
import {LedgerRequest} from '../../../models/ledger-request';
import {WALLET_VERSION} from '../../../version';
import {PushMessageError} from '../../../errors/wallet-error';
import {Wallet} from '../..';
import {
  getChannelResultFor,
  getSignedStateFor,
  getRequestFor,
} from '../../../__test__/test-helpers';

jest.setTimeout(20_000);

const wallet = Wallet.create(defaultTestConfig());

beforeAll(async () => {
  await wallet.dbAdmin().migrateDB();
});

afterAll(async () => {
  await wallet.destroy();
});
beforeEach(async () => seedAlicesSigningWallet(wallet.knex));

it("doesn't throw on an empty message", () => {
  return expect(wallet.pushMessage({walletVersion: WALLET_VERSION})).resolves.not.toThrow();
});

const zero = 0;
const four = 4;
const five = 5;
const six = 6;

it('stores states contained in the message, in a single channel model', async () => {
  const channelsBefore = await Channel.query(wallet.knex).select();
  expect(channelsBefore).toHaveLength(0);

  const signedStates = [
    stateSignedBy([alice()])({turnNum: five}),
    stateSignedBy([alice(), bob()])({turnNum: four}),
  ];
  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: signedStates.map(s => serializeState(s)),
  });

  const channelsAfter = await Channel.query(wallet.knex).select();

  expect(channelsAfter).toHaveLength(1);
  expect(channelsAfter[0].vars).toHaveLength(2);

  // The Channel model adds the state hash before persisting
  expect(channelsAfter[0].vars).toMatchObject(signedStates);
});

it('ignores duplicate states', async () => {
  const channelsBefore = await Channel.query(wallet.knex).select();
  expect(channelsBefore).toHaveLength(0);

  const signedStates = [
    stateSignedBy([alice()])({turnNum: five}),
    stateSignedBy([alice(), bob()])({turnNum: four}),
  ];
  // First call should add the states
  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: signedStates.map(s => serializeState(s)),
  });
  // Second call should be ignored
  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: signedStates.map(s => serializeState(s)),
  });
  const channelsAfter = await Channel.query(wallet.knex).select();

  expect(channelsAfter).toHaveLength(1);
  expect(channelsAfter[0].vars).toHaveLength(2);

  // The Channel model adds the state hash before persisting
  expect(channelsAfter[0].vars).toMatchObject(signedStates);
});

it('adds signatures to existing states', async () => {
  const channelsBefore = await Channel.query(wallet.knex).select();
  expect(channelsBefore).toHaveLength(0);
  const signedByAlice = stateSignedBy([alice()])({turnNum: five});
  const signedByBob = stateSignedBy([bob()])({turnNum: five});

  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: [serializeState(signedByAlice)],
  });

  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: [serializeState(signedByBob)],
  });
  const channelsAfter = await Channel.query(wallet.knex).select();

  expect(channelsAfter).toHaveLength(1);
  expect(channelsAfter[0].vars).toHaveLength(1);
  const signatures = channelsAfter[0].supported?.signatures.map(s => s.signer);
  expect(signatures).toContain(alice().address);
  expect(signatures).toContain(bob().address);
});

const expectResults = async (
  p: Promise<{channelResults: ChannelResult[]}>,
  channelResults: Partial<ChannelResult>[]
): Promise<void> => {
  await expect(p.then(data => data.channelResults)).resolves.toHaveLength(channelResults.length);
  await expect(p).resolves.toMatchObject({channelResults});
};

describe('channel results', () => {
  it("returns a 'proposed' channel result when receiving the first state from a peer", async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);

    const signedStates = [serializeState(stateSignedBy([bob()])({turnNum: zero}))];

    await expectResults(wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates}), [
      {turnNum: zero, status: 'proposed'},
    ]);
  });

  it("returns a 'running' channel result when receiving a state in a channel that is now running", async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);
    const {channelId} = await Channel.query(wallet.knex).insert(
      withSupportedState()({vars: [stateVars({turnNum: 8})]})
    );

    return expectResults(
      wallet.pushMessage({
        walletVersion: WALLET_VERSION,
        signedStates: [serializeState(stateSignedBy([bob()])({turnNum: 9}))],
      }),
      [{channelId, turnNum: 9, status: 'running'}]
    );
  });

  it("returns a 'closing' channel result when receiving a state in a channel that is now closing", async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);

    const participants = [aliceP(), bobP(), charlieP()];
    const vars = [stateVars({turnNum: 9})];
    const channel = withSupportedState([alice(), bob(), charlie()])({vars, participants});
    const {channelId} = await Channel.query(wallet.knex).insert(channel);

    const signedStates = [stateSignedBy([bob()])({turnNum: 10, isFinal: true, participants})];
    return expectResults(
      wallet.pushMessage({
        walletVersion: WALLET_VERSION,
        signedStates: signedStates.map(ss => serializeState(ss)),
      }),
      [{channelId, turnNum: 10, status: 'closing'}]
    );
  });

  it("returns a 'closed' channel result when receiving a state in a channel that is now closed", async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);

    const signedStates = [
      serializeState(stateSignedBy([alice(), bob()])({turnNum: 9, isFinal: true})),
    ];
    const result = wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates});

    return expectResults(result, [{turnNum: 9, status: 'closed'}]);
  });

  it('stores states for multiple channels', async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);

    const signedStates = [
      stateSignedBy([alice(), bob()])({turnNum: five}),
      stateSignedBy([alice(), bob()])({turnNum: six, channelNonce: 567, appData: '0x0f00'}),
    ];

    const p = wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      signedStates: signedStates.map(s => serializeState(s)),
    });

    await expectResults(p, [{turnNum: six, appData: '0x0f00'}, {turnNum: five}]);

    const channelsAfter = await Channel.query(wallet.knex).select();

    expect(channelsAfter).toHaveLength(2);
    expect(channelsAfter[0].vars).toHaveLength(1);

    // The Channel model adds the state hash before persisting

    const stateVar = signedStates[1];
    const record = await Channel.forId(calculateChannelId(stateVar), wallet.knex);

    expect(record.vars[0]).toMatchObject(stateVar);
  });
});

it("Doesn't store stale states", async () => {
  const channelsBefore = await Channel.query(wallet.knex).select();
  expect(channelsBefore).toHaveLength(0);

  const signedStates = [serializeState(stateSignedBy([alice(), bob()])({turnNum: five}))];
  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates,
  });

  const afterFirst = await Channel.query(wallet.knex).select();

  expect(afterFirst).toHaveLength(1);
  expect(afterFirst[0].vars).toHaveLength(1);
  expect(afterFirst[0].supported).toBeTruthy();
  expect(afterFirst[0].supported?.turnNum).toEqual(five);

  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: [serializeState(stateSignedBy()({turnNum: four}))],
  });
  const afterSecond = await Channel.query(wallet.knex).select();
  expect(afterSecond[0].vars).toHaveLength(1);
  expect(afterSecond).toMatchObject(afterFirst);

  await wallet.pushMessage({
    walletVersion: WALLET_VERSION,
    signedStates: [serializeState(stateSignedBy()({turnNum: six}))],
  });

  const afterThird = await Channel.query(wallet.knex).select();
  expect(afterThird[0].vars).toHaveLength(2);
});

it("doesn't store states for unknown signing addresses", async () => {
  await new DBAdmin(wallet.knex).truncateDB(['signing_wallets']);

  const signedStates = [serializeState(stateSignedBy([alice(), bob()])({turnNum: five}))];
  return expect(wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates})).rejects.toThrow(
    PushMessageError
  );
});

describe('when the application protocol returns an action', () => {
  it('signs the postfund setup when the prefund setup is supported', async () => {
    const state = stateSignedBy()({outcome: simpleEthAllocation([])});

    const c = channel({vars: [addHash(state)]});
    await Channel.query(wallet.knex).insert(c);

    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        status: 'approved',
        participants: c.participants,
        data: {
          targetChannelId: c.channelId,
          fundingStrategy: 'Fake', // Could also be Direct, funding is empty
          role: 'app',
        },
      },
      wallet.knex
    );

    expect(c.latestSignedByMe?.turnNum).toEqual(0);
    expect(c.supported).toBeUndefined();
    const {channelId} = c;

    const p = wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      signedStates: [serializeState(stateSignedBy([bob()])(state))],
    });
    await expectResults(p, [{channelId, status: 'opening'}]);
    await expect(p).resolves.toMatchObject({
      outbox: [{method: 'MessageQueued', params: {data: {signedStates: [{turnNum: 3}]}}}],
    });

    const updatedC = await Channel.forId(channelId, wallet.knex);
    expect(updatedC.protocolState).toMatchObject({
      latestSignedByMe: {turnNum: 3},
      supported: {turnNum: 0},
    });
  });

  it('forms a conclusion proof when the peer wishes to close the channel', async () => {
    const turnNum = 6;
    const state = stateSignedBy()({outcome: simpleEthAllocation([]), turnNum});

    const c = channel({vars: [addHash(state)]});
    await Channel.query(wallet.knex).insert(c);

    const {channelId} = c;

    const finalState = {...state, isFinal: true, turnNum: turnNum + 1};
    const p = wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      signedStates: [serializeState(stateSignedBy([bob()])(finalState))],
      objectives: [
        {
          type: 'CloseChannel',
          participants: [],
          data: {
            targetChannelId: channelId,
            fundingStrategy: 'Direct',
          },
        },
      ],
    });
    await expectResults(p, [{channelId, status: 'closed'}]);
    await expect(p).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {data: {signedStates: [{turnNum: turnNum + 1, isFinal: true}]}},
        },
      ],
    });

    const updatedC = await Channel.forId(channelId, wallet.knex);
    expect(updatedC.protocolState).toMatchObject({
      latestSignedByMe: {turnNum: turnNum + 1},
      supported: {turnNum: turnNum + 1},
    });
  });
});

describe('when there is a request provided', () => {
  it('has nothing in the outbox if there is no request added', async () => {
    await expect(
      wallet.pushMessage({walletVersion: WALLET_VERSION, requests: []})
    ).resolves.toMatchObject({
      outbox: [],
    });
  });

  it('appends message with single state to the outbox satisfying a GetChannel request', async () => {
    // Set up test by adding a single state into the DB via pushMessage call
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);
    const signedStates = [serializeState(stateSignedBy([bob()])({turnNum: zero}))];
    await wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates});

    // Get the channelId of that which was added
    const [{channelId}] = await Channel.query(wallet.knex).select();

    // Expect a GetChannel request to produce an outbound message with all states
    await expect(
      wallet.pushMessage({
        walletVersion: WALLET_VERSION,
        requests: [{type: 'GetChannel', channelId}],
      })
    ).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {data: {signedStates}},
        },
      ],
    });
  });

  it('appends message with multiple states to the outbox satisfying a GetChannel request', async () => {
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);

    const signedStates = [
      stateSignedBy([alice()])({turnNum: five}),
      stateSignedBy([alice(), bob()])({turnNum: four}),
    ].map(s => serializeState(s));

    await wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates});

    // Get the channelId of that which was added
    const [{channelId}] = await Channel.query(wallet.knex).select();

    // Expect a GetChannel request to produce an outbound message with all states
    await expect(
      wallet.pushMessage({
        walletVersion: WALLET_VERSION,
        requests: [{type: 'GetChannel', channelId}],
      })
    ).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {data: {signedStates: expect.arrayContaining(signedStates)}},
        },
      ],
    });
  });

  it('appends proposed ledger update to the outbox satisfying a GetChannel request', async () => {
    // Set up test by adding a single state into the DB via pushMessage call
    const channelsBefore = await Channel.query(wallet.knex).select();
    expect(channelsBefore).toHaveLength(0);
    const signedStates = [serializeState(stateSignedBy([bob()])({turnNum: zero}))];
    await wallet.pushMessage({walletVersion: WALLET_VERSION, signedStates});

    // Get the channelId of that which was added
    const [{channelId}] = await Channel.query(wallet.knex).select();

    // Manually set this channel as a ledger
    await Channel.setLedger(
      channelId,
      makeAddress('0x0000000000000000000000000000000000001337'),
      wallet.knex
    );

    const someArbitraryOutcome: SimpleAllocation = {
      type: 'SimpleAllocation',
      assetHolderAddress: makeAddress('0x0000000000000000000000000000000000001337'),
      allocationItems: [],
    };
    await wallet.store.storeLedgerProposal(channelId, someArbitraryOutcome, 1, alice().address);

    // Expect a GetChannel request to produce an outbound message with all states
    await expect(
      wallet.pushMessage({
        walletVersion: WALLET_VERSION,
        requests: [{type: 'GetChannel', channelId}],
      })
    ).resolves.toMatchObject({
      outbox: [
        {
          method: 'MessageQueued',
          params: {
            data: {
              signedStates,
              requests: [
                {
                  type: 'ProposeLedgerUpdate',
                  channelId,
                  outcome: serializeOutcome(someArbitraryOutcome),
                },
              ],
            },
          },
        },
      ],
    });
  });
});

describe('ledger funded app scenarios', () => {
  let ledger: Channel;
  let app: Channel;
  let expectedUpdatedLedgerState: SignedStateWithHash;

  const preFS = {
    turnNum: 0,
    outcome: simpleEthAllocation([{destination: aliceP().destination, amount: BN.from(5)}]),
  };

  beforeEach(async () => {
    const someNonConflictingChannelNonce = 23364518;

    // NOTE: Put a ledger Channel in the DB
    ledger = await Channel.query(wallet.knex).insert(
      channel({
        channelNonce: someNonConflictingChannelNonce,
        appDefinition: '0x0000000000000000000000000000000000000000',
        vars: [
          stateWithHashSignedBy([alice(), bob()])({
            appData: NULL_APP_DATA,
            appDefinition: '0x0000000000000000000000000000000000000000',
            channelNonce: someNonConflictingChannelNonce,
            turnNum: 4,
            outcome: simpleEthAllocation([{destination: aliceP().destination, amount: BN.from(5)}]),
          }),
        ],
      })
    );

    await Channel.setLedger(ledger.channelId, makeAddress(constants.AddressZero), wallet.knex);

    // Generate application channel
    app = channel({
      fundingStrategy: 'Ledger',
      fundingLedgerChannelId: ledger.channelId,
    });

    // Construct expected ledger update state
    expectedUpdatedLedgerState = {
      ...ledger.latest,
      turnNum: 5,
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

  const putTestChannelInsideWallet = async (args: PartialModelObject<Channel>) => {
    const channel = await Channel.query(wallet.knex).insert(args);

    // Add the objective into the wallets store (normally would have happened
    // during createChannel or pushMessage call by the wallet)
    await ObjectiveModel.insert(
      {
        type: 'OpenChannel',
        status: 'approved',
        participants: channel.participants,
        data: {
          targetChannelId: channel.channelId,
          fundingStrategy: 'Ledger',
          fundingLedgerChannelId: ledger.channelId,
          role: 'app',
        },
      },
      wallet.knex
    );

    return channel;
  };

  it('proposes ledger update received with prefund setup in pushMessage call', async () => {
    const {latest} = await putTestChannelInsideWallet({
      ...app,
      vars: [stateWithHashSignedBy([alice()])(preFS)],
    });

    const {outbox, channelResults} = await wallet.pushMessage({
      signedStates: [serializeState(stateWithHashSignedBy([bob()])(latest))],
      walletVersion: WALLET_VERSION,
      requests: [
        serializeRequest({
          type: 'ProposeLedgerUpdate',
          channelId: ledger.channelId,
          outcome: expectedUpdatedLedgerState.outcome,
          nonce: 1,
          signingAddress: alice().address,
        }),
      ],
    });

    expect(getRequestFor(ledger.channelId, outbox)).toMatchObject({
      type: 'ProposeLedgerUpdate',
      outcome: serializeOutcome(expectedUpdatedLedgerState.outcome),
    });

    expect(getChannelResultFor(app.channelId, channelResults)).toMatchObject({
      turnNum: 0,
      status: 'opening',
    });
  });

  it('responds with ledger proposal when it already has prefund setup', async () => {
    await putTestChannelInsideWallet({
      ...app,
      vars: [stateWithHashSignedBy([alice(), bob()])(preFS)],
    });

    await LedgerRequest.setRequest(
      {
        ledgerChannelId: ledger.channelId,
        channelToBeFunded: app.channelId,
        status: 'pending', // TODO: could this be approved?
        type: 'fund',
      },
      wallet.knex
    );

    const {outbox} = await wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      requests: [
        serializeRequest({
          type: 'ProposeLedgerUpdate',
          channelId: ledger.channelId,
          outcome: expectedUpdatedLedgerState.outcome,
          nonce: 1,
          signingAddress: alice().address,
        }),
      ],
    });

    expect(getRequestFor(ledger.channelId, outbox)).toMatchObject({
      type: 'ProposeLedgerUpdate',
      outcome: serializeOutcome(expectedUpdatedLedgerState.outcome),
    });
  });

  it('signs outcome from ledger proposal', async () => {
    await putTestChannelInsideWallet({
      ...app,
      vars: [stateWithHashSignedBy([alice(), bob()])(preFS)],
    });

    await LedgerRequest.setRequest(
      {
        ledgerChannelId: ledger.channelId,
        channelToBeFunded: app.channelId,
        status: 'pending',
        type: 'fund',
      },
      wallet.knex
    );

    await wallet.store.storeLedgerProposal(
      ledger.channelId,
      expectedUpdatedLedgerState.outcome,
      1,
      alice().address
    );

    const {outbox} = await wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      requests: [
        serializeRequest({
          type: 'ProposeLedgerUpdate',
          channelId: ledger.channelId,
          outcome: expectedUpdatedLedgerState.outcome,
          nonce: 1,
          signingAddress: bob().address,
        }),
      ],
    });

    expect(getSignedStateFor(ledger.channelId, outbox)).toMatchObject(
      serializeState(stateWithHashSignedBy([alice()])(expectedUpdatedLedgerState))
    );
  });

  it('signs outcome from ledger proposal (does conflict resolution too)', async () => {
    await putTestChannelInsideWallet({
      ...app,
      vars: [stateWithHashSignedBy([alice(), bob()])(preFS)],
    });

    await LedgerRequest.setRequest(
      {
        ledgerChannelId: ledger.channelId,
        channelToBeFunded: app.channelId,
        status: 'pending',
        type: 'fund',
      },
      wallet.knex
    );

    await wallet.store.storeLedgerProposal(
      ledger.channelId,
      expectedUpdatedLedgerState.outcome,
      1,
      alice().address
    );

    // Using spread syntax to do a deep copy essentially
    const conflictingUpdatedLedgerState = {
      ...expectedUpdatedLedgerState,
      outcome: {
        ...expectedUpdatedLedgerState.outcome,
        allocationItems: [
          ...(expectedUpdatedLedgerState.outcome as SimpleAllocation).allocationItems,
          {
            destination: bobP().destination,
            amount: BN.from(0),
          },
        ],
      },
    };

    const {outbox} = await wallet.pushMessage({
      walletVersion: WALLET_VERSION,
      requests: [
        serializeRequest({
          type: 'ProposeLedgerUpdate',
          channelId: ledger.channelId,
          outcome: conflictingUpdatedLedgerState.outcome,
          nonce: 1,
          signingAddress: bob().address,
        }),
      ],
    });

    const expectedResolvedUpdatedLedgerState = {
      ...expectedUpdatedLedgerState,
      turnNum: 5,
    };

    expect(getSignedStateFor(ledger.channelId, outbox)).toMatchObject(
      serializeState(stateWithHashSignedBy([alice()])(expectedResolvedUpdatedLedgerState))
    );
  });
});
