import _ from 'lodash';
import {FundingStrategy} from '@statechannels/client-api-schema';
import {
  BN,
  calculateChannelId,
  ChannelConstants,
  makeAddress,
  makeDestination,
  makePrivateKey,
  Participant,
  PrivateKey,
  serializeState,
  SignedStateWithHash,
  SimpleAllocation,
  simpleEthAllocation,
  State,
  NULL_APP_DATA,
  CloseChannel,
  DefundChannel,
  OpenChannel,
  Destination,
} from '@statechannels/wallet-core';
import {SignedState as WireState, Payload} from '@statechannels/wire-format';
import {constants, utils} from 'ethers';

import {Channel} from '../../../models/channel';
import {defaultTestWalletConfig} from '../../../config';
import {WalletObjective, ObjectiveModel} from '../../../models/objective';
import {SigningWallet} from '../../../models/signing-wallet';
import {WALLET_VERSION} from '../../../version';
import {Store} from '../../store';
import {Bytes32} from '../../../type-aliases';

import {alice, bob} from './participants';
import {alice as aliceWallet, bob as bobWallet} from './signing-wallets';
import {stateWithHashSignedBy} from './states';

/**
 * Arguments for constructing a TestChannel
 *
 * @param finalFrom - a turnnumber where the channel bceoms finalized. All subsequent states willl be final and have this turn number
 */
interface TestChannelArgs {
  aBal?: number;
  bBal?: number;
  finalFrom?: number;
  fundingStrategy?: FundingStrategy;
  fundingLedgerChannelId?: Bytes32;
}

export type Bals = [string, number][] | [number, number];

/** A two-party channel between Alice and Bob, with state history. For testing purposes. */
export class TestChannel {
  public participantA: Participant = alice();
  public participantB: Participant = bob();

  public signingWalletA: SigningWallet = aliceWallet();
  public signingWalletB: SigningWallet = bobWallet();
  public startBals: Bals;
  public channelNonce: number;
  public finalFrom?: number;
  public fundingStrategy: FundingStrategy;
  public fundingLedgerChannelId: Bytes32 | undefined;
  static maximumNonce = 0;

  public asset = makeAddress(constants.AddressZero);
  public get participants(): Participant[] {
    return [this.participantA, this.participantB];
  }
  public get signingWallets(): SigningWallet[] {
    return [this.signingWalletA, this.signingWalletB];
  }

  public static create(args: TestChannelArgs): TestChannel {
    return new TestChannel(args);
  }

  protected constructor(args: TestChannelArgs) {
    this.fundingLedgerChannelId = args.fundingLedgerChannelId;
    this.fundingStrategy =
      args.fundingStrategy || (args.fundingLedgerChannelId ? 'Ledger' : 'Direct');
    this.startBals = [
      ['a', args.aBal ?? 5],
      ['b', args.bBal ?? 5],
    ];
    this.finalFrom = args.finalFrom;
    this.channelNonce = TestChannel.maximumNonce++;
  }

  /**
   * Gives the nth state in the history, signed by the correct participant
   *
   * @param n - the index of the state in the history
   *
   * Note - in cases where participants double-sign the same states, n might _not_
   * be the turnNum
   */
  public state(n: number, bals?: Bals): State {
    if (n < 2) {
      // in prefund setup, everyone signs state 0
      n = 0;
    } else if (n < 4) {
      // postfund setup, everyone signs state 3
      n = 3;
    } else if (this.finalFrom && n > this.finalFrom) {
      // when finalizing, everyone signs the final state
      n = this.finalFrom;
    }

    return {
      ...this.channelConstants,
      appData: NULL_APP_DATA,
      isFinal: !!this.finalFrom && n >= this.finalFrom,
      // test channels adopt a countersigning strategy for final states, so the turn number doesn't progress after finalFrom.
      turnNum: n,
      outcome: bals ? this.toOutcome(bals) : this.startOutcome,
    };
  }

  public signedStateWithHash(n: number, bals?: Bals, signedBy?: SignedBy): SignedStateWithHash {
    if (_.isUndefined(signedBy)) signedBy = n % 2 === 0 ? 0 : 1; // default to the signer
    const signers = signedBy === 'both' ? [0, 1] : [signedBy];
    return stateWithHashSignedBy(signers.map(x => this.signingWallets[x]))(this.state(n, bals));
  }

  /**
   * Gives the nth state in the history, signed by the correct participant
   */
  public wireState(n: number, bals?: Bals, signedBy?: SignedBy): WireState {
    return serializeState(this.signedStateWithHash(n, bals, signedBy));
  }

  public wirePayload(n: number, bals?: Bals, signedBy?: SignedBy): Payload {
    return {
      walletVersion: WALLET_VERSION,
      signedStates: [this.wireState(n, bals, signedBy)],
    };
  }

  public get startOutcome(): SimpleAllocation {
    return this.toOutcome(this.startBals);
  }

  public get isLedger(): boolean {
    return false;
  }

  public toOutcome(bals: Bals): SimpleAllocation {
    if (typeof bals[0] === 'number') {
      bals = bals as [number, number];
      // of format [number, number]
      bals = [
        ['a', bals[0]],
        ['b', bals[1]],
      ];
    }

    bals = bals as [string, number][];
    return simpleEthAllocation(
      bals.map(([dest, amt]) => {
        const amount = BN.from(amt);
        if (dest === 'a') {
          return {destination: this.participantA.destination, amount};
        } else if (dest === 'b') {
          return {destination: this.participantB.destination, amount};
        } else {
          return {destination: makeDestination(dest), amount: BN.from(amt)};
        }
      })
    );
  }

  public get signingKeyA(): PrivateKey {
    return makePrivateKey(this.signingWalletA.privateKey);
  }

  public get signingKeyB(): PrivateKey {
    return makePrivateKey(this.signingWalletB.privateKey);
  }

  public get signingKeys(): PrivateKey[] {
    return [this.signingKeyA, this.signingKeyB];
  }

  public get channelConstants(): ChannelConstants {
    return {
      appDefinition: makeAddress('0x000000000000000000000000000000000000adef'),
      participants: this.participants,
      channelNonce: this.channelNonce,
      chainId: utils.hexlify(defaultTestWalletConfig().networkConfiguration.chainNetworkID),
      challengeDuration: 9001,
    };
  }

  public get channelId(): Destination {
    return makeDestination(calculateChannelId(this.channelConstants));
  }

  public get openChannelObjective(): OpenChannel {
    return {
      participants: this.participants,
      type: 'OpenChannel',
      data: {
        targetChannelId: this.channelId,
        fundingStrategy: this.fundingStrategy,
        fundingLedgerChannelId: this.fundingLedgerChannelId,
      },
    };
  }

  public closeChannelObjective(txSubmitterOrder = [0, 1]): CloseChannel {
    return {
      participants: this.participants,
      type: 'CloseChannel',
      data: {
        targetChannelId: this.channelId,
        fundingStrategy: this.fundingStrategy,
        txSubmitterOrder,
      },
    };
  }

  public defundChannelObjective(): DefundChannel {
    return {
      participants: this.participants,
      type: 'DefundChannel',
      data: {
        targetChannelId: this.channelId,
      },
    };
  }

  public get openChannelPayload(): Payload {
    return {
      walletVersion: WALLET_VERSION,
      signedStates: [this.wireState(0)],
      objectives: [this.openChannelObjective],
    };
  }

  public get getChannelRequest(): Payload {
    return {
      walletVersion: WALLET_VERSION,
      requests: [{channelId: this.channelId, type: 'GetChannel'}],
    };
  }

  static mergePayloads(payload1: Payload, payload2: Payload): Payload {
    return {
      walletVersion: payload1.walletVersion,
      signedStates: combineArrays(payload1.signedStates, payload2.signedStates),
      requests: combineArrays(payload1.requests, payload2.requests),
      objectives: combineArrays(payload1.objectives, payload2.objectives),
    };
  }

  static get emptyPayload(): Payload {
    return {walletVersion: WALLET_VERSION};
  }

  public get startBal(): number {
    if (typeof this.startBals[0] === 'number') {
      return (this.startBals as [number, number]).reduce((sum, amt) => sum + amt);
    } else {
      return (this.startBals as [string, number][]).reduce((sum, [_dest, amt]) => sum + amt, 0);
    }
  }

  public async insertState(
    store: Store,
    state: StateWithBals | number,
    bals?: Bals
  ): Promise<number> {
    if (typeof state === 'number') {
      await store.pushMessage(this.wirePayload(Number(state), bals));
      return Number(state);
    } else {
      await store.pushMessage(this.wirePayload(Number(state.turn), state.bals, state.signedBy));
      return Number(state.turn);
    }
  }

  /**
   * Calls addSigningKey, pushMessage, updateFunding, on the supplied store, patches the fundingStrategy, and adds the OpenChannel objective
   */
  public async insertInto(
    store: Store,
    args: InsertionParams = {}
  ): Promise<WalletObjective<OpenChannel>> {
    const {states, participant, bals} = {states: [0], participant: 0, ...args};

    // load the signingKey for the appopriate participant
    await store.addSigningKey(this.signingKeys[participant]);

    const turnNums = [] as number[];
    // we need to insert the first state, then do the objective, then the other states (sigh)
    // or otherwise the store doesn't skip validations on ledger channels
    const [first, ...rest] = states;
    const turnNum = await this.insertState(store, first, bals);
    turnNums.push(turnNum);

    // insert the OpenChannel objective
    const objective = await ObjectiveModel.insert(
      this.openChannelObjective,
      store.knex,
      'approved'
    );

    // make it a ledger here
    if (this.isLedger) {
      await Channel.setLedger(this.channelId, store.knex);
    }

    const {fundingStrategy, fundingLedgerChannelId} = objective.data;
    await Channel.query(store.knex)
      .where({channelId: this.channelId})
      .patch({fundingStrategy, fundingLedgerChannelId});

    // load in the other states
    for (const state of rest) {
      const turnNum = await this.insertState(store, state, bals);
      turnNums.push(turnNum);
    }

    // if no funds are passed in, fully fund the channel iff we're into post fund setup
    const funds =
      args.funds !== undefined ? args.funds : Math.max(...turnNums) > 1 ? this.startBal : 0;

    // set the funds as specified
    if (funds > 0) {
      await store.updateFunding(this.channelId, BN.from(funds), this.asset);
    }

    // patch the funding strategy
    await Channel.query(store.knex).where({channelId: this.channelId}).patch({
      fundingStrategy: this.fundingStrategy,
    });

    return objective;
  }
}

export interface InsertionParams {
  participant?: 0 | 1;
  states?: number[] | StateWithBals[];
  funds?: number;
  bals?: Bals;
}

export type SignedBy = 0 | 1 | 'both';

export interface StateWithBals {
  turn: number;
  bals: Bals;
  signedBy: SignedBy;
}

function combineArrays<T>(a1: T[] | undefined, a2: T[] | undefined): T[] | undefined {
  const result = [...(a1 || []), ...(a2 || [])];
  if (result.length > 0) {
    return result;
  } else {
    return undefined;
  }
}
