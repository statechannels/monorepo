import {Weapon} from './weapons';
import {BigNumber, defaultAbiCoder, bigNumberify, keccak256} from 'ethers/utils';
import {HashZero} from 'ethers/constants';
import {randomHex} from '../utils/randomHex';

export enum PositionType {
  Start, // 0
  RoundProposed, // 1
  RoundAccepted, // 2
  Reveal, // 3
}
export interface RPSData {
  positionType: PositionType;
  stake: BigNumber; // uint256
  preCommit: string; // bytes32
  playerAWeapon: Weapon;
  playerBWeapon: Weapon;
  salt: string; // bytes32
}
export interface Start {
  type: 'start';
}
export interface RoundProposed {
  type: 'roundProposed';
  stake: BigNumber;
  preCommit: string;
}

export interface RoundAccepted {
  type: 'roundAccepted';
  stake: BigNumber;
  preCommit: string;
  playerBWeapon: Weapon;
}

export interface Reveal {
  type: 'reveal';
  playerAWeapon: Weapon;
  playerBWeapon: Weapon;
  salt;
}
export type AppData = Start | RoundProposed | RoundAccepted | Reveal;

function toRPSData(appData: AppData): RPSData {
  let positionType;
  switch (appData.type) {
    case 'start':
      positionType = PositionType.Reveal;
      break;
    case 'roundProposed':
      positionType = PositionType.RoundProposed;
      break;
    case 'roundAccepted':
      positionType = PositionType.RoundAccepted;
      break;
    case 'reveal':
      positionType = PositionType.Reveal;
      break;
  }
  const defaults: RPSData = {
    positionType,
    stake: bigNumberify(0),
    preCommit: HashZero,
    playerAWeapon: Weapon.Rock,
    playerBWeapon: Weapon.Rock,
    salt: randomHex(64),
  };

  return {...defaults, ...appData};
}

export function encodeAppData(appData: AppData): string {
  return defaultAbiCoder.encode(
    [
      'tuple(uint8 positionType, uint256 stake, bytes32 preCommit, uint8 playerAWeapon, uint8 playerBWeapon, bytes32 salt)',
    ],
    [toRPSData(appData)]
  );
}

export function decodeAppData(appDataBytes: string): AppData {
  const parameters = defaultAbiCoder.decode(
    [
      'tuple(uint8 positionType, uint256 stake, bytes32 preCommit, uint8 playerAWeapon, uint8 playerBWeapon, bytes32 salt)',
    ],
    appDataBytes
  )[0];

  const positionType = parameters[0];
  const stake = parameters[1];
  const preCommit = parameters[2];
  const playerAWeapon = parameters[3];
  const playerBWeapon = parameters[4];
  const salt = parameters[5];

  switch (positionType as PositionType) {
    case PositionType.Start: // TODO replace these with functions that project out the desired fields
      const start: Start = {
        type: 'start',
      };
      return start;
    case PositionType.RoundProposed:
      const roundProposed: RoundProposed = {
        type: 'roundProposed',
        stake,
        preCommit,
      };
      return roundProposed;
    case PositionType.RoundAccepted:
      const roundAccepted: RoundAccepted = {
        type: 'roundAccepted',
        stake,
        preCommit,
        playerBWeapon,
      };
      return roundAccepted;
    case PositionType.Reveal:
      const reveal: Reveal = {
        type: 'reveal',
        playerAWeapon,
        playerBWeapon,
        salt,
      };
      return reveal;
  }
}

export function hashPreCommit(weapon: Weapon, salt: string) {
  return keccak256(defaultAbiCoder.encode(['uint256', 'bytes32'], [weapon, salt]));
}
