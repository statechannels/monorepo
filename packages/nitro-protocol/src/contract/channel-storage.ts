import {AddressZero, HashZero} from 'ethers/constants';
import {
  bigNumberify,
  defaultAbiCoder,
  hexDataSlice,
  hexlify,
  hexZeroPad,
  isHexString,
  keccak256,
} from 'ethers/utils';
import {hashOutcome, Outcome} from './outcome';
import {hashState, State} from './state';
import {Address, Bytes, Bytes32, Uint48} from './types';

export interface ChannelStorage {
  turnNumRecord: Uint48;
  finalizesAt: Uint48;
  state?: State;
  challengerAddress?: Address;
  outcome?: Outcome;
}
const CHANNEL_STORAGE_TYPE = `tuple(
  uint256 turnNumRecord,
  uint256 finalizesAt,
  bytes32 stateHash,
  address challengerAddress,
  bytes32 outcomeHash
)`;

export interface ChannelStorageLite {
  finalizesAt: Uint48;
  state: State;
  challengerAddress: Address;
  outcome: Outcome;
}
const CHANNEL_STORAGE_LITE_TYPE = `tuple(
  uint256 finalizesAt,
  bytes32 stateHash,
  address challengerAddress,
  bytes32 outcomeHash
)`;

export function hashChannelStorage(channelStorage: ChannelStorage): Bytes32 {
  const {turnNumRecord, finalizesAt} = channelStorage;
  const hash = keccak256(encodeChannelStorage(channelStorage));
  const fingerprint = hexDataSlice(hash, 12);

  const storage =
    '0x' +
    hexZeroPad(hexlify(turnNumRecord), 6).slice(2) +
    hexZeroPad(hexlify(finalizesAt), 6).slice(2) +
    fingerprint.slice(2);

  return storage;
}

export function parseChannelStorageHash(
  channelStorageHashed: Bytes32
): {turnNumRecord: number; finalizesAt: number; fingerprint: Bytes} {
  validateHexString(channelStorageHashed);

  //
  let cursor = 2;
  const turnNumRecord = '0x' + channelStorageHashed.slice(cursor, (cursor += 12));
  const finalizesAt = '0x' + channelStorageHashed.slice(cursor, (cursor += 12));
  const fingerprint = '0x' + channelStorageHashed.slice(cursor);

  return {
    turnNumRecord: asNumber(turnNumRecord),
    finalizesAt: asNumber(finalizesAt),
    fingerprint,
  };
}
const asNumber: (s: string) => number = s => bigNumberify(s).toNumber();

export function channelStorageStruct({
  finalizesAt,
  state,
  challengerAddress,
  turnNumRecord,
  outcome,
}: ChannelStorage) {
  /*
  When the channel is not open, it is still possible for the state and
  challengerAddress to be missing. They should either both be present, or
  both be missing, the latter indicating that the channel is finalized.
  It is currently up to the caller to ensure this.
  */
  const isOpen = finalizesAt === 0;

  if (isOpen && (outcome || state || challengerAddress)) {
    console.warn(
      `Invalid open channel storage: ${JSON.stringify(outcome || state || challengerAddress)}`
    );
  }

  const stateHash = isOpen || !state ? HashZero : hashState(state);
  const outcomeHash = isOpen || !outcome ? HashZero : hashOutcome(outcome);
  challengerAddress = challengerAddress || AddressZero;

  return {turnNumRecord, finalizesAt, stateHash, challengerAddress, outcomeHash};
}

export function encodeChannelStorage(storage: ChannelStorage): Bytes {
  return defaultAbiCoder.encode([CHANNEL_STORAGE_TYPE], [channelStorageStruct(storage)]);
}

export function channelStorageLiteStruct({
  finalizesAt,
  challengerAddress,
  state,
  outcome,
}: ChannelStorageLite) {
  return {
    finalizesAt,
    challengerAddress,
    stateHash: state ? hashState(state) : HashZero,
    outcomeHash: outcome ? hashOutcome(outcome) : HashZero,
  };
}

export function encodeChannelStorageLite(channelStorageLite: ChannelStorageLite): Bytes {
  return defaultAbiCoder.encode(
    [CHANNEL_STORAGE_LITE_TYPE],
    [channelStorageLiteStruct(channelStorageLite)]
  );
}

function validateHexString(hexString) {
  if (!isHexString(hexString)) {
    throw new Error(`Not a hex string: ${hexString}`);
  }
  if (hexString.length !== 66) {
    throw new Error(`Incorrect length: ${hexString.length}`);
  }
}
