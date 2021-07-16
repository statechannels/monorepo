# Ninja Nitro

Ninja-Nitro is an alternative implementation of Nitro protocol, with a different contract architecture to the main implementation (henceforth Vanilla-Nitro\*) in this package. The additional files should all have namespaced paths.

\*this is just a temporary name.

## Overview

### Recap of Vanilla-Nitro

The main implementation has 1 x monolithic `Adjudicator` contract and m x `AssetHolder` contracts (one for each of the m Assets in the state channel network). The `Adjudicator` API is

- The ForceMove API
- `pushOutcome`
- utility methods that just batch up this API and the `AssetHolder` API (`pushOutcomeAndTransferAll` and `concludePushOutcomeAndTransferAll`)

The essence of the architecture, then, is `pushOutcome`: a finalized outcome must be "pushed" from the `Adjudicator`, resulting in a piece of that outcome being stored in each `AssetHolder`. Nevertheless, `pushOutcome` is an implementation detail and not necessary part of the overall Nitro API.

The `AssetHolder` API is:

- `transfer`
- `claim`
- permissioned methods `transferAllAdjudicatorOnly` and `setAssetOutcomeHash` only callable from the `Adjudicator`.

After a `pushOutcome` assets may be released by targetting each `AssetHolder` and calling `claim` or `transfer` (which _are_ essential parts of the overall Nitro API). This is the unhappy path. The happy path will shortcut `pushOutcome` and use the permissioned methods.

### Ninja-Nitro

Ninja-Nitro, by contrast has 1 x `AdjudicatorFactory` contract, 1 x `SingleChannelAdjudicator` master contract, and k x `Proxy` contracts, one for each of the k channels in the network that resolves on chain. The factory and master contracts are "infastructure" and deployed once (i.e. by us).

The `AdjudicatorFactory` API is

- `createChannel`
- utility methods that batch `createChannel` with the master contract API.

The `createChannel` method will deploy a new `Proxy` for each channel as necessary (namely, if it needs to be directly defunded). Such `Proxy` contracts are lightweight (cheap to deploy), have easily predictable addresses, and point to the `SingleChannelAdjudicator` master contract. They therefore have the same API:

- The ForceMove API
- `transfer`
- `claim`
- utility methods that batch up this API

Note however, that the Proxy contracts each have their own storage. See https://eips.ethereum.org/EIPS/eip-1167.

## Similarities and differences

### Holdings

The Vanilla-Nitro system has m x `holdings` mappings, one in each AssetHolder. This mapping is `public`, so has a public getter function.
Ninja-Nitro has no such mappings: but a public `holdings` function remains. This functions simply i) reads the eth balance of the current contract using the Ethereum accounting system or ii) reads the token balance from a given ERC20 Token contract

### Deposits

In Vanilla-Nitro, depositing requires calling a method on each `AssetHolder`.
In Ninja-Nitro, depositing can be achieved simply by sending funds or tokens to the address of the `Proxy`, and this can even be done before the `Proxy` is created/deployed. It can also be done after the `Proxy` is destroyed -- self destructing the adjudicator when the channel is finished is one way to save some gas.

### Adjudicator status

Ninja-Nitro was implemented by modifying a copy of Vanilla-Nitro. This means that certain quirks remain in the implementation which would probably not exist had it been written from scratch. These quirks may or may not be removed in future.

One such quirk is as follows. In Vanilla-Nitro, the hash of the status of a channel (which includes the full outcome, the address of any challenger, the time when the channel will finalize, etc) is stored in a mapping, keyed by the `channelId`.

In Ninja-Nitro, exactly the same is true: only each proxy has its own mapping. The reason that this is quirky is that each of these mappings is only ever going to have a single entry, because each proxy is in a 1-1 relation to a `channelId`. The reason that this quirk is not actually very troublesome are:

- the gas cost are not dramatically higher than storing a single hash without using a mapping (investigations suggest around 100 gas difference). See https://docs.soliditylang.org/en/v0.8.3/types.html?highlight=mapping#mapping-types
- we are able to reuse `ForceMove` (in the sense of `SingleChannelAdjudicator is ForceMove`) in its entirety without modifying it at all

> A future optimization might be to replace the mapping with a regular, singleton storage variable. This would require a small but breaking change to `ForceMove.sol`.

### External destinations

In Vanilla-Nitro, funds for channels are tracked _internally_, while funds for any Ethereum address (e.g. an externally owned account) are typically paid out of the system when defunding a channel. Padding an Ethereum address with enough zeros results in a 32 byte number which we call an external destination. Channel ids are known as internal destinations.

In Ninja-Nitro, funds are always tracked externally. This is possible since (up to hash collisions) each channel now has a unique Ethereum address. Funds are therefore always paid _out_ of a `Proxy` contract after a `transfer` or `claim`. There is therefore no such thing as an internal destination in Ninja-Nitro. Everything is external.

To maintain compatibility with the off-chain code we already have for Vanilla-Nitro, the Ninja-Nitro implementation converts destinations to addresses in the following way:

- if the destination is a padded Ethereum address, slice off the Ethereum address and use that
- if the destination is not a padded Ethereum address, compute the create2 address of that channel and use that

> A future optimization might be to do away with the 32 byte destination concept altogether. Destinations would then always be Ethereum addresses, and trying to allocate funds to a 32 byte destination would raise an exception.

## Gas tradeoffs

| Operation                                                      | Vanilla | Ninja |
| -------------------------------------------------------------- | ------- | ----- |
| infastructure deployment                                       | 4.3M    | 5.1M  |
| directly-funded unidirectional payment channel (happy path)    | 212K    | 167K  |
| directly-funded unidirectional payment channel (unhappy path)  | ?       | ?     |
| ledger-funded unidirectional payment channel (unhappy path)    | ?       | ?     |
| virtually-funded unidirectional payment channel (unhappy path) | ?       | ?     |

Unidirectional payment channel: only one deposit and one payout
The unhappy path: all channels in the funding tree are finalized on chain via `challenge` and timeout, and the funds are then transferred and claimed until they are all liquidated.
