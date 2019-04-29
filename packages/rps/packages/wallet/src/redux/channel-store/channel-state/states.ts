import { SignedCommitment, getChannelId } from '../../../domain';

export type ChannelState = PartiallyOpenChannelState | OpenChannelState;

export interface PartiallyOpenChannelState {
  address: string;
  privateKey: string;
  channelId: string;
  libraryAddress: string;
  ourIndex: number;
  participants: [string, string];
  channelNonce: number;
  turnNum: number;
  lastCommitment: SignedCommitment;
  funded: boolean;
}

export interface OpenChannelState extends PartiallyOpenChannelState {
  penultimateCommitment: SignedCommitment;
}

// -------
// Helpers
// -------

export function initializeChannel(
  signedCommitment: SignedCommitment,
  address: string,
  privateKey: string,
): PartiallyOpenChannelState {
  const { commitment } = signedCommitment;
  const { turnNum, channel } = commitment;
  const ourIndex = commitment.destination.indexOf(address);
  const channelId = getChannelId(commitment);
  return {
    address,
    privateKey,
    turnNum,
    ourIndex,
    libraryAddress: channel.channelType,
    participants: channel.participants as [string, string],
    channelNonce: channel.nonce,
    channelId,
    funded: false,
    lastCommitment: signedCommitment,
  };
}

// Pushes a commitment onto the state, updating penultimate/last commitments and the turn number
export function pushCommitment(
  state: ChannelState,
  signedCommitment: SignedCommitment,
): ChannelState {
  const penultimateCommitment = state.lastCommitment;
  const lastCommitment = signedCommitment;
  const turnNum = signedCommitment.commitment.turnNum;
  return { ...state, penultimateCommitment, lastCommitment, turnNum };
}

export function ourTurn(state: ChannelState) {
  const { turnNum, participants, ourIndex } = state;
  const numParticipants = participants.length;
  return turnNum % numParticipants !== ourIndex;
}

export function isFullyOpen(state: ChannelState): state is OpenChannelState {
  return 'penultimateCommitment' in state;
}

export function theirAddress(state: ChannelState): string {
  const { participants, ourIndex } = state;
  const theirIndex = 1 - ourIndex; // todo: only two player channels
  return participants[theirIndex];
}
