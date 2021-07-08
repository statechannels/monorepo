---
id: off-chain-funding
title: Off-chain funding
---

import Mermaid from '@theme/Mermaid';

This advanced section of the tutorial covers funding and defunding channels by redistributing assets off chain. This has the great advantage of removing the need for most on-chain transactions.

## Indirect funding

Let's introduce one level of indirection between the chain and the state channel we want to fund. We will first set up a ledger channel (L) with a counterparty (we'll call this counterparty "the hub"). We will fund the ledger channel "directly" -- in the same way as we have done [earlier in the tutorial](./deposit-assets).

A ledger channel is a special channel that runs the [null app](../implementation-notes/null-app) (meaning that all transitions are considered invalid, and the channel may only be updated by a state being supported by all participants signing it). The sole purpose of this ledger channel is to reallocate some or all of its funding to other channels and/or state channel participants.

Now imagine that we want to play Rock Paper Scissors (or run some other state channel application) with that same participant. We'll open a new channel (A1) for that.

Instead of funding it on chain, let's just divert some money from our existing ledger channel.

```typescript
// In lesson16.test.ts
// Construct a ledger channel with the hub
const mySigningKey = '0x7ab741b57e8d94dd7e1a29055646bafde7010f38a900f55bbd7647880faa6ee8';
const hubSigningKey = '0x2030b463177db2da82908ef90fa55ddfcef56e8183caf60db464bc398e736e6f';
const me = new ethers.Wallet(mySigningKey).address;
const hub = new ethers.Wallet(hubSigningKey).address;
const myDestination = convertAddressToBytes32(me);
const hubDestination = convertAddressToBytes32(hub);
const participants = [me, hub];
const chainId = '0x1234';
const ledgerChannel: Channel = {
  chainId,
  channelNonce: BigNumber.from(0).toHexString(),
  participants
};
const ledgerChannelId = getChannelId(ledgerChannel);

// Construct a state for that allocates 6 wei to each of us, and has turn numer n - 1
// This is called the "pre fund setup" state

const sixEachStatePreFS: State = {
  isFinal: false,
  channel: ledgerChannel,
  outcome: [
    {
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      allocationItems: [
        {destination: myDestination, amount: parseUnits('6', 'wei').toHexString()},
        {destination: hubDestination, amount: parseUnits('6', 'wei').toHexString()}
      ]
    }
  ],
  appDefinition: AddressZero,
  appData: HashZero,
  challengeDuration: 86400, // 1 day
  turnNum: 1
};

// Collect a support proof by getting all participants to sign this state
signState(sixEachStatePreFS, mySigningKey);
signState(sixEachStatePreFS, hubSigningKey);

// Desposit plenty of funds ON CHAIN
const amount = parseUnits('12', 'wei');
const destination = ledgerChannelId;
const expectedHeld = 0;
const tx0 = ETHAssetHolder.deposit(destination, expectedHeld, amount, {
  value: amount
});
await(await tx0).wait();

// Construct a state that allocates 6 wei to each of us, but with turn number 2n - 1
// This is called the "post fund setup" state

const sixEachStatePostFS: State = {...sixEachStatePreFS, turnNum: 3};

// Collect a support proof by getting all participants to sign this state
signState(sixEachStatePostFS, mySigningKey);
signState(sixEachStatePostFS, hubSigningKey);
```

So far, so standard. We have directly funded a channel, but this time we are calling it a ledger channel, L. The funding graph looks like this:

<Mermaid chart='
graph LR;
linkStyle default interpolate basis;
ETHAssetHolder( )
ledger((L))
me(( )):::external
hub(( )):::external
ETHAssetHolder-->|12|ledger;
ledger-->|6|me;
ledger-->|6|hub;
classDef external fill:#f96
' />

---

Let's create the application channel:

```typescript
// Construct an application channel with the hub
const applicationChannel1: Channel = {
  chainId,
  channelNonce: BigNumber.from(1).toHexString(),
  participants
};
const applicationChannel1Id = getChannelId(applicationChannel1);

// Construct a state that allocates 3 wei to each of us, and has turn numer n - 1
// This is the "pre fund setup" state for our application channel A1

const threeEachStatePreFS: State = {
  isFinal: false,
  channel: applicationChannel1,
  outcome: [
    {
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      allocationItems: [
        {destination: myDestination, amount: parseUnits('3', 'wei').toHexString()},
        {destination: hubDestination, amount: parseUnits('3', 'wei').toHexString()}
      ]
    }
  ],
  appDefinition: ROCK_PAPER_SCISSORS_ADDRESS,
  appData: HashZero,
  challengeDuration: 86400, // 1 day
  turnNum: 1
};

// Collect a support proof by getting all participants to sign this state
signState(threeEachStatePreFS, mySigningKey);
signState(threeEachStatePreFS, hubSigningKey);
```

We are now in the following situation:

<Mermaid chart='
graph LR;
linkStyle default interpolate basis;
ETHAssetHolder( )
ledger((L))
me(( )):::external
hub(( )):::external
me(( )):::external
hub(( )):::external
ETHAssetHolder-->|12|ledger;
ledger-->|6|me;
ledger-->|6|hub;
app((A1)):::defunded
app-->|3|me;
app-->|3|hub;
linkStyle 3,4 opacity:0.2;
classDef external fill:#f96
classDef defunded opacity:0.2;
' />

The application channel A1 exists, but it is not yet funded.

---

Now we proceed to divert the funds:

```typescript
// Fund our first application channel OFF CHAIN
// simply by collecting a support proof for a state such as this:

const threeEachAndSixForTheApp: State = {
  isFinal: false,
  channel: ledgerChannel,
  outcome: [
    {
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      allocationItems: [
        {destination: myDestination, amount: parseUnits('3', 'wei').toHexString()},
        {destination: hubDestination, amount: parseUnits('3', 'wei').toHexString()},
        {
          destination: applicationChannel1Id,
          amount: parseUnits('6', 'wei').toHexString()
        }
      ]
    }
  ],
  appDefinition: AddressZero,
  appData: HashZero,
  challengeDuration: 86400, // 1 day
  turnNum: 4
};

// Construct the "post fund setup" state for the application channel

const threeEachStatePostFS: State = {
  ...threeEachStatePreFS,
  turnNum: 3
};

// Collect a support proof by getting all participants to sign this state
signState(threeEachStatePostFS, mySigningKey);
signState(threeEachStatePostFS, hubSigningKey);
```

Finally, we have our indirectly funded channel

<Mermaid chart='
graph LR;
linkStyle default interpolate basis;
ETHAssetHolder( )
ledger((L))
me(( )):::external
hub(( )):::external
me(( )):::external
hub(( )):::external
ETHAssetHolder-->|12|ledger;
ledger-->|3|me;
ledger-->|3|hub;
ledger-->|6|app
app((A1))
app-->|3|me;
app-->|3|hub;
classDef external fill:#f96
' />

We could fund more application channels from the same ledger channel in the same way, if we wanted to.

## Indirect defunding

Let's say application A1 finished and between me and the hub, we finalize it off chain with an outcome that allocates all the funds to me. To defund it off chain, we just agree to get the funds back into the ledger channel in a manner that preserves each of our balances in the funding graph.

```typescript
// Construct a state that allocates 6 wei to me

const sixForMe: State = {
  isFinal: true,
  channel: applicationChannel1,
  outcome: [
    {
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      allocationItems: [{destination: myDestination, amount: parseUnits('6', 'wei').toHexString()}]
    }
  ],
  appDefinition: ROCK_PAPER_SCISSORS_ADDRESS,
  appData: HashZero,
  challengeDuration: 86400, // 1 day
  turnNum: 100
};

// Collect a support proof by getting all participants to sign this state
signState(sixForMe, mySigningKey);
signState(sixForMe, hubSigningKey);
```

<Mermaid chart='
graph LR;
linkStyle default interpolate basis;
ETHAssetHolder( )
ledger((L))
me(( )):::external
hub(( )):::external
me(( )):::external
hub(( )):::external
ETHAssetHolder-->|12|ledger;
ledger-->|3|me;
ledger-->|3|hub;
ledger-->|6|app
app((A1))
app-->|6|me;
classDef external fill:#f96
' />

---

Now

```typescript
// Fund our first application channel OFF CHAIN
// simply by collecting a support proof for a state such as this:

const nineForMeThreeForTheHub: State = {
  isFinal: false,
  channel: ledgerChannel,
  outcome: [
    {
      asset: MAGIC_ADDRESS_INDICATING_ETH,
      allocationItems: [
        {destination: myDestination, amount: parseUnits('9', 'wei').toHexString()},
        {destination: hubDestination, amount: parseUnits('3', 'wei').toHexString()}
      ]
    }
  ],
  appDefinition: AddressZero,
  appData: HashZero,
  challengeDuration: 86400, // 1 day
  turnNum: 5
};

// Collect a support proof by getting all participants to sign this state
signState(nineForMeThreeForTheHub, mySigningKey);
signState(nineForMeThreeForTheHub, hubSigningKey);
```

and the funding graph now looks like this:

<Mermaid chart='
graph LR;
linkStyle default interpolate basis;
ETHAssetHolder( )
ledger((L))
me(( )):::external
hub(( )):::external
me(( )):::external
hub(( )):::external
ETHAssetHolder-->|12|ledger;
ledger-->|9|me;
ledger-->|3|hub;
app((A1)):::defunded
app-->|6|me;
linkStyle 3 opacity:0.2;
classDef external fill:#f96
classDef defunded opacity:0.2;
' />
The defunded channel A1 can now safely be discarded.

### Challenging with a deep funding tree

If the hub goes AWOL, in the worst-case scenario we would need to finalize the ledger channel as well as _all_ of the channels funded by that ledger channel, in order to recover our on chain deposit. See the section on [sad-path finalization](./finalize-a-channel-sad).
