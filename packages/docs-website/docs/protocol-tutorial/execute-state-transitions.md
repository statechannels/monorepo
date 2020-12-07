---
id: execute-state-transitions
title: Execute state transitions off chain
---

import Mermaid from '@theme/Mermaid';

A state channel can be thought of as an emergent property of data (which we call `state`) exchanged between a fixed set of actors (which we call `participants`). The participants have the ability to digitially sign the states that they exchange, and they also keep track of the underlying `chainId` and `channelNonce` to uniquely identify the interaction they are about to perform.

## Construct a State with the correct format

`@statechannels/nitro-protocol` exposes a `State` type as a container for all the fields that are required:

```typescript
// In lesson1.test.ts

/* Import ethereum wallet utilities  */
import {ethers} from 'ethers';
const {AddressZero, HashZero} = ethers.constants;

/* Import statechannels wallet utilities  */
import {Channel, Outcome, State} from '@statechannels/nitro-protocol';

/* Form the participants array */
const participants = [];
for (let i = 0; i < 3; i++) {
  participants[i] = ethers.Wallet.createRandom().address;
}

/* Mock out a chainId: this could be '1' for mainnet or '3' for ropsten */
const chainId = '0x1234';

/* 
    Define the channelNonce 
    :~ how many times have these participants
    already run a channel on this chain?
  */
const channelNonce = 0;

/* 
    Define the challengeDuration (in seconds)
    :~ how long should participants get to respond to challenges?
  */
const challengeDuration = 86400; // 1 day

/* 
    Mock out the appDefinition and appData.
    We will get to these later in the tutorial
  */
const appDefinition = AddressZero;
const appData = HashZero;

/* Construct a Channel object */
const channel: Channel = {chainId, channelNonce, participants};

/* Mock out an outcome */
const outcome: Outcome = [];

/* Putting it all together */
const state: State = {
  turnNum: 0,
  isFinal: false,
  channel,
  challengeDuration,
  outcome,
  appDefinition,
  appData
};
```

Notice that the outcome field must conform to the `Outcome` type, which we also imported from `@statechannels/nitro-protocol`. The outcome is some data that specifies a redistribution of funds when the channel finalizes. Don't worry about this field just yet, we will revisit it later (we got away with an empty array, for now).

## Fixed and Variable Parts

It is convenient to define some solidity structs, each containing a subset of the above data:

```solidity
struct FixedPart {
  uint256 chainId;
  address[] participants;
  uint48 channelNonce;
  address appDefinition;
  uint48 challengeDuration;
}
```

which contains information which must be identical in every state channel update, and

```solidity
struct VariablePart {
  bytes outcome;
  bytes appData;
}
```

which contains fields which are allowed to change. These structs are part of the contract API, and we can import helper functions to extract a javascript encoding of them:

```typescript
import {getFixedPart, getVariablePart} from '@statechannels/nitro-protocol';

const fixedPart = getFixedPart(state);
const getVariablePart = getVariablePart(state);
```
### Precautions

As a state channel participant, it is advised to check the `FixedPart` of any channel before participating in it. A good state channels wallet will perform these checks for you:

- `chainId` -- This needs to match the id of the chain where assets are to be locked. The root of the funding tree for this channel.
- `participants` -- This should have length at least 2, but no more than 255, and include a public key (account) that you control. Each entry should be a nonzero ethereum address.
- `channelNonce` -- This should be different to any previous channelNonce used by the same `participants` and `chainId`. This is to prevent states from previous channels being "replayed" to conclude subsequent channels with unintended outcomes. Must be less than `2**48-1`.
- `appDefinition` -- There should be a [`ForceMoveApp`]('contract-api/natspec/ForceMove') compliant contract deployed at this address, and you should have confidence that it is not malicious or suffering from security flaws. You should inspect the source code (which should be publically available and verifiable) or appeal to a trusted authority to do this.
- `challengeDuration` -- In the extreme, this should be at least 1 block time (15 seconds on mainnet) and less than `2**48-1` seconds. Whatever it is set to, the channel should be closed long before `2**48 - 1 - challengeDuration`. In practice we recommend somewhere between 5 minutes and 5 months.

### Limits

There are also some limits to be aware of, which apply to the `VariablePart`. 

The constant `MAX_TX_DATA_SIZE` exported from `@statechannels/nitro-protocol` reflects the typical effective maximum size for ethereum transaction data. This is set by ethereum clients such as [geth](https://github.com/ethereum/go-ethereum). At the time of writing this is 128KB.

The constant `NITRO_MAX_GAS`, also exported, is an upper limit on the gas consumed by a transaction that we consider "safe" in the sense that it is below the block gas limit on mainnet and most testnets. At the time of writing this constant is set to 6M gas.

The exported constant `MAX_OUTCOME_ITEMS` denotes a safe upper limit on the number of allocationItems that may be stored in an [outcome](protocol-tutorial/outcomes#outcomes-that-allocate). We deem this number safe because the resulting transaction size is less than `MAX_TX_DATA_SIZE` and the transaction consumes less than `NITRO_MAX_GAS` (as confirmed by our test suite). This is for the `challenge` and `pushOutcome` transactions, with the other fields in the state set to modest values (e.g. 2 participants). If those fields grow, `MAX_OUTCOME_ITEMS` may no longer be safe.  At the time of writing this constant is set to 2000 allocation items.

Paying out tokens from a state channel is potentially one of the most expensive operations from a gas perspective (if the recipient does not have any already, the transaction will consume 20K gas per pay out). The same is true of channels paying out (ETH or tokens) to other channels on chain. Bear this in mind when deciding whether to transfer one, many-at-a-time or all-at-once of the tokens from a finalized channel outcome. `NITRO_MAX_GAS / 20000` would be a sensible choice. Remember to leave some headroom for the `transfer` method's intrinsic gas costs: our test suite confirms that at least 100 Token payouts are possible.

TLDR: stick to outcomes withe fewer than `MAX_OUTCOME_ITEMS` entries, and don't try to `transfer` many more than `NITRO_MAX_GAS` / 20000 tokens in one `transfer` transaction.

## Conform to an on chain `validTransition` function

In ForceMove, every state has an associated 'mover' - the participant who had the unique ability to progress the channel at the point the state was created. The mover can be calculated from the `turnNum` and the `participants` as follows:

```solidity
moverAddress = participants[turnNum % participants.length]
```

The implication of this formula is that participants take turns to update the state of the channel. Furthermore, there are strict rules about whether a state update is valid, based on the previous state that has been announced. Beyond conforming to the state format, there are certain relationships that must hold between the state in question, and the previously announced state.

The full rule set is (pseudo-code):

```solidity
function validTransition(a, b) <=>
  b.turnNum == a.turnNum + 1
  b.chainId == a.chainId
  b.participants == a.participants
  b.appDefinition == a.appDefinition
  b.challengeDuration == a.challengeDuration
  a.signer == a.mover
  b.signer == b.mover
  if b.isFinal
     b.defaultOutcome == a.defaultOutcome
  else if b.turnNum < 2n
     a.isFinal == False
     b.defaultOutcome == a.defaultOutcome
     b.appData == a.appData
   else
     a.isFinal == False
     b.app.validTransition(a, b)
```

### Application logic

Note the use of `app.ValidTransition`. This function should be written by third party DApp developers. We provide a `TrivialApp` contract which always returns `true`, to aid in testing:

```typescript
// In lesson2.test.ts

/* Construct a state */
const fromState: State = {
  channel,
  outcome: [],
  turnNum: 0,
  isFinal: false,
  challengeDuration: 86400, // 1 day
  appDefinition: process.env.TRIVIAL_APP_ADDRESS,
  appData: '0x00'
};

/* Construct another state */
const toState: State = {...fromState, turnNum: 1};

/* 
  Check validity of transition from one state to the other
  using on chain function
 */
expect(
  await NitroAdjudicator.validTransition(
    channel.participants.length,
    [fromState.isFinal, toState.isFinal],
    [getVariablePart(fromState), getVariablePart(toState)],
    toState.turnNum, // We only get to submit one turn number so cannot check validity
    // If incorrect, transactions will fail during a check on state signatures
    fromState.appDefinition
  )
).toBe(true);
```

### Setup states

If `n` is the number of participants, then states with turn numbers `0` through `n-1` (inclusive) are known as "pre fund setup" states. They signal each participant's intention to join the channel with a particular outcome specified.

Once a pre fund setup state with turn number `n-1` is supported, it is safe for the channel to be funded.

States with turn numbers `n` through `2n-1` (inclusive) are known as "post fund setup" states. They signal each participant's agreement that the channel is fully funded. Once a post fund setup state with turn number `2n-1` is supported, the state channel can begin execution in earnest (updating the `appData` and `outcome`).

## Support a state in several different ways

Although you can check the validity of a state transition by providing the data above to an on-chain method, to cause any meaningful change in on-chain state (such as releasing funds), digitial signatures on those states are also required.

Nitro protocol uses the idea of supporting a state: in order for the chain to accept a channel state, `s`, that channel state must be accompanied by a _support proof_: i.e. exactly `n` signatures (where `n = participants.length`). The simplest way to accomplish this is to provide a sequence of `n` states terminating is state `s`, where each state is signed by its mover and each consecutive pair of states form a valid transition.

There is also an optimization where a state can be supported by `n` signatures on a sequence of `m < n` states, provided again that each consecutive pair of those `m` states form a valid transition and further provided each participant has provided a signature on a state later or equal in the sequence than the state for which they were the mover.

In the extreme, this allows a single state signed by all `n` parties to be accepted by the chain.

:::note
In most cases where a support proof is required for some change of state of the chain, the entire proof is submitted with the blockchain transaction: no on-chain channel states are involved. The [`respond`](protocol-tutorial/clear-a-challenge#call-respond) method is an exception to this rule, and allows for the submission of only a single state in certain circumstances, with the support proof being implied by a combination of on-chain storage and submitted data.
:::

:::tip
Nitro wallets need only store the "last" `n` states, because they never need to submit more than `n` states to the chain.
:::

In the following diagram, A is participant 0, B is participant 1 and C is participant 2. The states are shown by circles and numbered 0, 1, and 2. We are considering whether state with `turnNum = 2` is supported by various sets of signatures on the states in the sequence.

The yellow boxes show who signed what: in the first example, everyone signed their own state. This _is_ acceptable:

<Mermaid chart='
graph LR;
subgraph A
zero((0))
end
subgraph B
one((1))
end
subgraph C
two((2))
end
zero-->one;
one-->two;
' />

Alternatively, A could sign a later state in the sequence:

<Mermaid chart='
graph LR;
subgraph " "
zero((0))
end
subgraph "A, B"
one((1))
end
subgraph C
two((2))
end
zero-->one;
one-->two;
' />

or A, B and C could all sign the final state in the sequence:

<Mermaid chart='
graph LR;
subgraph " "
zero((0))
end
subgraph " "
one((1))
end
subgraph "A, B, C"
two((2))
end
zero-->one;
one-->two;
' />

The following signatures would _not_ be acceptable:

<Mermaid chart='
graph LR;
subgraph " "
zero((0))
end
subgraph "B, C"
one((1))
end
subgraph A
two((2))
end
zero-->one;
one-->two;
' />

This is because C signed a state _earlier_ in the sequence than the one she is the mover for.

:::tip
Note that there is no need to submit a state if it is _both_ not signed by anybody _and_ is not preceeded by any signed states.
:::

We provide a helper function to sign a `State`:

```typescript
import {signState} from '@statechannels/nitro-protocol';

const wallet = Wallet.createRandom();
const state: State = {
  channel: {chainId: '0x1', channelNonce: 1, participants: [wallet.address]},
  outcome: [],
  turnNum: 1,
  isFinal: false,
  appData: '0x00',
  appDefinition: AddressZero,
  challengeDuration: 86400 // 1 day
};

const signedState: SignedState = signState(state, wallet.privateKey);
```

it returns an object of the `SignedState` type:

```typescript
import {Signature} from '@statechannels/nitro-protocol';
export interface SignedState {
  state: State;
  signature: Signature;
}
```

which we can make use of in the rest of the tutorial.

Alternatively you may use `signStates(states, wallets, whoSignedWhat)`,
which accepts an array of `States`, an array of ethers.js `Wallets` and a `whoSignedWhat` array of integers. The implicit definition of this last argument is as follows: For each participant, we are asserting that `participant[i]` signed `states[whoSignedWhat[i]]`:

```typescript
// In lesson3.test.ts

/* Construct an array of 3 States */
const numStates = 3;
const largestTurnNum = 2;
const states: State[] = [];
for (let i = 1; i <= numStates; i++) {
  states.push({
    isFinal: false,
    channel,
    outcome: [],
    appDefinition: AddressZero,
    appData: HashZero,
    challengeDuration: 86400, // 1 day
    turnNum: largestTurnNum + i - numStates
  });
}

/* Sign the states */
const whoSignedWhat = [0, 1, 2];
const sigs = await signStates(states, wallets, whoSignedWhat);

/*
 * Use the checkpoint method to test our signatures
 * Tx will revert if they are incorrect
 */
const fixedPart = getFixedPart(states[0]);
const variableParts = states.map(s => getVariablePart(s));
const isFinalCount = states.filter(s => s.isFinal).length;

const tx = NitroAdjudicator.checkpoint(
  fixedPart,
  largestTurnNum,
  variableParts,
  isFinalCount,
  sigs,
  whoSignedWhat
);
await(await tx).wait();
```
