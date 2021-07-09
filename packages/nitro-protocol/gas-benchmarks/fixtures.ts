import {Signature} from '@ethersproject/bytes';
import {Wallet} from '@ethersproject/wallet';
import {ContractReceipt, ethers} from 'ethers';

import {
  Allocation,
  Bytes32,
  Channel,
  convertAddressToBytes32,
  encodeOutcome,
  getChannelId,
  getFixedPart,
  Guarantee,
  hashAppPart,
  signChallengeMessage,
  SignedState,
  signState,
  State,
} from '../src';
import {FixedPart, getVariablePart, hashState, VariablePart} from '../src/contract/state';
import {Bytes} from '../src/contract/types';

import {nitroAdjudicator, provider} from './vanillaSetup';

export const chainId = '0x7a69'; // 31337 in hex (hardhat network default)

export const Alice = new Wallet(
  '0x277fb9e0ad81dc836c60294e385b10dfcc0a9586eeb0b1d31da92e384a0d2efa'
);
export const Bob = new Wallet('0xc8774aa98410b3e3281ff1ec40ea2637d2b9280328c4d1ff00d06cd95dd42cbd');
export const Ingrid = new Wallet(
  '0x558789345da13a7ac1d6d6ac9275ba66836eb4a088efc1920db0f5d092d6ee71'
);
export const participants = [Alice.address, Bob.address];
class TestChannel {
  constructor(
    channelNonce: number,
    wallets: ethers.Wallet[],
    guaranteeOrAllocation: Guarantee | Allocation
  ) {
    this.wallets = wallets;
    this.channel = {chainId, channelNonce, participants: wallets.map(w => w.address)};
    this.guaranteeOrAllocation = guaranteeOrAllocation;
  }
  wallets: ethers.Wallet[];
  channel: Channel;
  private guaranteeOrAllocation: Guarantee | Allocation;
  outcome(asset: string) {
    return 'targetChannelId' in this.guaranteeOrAllocation
      ? [{asset, guarantee: this.guaranteeOrAllocation}]
      : [{asset, allocationItems: this.guaranteeOrAllocation}];
  }
  get channelId() {
    return getChannelId(this.channel);
  }
  someState(asset: string): State {
    return {
      challengeDuration: 600,
      appDefinition: '0x8504FcA6e1e73947850D66D032435AC931892116',
      channel: this.channel,
      turnNum: 6,
      isFinal: false,
      outcome: this.outcome(asset),
      appData: '0x', // TODO choose a more representative example
    };
  }

  finalState(asset: string): State {
    return {
      ...this.someState(asset),
      isFinal: true,
    };
  }

  counterSignedSupportProof(
    // for challenging and outcome pushing
    state: State
  ): {
    largestTurnNum: number;
    fixedPart: FixedPart;
    variableParts: VariablePart[];
    isFinalCount: number;
    whoSignedWhat: number[];
    signatures: Signature[];
    challengeSignature: Signature;
    outcomeBytes: string;
    stateHash: string;
    challengerAddress: string;
  } {
    return {
      largestTurnNum: state.turnNum,
      fixedPart: getFixedPart(state),
      variableParts: [getVariablePart(state)],
      isFinalCount: 0,
      whoSignedWhat: this.wallets.map(() => 0),
      signatures: this.wallets.map(w => signState(state, w.privateKey).signature),
      challengeSignature: signChallengeMessage([{state} as SignedState], Alice.privateKey),
      outcomeBytes: encodeOutcome(state.outcome),
      stateHash: hashState(state),
      challengerAddress: Alice.address,
    };
  }

  supportProof(
    // for concluding
    state: State
  ): {
    largestTurnNum: number;
    fixedPart: FixedPart;
    appPartHash: Bytes32;
    outcomeBytes: Bytes;
    numStates: 1;
    whoSignedWhat: number[];
    sigs: Signature[];
  } {
    return {
      largestTurnNum: state.turnNum,
      fixedPart: getFixedPart(state),
      appPartHash: hashAppPart(state),
      outcomeBytes: encodeOutcome(state.outcome),
      numStates: 1,
      whoSignedWhat: this.wallets.map(() => 0),
      sigs: this.wallets.map(w => signState(state, w.privateKey).signature),
    };
  }

  async concludeAndTransferAllAssetsTx(asset: string) {
    const fP = this.supportProof(this.finalState(asset));
    return await nitroAdjudicator.concludeAndTransferAllAssets(
      fP.largestTurnNum,
      fP.fixedPart,
      fP.appPartHash,
      fP.outcomeBytes,
      fP.numStates,
      fP.whoSignedWhat,
      fP.sigs
    );
  }

  async challengeTx(asset: string) {
    const proof = this.counterSignedSupportProof(this.someState(asset));
    return await nitroAdjudicator.challenge(
      proof.fixedPart,
      proof.largestTurnNum,
      proof.variableParts,
      proof.isFinalCount,
      proof.signatures,
      proof.whoSignedWhat,
      proof.challengeSignature
    );
  }
}

/** An application channel between Alice and Bob */
export const X = new TestChannel(
  2,
  [Alice, Bob],
  [
    {destination: convertAddressToBytes32(Alice.address), amount: '0x5'},
    {destination: convertAddressToBytes32(Bob.address), amount: '0x5'},
  ]
);

/** Another application channel between Alice and Bob */
export const Y = new TestChannel(
  3,
  [Alice, Bob],
  [
    {destination: convertAddressToBytes32(Alice.address), amount: '0x5'},
    {destination: convertAddressToBytes32(Bob.address), amount: '0x5'},
  ]
);

/** Ledger channel between Alice and Bob, providing funds to channel X */
export const LforX = new TestChannel(4, [Alice, Bob], [{destination: X.channelId, amount: '0xa'}]);

/** Joint channel between Alice, Bob, and Ingrid, funding application channel X */
export const J = new TestChannel(
  5,
  [Alice, Bob, Ingrid],
  [
    {destination: X.channelId, amount: '0xa'},
    {destination: convertAddressToBytes32(Ingrid.address), amount: '0xa'},
  ]
);

/** Guarantor channel between Alice and Ingid, targeting joint channel J */
export const G = new TestChannel(6, [Alice, Ingrid], {
  targetChannelId: J.channelId,
  destinations: [
    convertAddressToBytes32(Alice.address),
    convertAddressToBytes32(Ingrid.address),
    X.channelId,
  ],
});
export const LforG = new TestChannel(7, [Alice, Bob], [{destination: G.channelId, amount: '0xa'}]);

// Utils
export async function getFinalizesAtFromTransactionHash(hash: string): Promise<number> {
  const receipt = (await provider.getTransactionReceipt(hash)) as ContractReceipt;
  return nitroAdjudicator.interface.decodeEventLog('ChallengeRegistered', receipt.logs[0].data)[2];
}
export async function waitForChallengesToTimeOut(finalizesAtArray: number[]): Promise<void> {
  const finalizesAt = Math.max(...finalizesAtArray);
  await provider.send('evm_setNextBlockTimestamp', [finalizesAt + 1]);
  await provider.send('evm_mine', []);
}

/**
 * Constructs a support proof for the supplied channel, calls challenge,
 * and asserts the expected gas
 * @returns The proof and finalizesAt
 */
export async function challengeChannelAndExpectGas(
  channel: TestChannel,
  asset: string,
  expectedGas: number
): Promise<{proof: ReturnType<typeof channel.counterSignedSupportProof>; finalizesAt: number}> {
  const proof = channel.counterSignedSupportProof(channel.someState(asset)); // TODO use a nontrivial app with a state transition

  const challengeTx = await nitroAdjudicator.challenge(
    proof.fixedPart,
    proof.largestTurnNum,
    proof.variableParts,
    proof.isFinalCount,
    proof.signatures,
    proof.whoSignedWhat,
    proof.challengeSignature
  );
  await expect(challengeTx).toConsumeGas(expectedGas);

  const finalizesAt = await getFinalizesAtFromTransactionHash(challengeTx.hash);
  return {proof, finalizesAt};
}
