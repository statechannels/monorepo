import {FundingStrategy} from '@statechannels/client-api-schema';
import {
  Address,
  BN,
  calculateChannelId,
  ChannelConstants,
  makeAddress,
  makeDestination,
  makePrivateKey,
  Participant,
  PrivateKey,
  serializeState,
  SharedObjective,
  SignedStateWithHash,
  SimpleAllocation,
  simpleEthAllocation,
  State,
  NULL_APP_DATA,
} from '@statechannels/wallet-core';
import {ETH_ASSET_HOLDER_ADDRESS} from '@statechannels/wallet-core/lib/src/config';
import {SignedState as WireState, Payload} from '@statechannels/wire-format';

import {DBOpenChannelObjective} from '../../../models/objective';
import {SigningWallet} from '../../../models/signing-wallet';
import {WALLET_VERSION} from '../../../version';
import {Store} from '../../store';

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
  static maximumNonce = 0;

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
    this.fundingStrategy = args.fundingStrategy || 'Direct';
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

  public signedStateWithHash(n: number, bals?: Bals): SignedStateWithHash {
    return stateWithHashSignedBy([this.signingWallets[n % 2]])(this.state(n, bals));
  }

  /**
   * Gives the nth state in the history, signed by the correct participant
   */
  public wireState(n: number, bals?: Bals): WireState {
    return serializeState(this.signedStateWithHash(n, bals));
  }

  public wirePayload(n: number, bals?: Bals): Payload {
    return {
      walletVersion: WALLET_VERSION,
      signedStates: [this.wireState(n, bals)],
    };
  }

  public get startOutcome(): SimpleAllocation {
    return this.toOutcome(this.startBals);
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
      chainId: '0x01',
      challengeDuration: 9001,
    };
  }

  public get channelId(): string {
    return calculateChannelId(this.channelConstants);
  }

  public get openChannelObjective(): SharedObjective {
    return {
      participants: this.participants,
      type: 'OpenChannel',
      data: {
        targetChannelId: this.channelId,
        fundingStrategy: this.fundingStrategy,
      },
    };
  }

  public get closeChannelObjective(): SharedObjective {
    return {
      participants: this.participants,
      type: 'CloseChannel',
      data: {
        targetChannelId: this.channelId,
        fundingStrategy: this.fundingStrategy,
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

  public get assetHolderAddress(): Address {
    return ETH_ASSET_HOLDER_ADDRESS;
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

  /**
   * Calls addSigningKey, pushMessage, updateFunding, ensureObjective and approveObjective on the supplied store.
   */
  public async insertInto(
    store: Store,
    args: InsertionParams = {}
  ): Promise<DBOpenChannelObjective> {
    const {states, participant, bals} = {states: [0], participant: 0, ...args};

    // load the signingKey for the appopriate participant
    await store.addSigningKey(this.signingKeys[participant]);

    // load in the states
    for (const stateNum of states) {
      await store.pushMessage(this.wirePayload(Number(stateNum), bals));
    }

    // if no funds are passed in, fully fund the channel iff we're into post fund setup
    const funds =
      args.funds !== undefined ? args.funds : Math.max(...states) > 1 ? this.startBal : 0;

    // set the funds as specified
    if (funds > 0) {
      await store.updateFunding(this.channelId, BN.from(funds), this.assetHolderAddress);
    }

    const objective = await store.transaction(async tx => {
      // need to do this to set the funding type
      const o = await store.ensureObjective(this.openChannelObjective, tx);
      await store.approveObjective(o.objectiveId, tx);

      return o as DBOpenChannelObjective;
    });

    return objective;
  }
}

export interface InsertionParams {
  participant?: 0 | 1;
  states?: number[];
  funds?: number;
  bals?: Bals;
}

function combineArrays<T>(a1: T[] | undefined, a2: T[] | undefined): T[] | undefined {
  const result = [...(a1 || []), ...(a2 || [])];
  if (result.length > 0) {
    return result;
  } else {
    return undefined;
  }
}
