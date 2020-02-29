import {ChannelConstants, StateVariables, SignedState, Participant, State} from './types';
import {signState, hashState, getSignerAddress, calculateChannelId} from './state-utils';
import _ from 'lodash';
import {Funding} from './memory-store';
import {gt, sub, toNumber} from '../utils/hex-number-utils';

export interface ChannelStoreEntry {
  readonly channelId: string;
  readonly myIndex: number;
  readonly latest: StateVariables;
  readonly supported: StateVariables | undefined;
  readonly latestSupportedByMe: StateVariables | undefined;
  readonly channelConstants: ChannelConstants;
  readonly funding?: Funding;
  readonly states: State[];
}

export class MemoryChannelStoreEntry implements ChannelStoreEntry {
  public readonly channelConstants: ChannelConstants;
  constructor(
    constants: ChannelConstants,
    public readonly myIndex: number,
    private stateVariables: Record<string, StateVariables> = {},
    private signatures: Record<string, string[] | undefined> = {},
    public funding: Funding | undefined = undefined
  ) {
    this.channelConstants = _.pick(
      constants,
      'chainId',
      'participants',
      'channelNonce',
      'appDefinition',
      'challengeDuration'
    );

    this.stateVariables = _.transform(this.stateVariables, (result, stateVariables, stateHash) => {
      result[stateHash] = _.pick(stateVariables, 'turnNum', 'outcome', 'appData', 'isFinal');
    });
  }

  public setFunding(funding: Funding) {
    this.funding = funding;
  }

  public get states() {
    return this.sortedByDescendingTurnNum.map(s => ({...this.channelConstants, ...s}));
  }

  private mySignature(stateVars: StateVariables, signatures: string[]): boolean {
    const state = {...stateVars, ...this.channelConstants};
    return signatures.some(sig => getSignerAddress(state, sig) === this.myAddress);
  }

  private get myAddress(): string {
    return this.participants[this.myIndex].signingAddress;
  }

  private getStateVariables(k): StateVariables {
    const vars = this.stateVariables[k];
    if (!vars) throw 'No variable found';
    return vars;
  }

  private getSignatures(k): string[] {
    return this.signatures[k] || [];
  }

  private get signedStates(): Array<StateVariables & {signatures: string[]}> {
    return Object.keys(this.stateVariables).map(k => {
      return {...this.getStateVariables(k), signatures: this.getSignatures(k)};
    });
  }

  private get sortedByDescendingTurnNum(): Array<StateVariables & {signatures: string[]}> {
    return this.signedStates.sort((a, b) => toNumber(sub(b.turnNum, a.turnNum)));
  }

  get supported() {
    // TODO: proper check
    return this.sortedByDescendingTurnNum.find(
      s => s.signatures.filter(sig => !!sig).length === this.participants.length
    );
  }

  get latestSupportedByMe() {
    return this.sortedByDescendingTurnNum.find(s => this.mySignature(s, s.signatures));
  }
  get latest(): StateVariables {
    return this.sortedByDescendingTurnNum[0];
  }

  get channelId(): string {
    return calculateChannelId(this.channelConstants);
  }

  get participants(): Participant[] {
    return this.channelConstants.participants;
  }

  signAndAdd(stateVars: StateVariables, privateKey: string): SignedState {
    const state = {...stateVars, ...this.channelConstants};

    const signatureString = signState(state, privateKey);

    this.addState(stateVars, signatureString);

    return {
      ...stateVars,
      ...this.channelConstants,
      signatures: this.signatures[hashState(state)] || []
    };
  }

  addState(stateVars: StateVariables, signature: string) {
    const state = {...stateVars, ...this.channelConstants};
    const stateHash = hashState(state);
    this.stateVariables[stateHash] = stateVars;
    const {participants} = this.channelConstants;

    // check the signature
    const signer = getSignerAddress(state, signature);
    const signerIndex = participants.findIndex(p => p.signingAddress === signer);

    if (signerIndex === -1) {
      throw new Error('State not signed by a participant of this channel');
    }

    const signatures = this.signatures[stateHash] ?? new Array(this.nParticipants());
    signatures[signerIndex] = signature;
    this.signatures[stateHash] = signatures;

    // Garbage collect stale states
    // TODO: Examine the safety here
    this.stateVariables = _.transform(this.stateVariables, (result, stateVars, stateHash) => {
      if (
        !this.supported ||
        this.inSupport(stateHash) ||
        gt(stateVars.turnNum, this.supported.turnNum)
      )
        result[stateHash] = stateVars;
    });
  }

  private inSupport(key): boolean {
    const supportKeys = this.supported
      ? // TODO get the proper keys
        [hashState({...this.supported, ...this.channelConstants})]
      : [];
    return supportKeys.indexOf(key) !== -1;
  }

  private nParticipants(): number {
    return this.channelConstants.participants.length;
  }
}
