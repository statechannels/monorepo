---
id: recommended-patterns
title: Recommended patterns
---

This page details some of the patterns we have adopted in our example apps ([Web3Torrent](https://blog.statechannels.org/introducing-web3torrent/) and [Rock Paper Scissors](https://blog.statechannels.org/deconstructing-a-state-channel-application/)).

## Decide on a funding strategy

This decision has an impact on how your design your application.

### Direct

The user experience for a **directly** funded channel is that users need to deposit funds on chain during channel setup, and release them on chain during channel teardown. The wallet UI will pop up at the appropriate time to guide the user through those transactions.

### Virtual

The user experience for a **virtually** funded channel is improved, in that users need only perform blockchain transactions in order to setup and a teard own a "site budget" and [ledger channel](../protocol-tutorial/off-chain-funding) connection to a state channel hub.

They might set this up on their first visit to your application, and maintain it for the lifetime of many application channels, which are then funded virtually through the hub. Importantly, the wallet UI **will** pop up when administering the hub connection, but will **not** pop up during management of application channels.

This route is best when you need to setup and teardown many channels between many distinct peers during the course of the application (as you would, for example, in a torrenting application).

Using the virtual funding strategy demands a much greater effort with respect to infastructure you must provide -- in particular it requires a state channel hub to be running. At the protocol level, this is just another statechannel participant: but in practice it needs to fulfill a number of important properties: for example, to be well funded, operate without user input and so on. Our reference implementation of such a hub is coming soon.

For a simple game like Rock Paper Scissors, the advantages of virtual funding may or may not be considered necessary. Regardless, switching from direct-funding to virtual-funding at a later stage should be straightforward: statechannel execution should be completely independent of the funding mechanism.

## Application coding

In order for your app to construct state updates of the right format, you'll need to write some Javascript or Typescript helper code. The purpose of this code is to translate between the general-purpose, [protocol-level concepts of `appData` and `outcome`](./quick-start-contracts) and the specific data structures that your application needs to work with. Those structures should mirror those in the Solidity code you have already written. Here's an idea of what we did in Rock Paper Scissors (see the Solidity code [here](https://github.com/statechannels/apps/blob/master/packages/rps/contracts/RockPaperScissors.sol)):

```typescript
import {BigNumber} from 'ethers';
const {hexZeroPad, keccak256, defaultAbiCoder} = ethers.utils;
const {AddressZero, HashZero} = ethers.constants;

export enum Weapon {
  Rock = 0,
  Paper = 1,
  Scissors = 2
}

export enum PositionType {
  Start, // 0
  RoundProposed, // 1
  RoundAccepted, // 2
  Reveal // 3
}

export interface RPSData {
  positionType: PositionType;
  stake: string; // uint256
  preCommit: string; // bytes32
  playerAWeapon: Weapon;
  playerBWeapon: Weapon;
  salt: string; // bytes32
}

export interface Start {
  type: 'start';
  stake: string;
}

export interface RoundProposed {
  type: 'roundProposed';
  stake: string;
  preCommit: string;
}

export interface RoundAccepted {
  type: 'roundAccepted';
  stake: string;
  preCommit: string;
  playerBWeapon: Weapon;
}

export interface Reveal {
  type: 'reveal';
  playerAWeapon: Weapon;
  playerBWeapon: Weapon;
  stake: string;
  salt;
}

export type AppData = Start | RoundProposed | RoundAccepted | Reveal;

function toRPSData(appData: AppData): RPSData {
  let positionType;
  switch (appData.type) {
    case 'start':
      positionType = PositionType.Start;
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
    stake: BigNumber.from(0).toString(),
    preCommit: HashZero,
    playerAWeapon: Weapon.Rock,
    playerBWeapon: Weapon.Rock,
    salt: web3.utils.randomHex(64)
  };

  return {...defaults, ...appData};
}

export function encodeAppData(appData: AppData): string {
  return encodeRPSData(toRPSData(appData));
}

export function encodeRPSData(rpsData: RPSData): string {
  return defaultAbiCoder.encode(
    [
      'tuple(uint8 positionType, uint256 stake, bytes32 preCommit, uint8 playerAWeapon, uint8 playerBWeapon, bytes32 salt)'
    ],
    [rpsData]
  );
}

export function decodeAppData(appDataBytes: string): AppData {
  const parameters = defaultAbiCoder.decode(
    [
      'tuple(uint8 positionType, uint256 stake, bytes32 preCommit, uint8 playerAWeapon, uint8 playerBWeapon, bytes32 salt)'
    ],
    appDataBytes
  )[0];

  const positionType = parameters[0] as PositionType;
  const stake = parameters[1].toString();
  const preCommit = parameters[2];
  const playerAWeapon = parameters[3];
  const playerBWeapon = parameters[4];
  const salt = parameters[5];

  switch (positionType) {
    case PositionType.Start:
      const start: Start = {
        type: 'start',
        stake
      };
      return start;
    case PositionType.RoundProposed:
      const roundProposed: RoundProposed = {
        type: 'roundProposed',
        stake,
        preCommit
      };
      return roundProposed;
    case PositionType.RoundAccepted:
      const roundAccepted: RoundAccepted = {
        type: 'roundAccepted',
        stake,
        preCommit,
        playerBWeapon
      };
      return roundAccepted;
    case PositionType.Reveal:
      const reveal: Reveal = {
        type: 'reveal',
        playerAWeapon,
        playerBWeapon,
        salt,
        stake
      };
      return reveal;
    default:
      return unreachable(positionType);
  }
}

export function hashPreCommit(weapon: Weapon, salt: string) {
  return keccak256(defaultAbiCoder.encode(['uint256', 'bytes32'], [weapon, salt]));
}
```

## Wrapping the channelClient

We recommend that you wrap the channelClient in an `AppSecificChannelClient`, which can leverage your app-specific coding [as above](#application-coding). This additional layer of abstraction should result in cleaner code for the rest of your application.

Here's a sketch of what we did with Rock Paper Scissors (full code available [here](https://github.com/statechannels/apps/blob/master/packages/rps/src/utils/rps-channel-client.ts)):

```typescript
export class RPSChannelClient {
  // store our instance of the ChannelClient as a propery of this class
  constructor(readonly channelClient: ChannelClient) {}

  async createChannel(
    aAddress: string,
    bAddress: string,
    aBal: string,
    bBal: string,
    appAttrs: AppData,
    aOutcomeAddress: string = aAddress,
    bOutcomeAddress: string = bAddress
  ): Promise<ChannelState> {
    const participants = formatParticipants(aAddress, bAddress, aOutcomeAddress, bOutcomeAddress);
    const allocations = formatAllocations(aOutcomeAddress, bOutcomeAddress, aBal, bBal);
    const appDefinition = RPS_ADDRESS;
    const appData = encodeAppData(appAttrs);

    const channelResult = await this.channelClient.createChannel(
      participants,
      allocations,
      appDefinition,
      appData,
      'Direct'
    );

    return convertToChannelState(channelResult);
  }

  // Accepts an app-specific callback,
  // performs the necessary encoding, and subscribes to the
  // channelClient with an appropriate, API-compliant callback
  onChannelUpdated(appCallback: (channelState: ChannelState) => any) {
    return this.channelClient.onChannelUpdated(async cr => {
      const channelState = convertToChannelState(cr);
      appCallback(channelState);
    });
  }

  // ... and wrappers for the other methods
}

const convertToChannelState = (channelResult: ChannelResult): ChannelState => {
  const {
    turnNum,
    channelId,
    status,
    participants,
    allocations,
    appData,
    challengeExpirationTime
  } = channelResult;
  return {
    channelId,
    turnNum: turnNum.toString(),
    status,
    challengeExpirationTime,
    appData: decodeAppData(appData),
    aUserId: participants[0].participantId,
    bUserId: participants[1].participantId,
    aAddress: participants[0].destination,
    bAddress: participants[1].destination,
    aOutcomeAddress: participants[0].destination,
    bOutcomeAddress: participants[1].destination,
    aBal: BigNumber.from(allocations[0].allocationItems[0].amount).toString(),
    bBal: BigNumber.from(allocations[0].allocationItems[1].amount).toString()
  };
};

const formatParticipants = (
  aAddress: string,
  bAddress: string,
  aOutcomeAddress: string = aAddress,
  bOutcomeAddress: string = bAddress
) => [
  {participantId: aAddress, signingAddress: aAddress, destination: aOutcomeAddress},
  {participantId: bAddress, signingAddress: bAddress, destination: bOutcomeAddress}
];

const formatAllocations = (aAddress: string, bAddress: string, aBal: string, bBal: string) => {
  return [
    {
      asset: '0x0000000000000000000000000000000000000000', // We are sticking to ETH here
      allocationItems: [
        {destination: aAddress, amount: BigNumber.from(aBal).toHexString()},
        {destination: bAddress, amount: BigNumber.from(bBal).toHexString()}
      ]
    }
  ];
};
```

## Maintain a cache of channel state

This is convenient data structure to maintain inside your channel client wrapper, as it can provide data synchronously to your UI.
