<h1 align="center">
<div><img src="website/static/img/favicon.ico"> </div>
Nitro Protocol
</h1>
This repository contains the smart contracts that define a state channel framework capable of running 3rd-party
'applications' that conform to a simple state-machine interface, and allow for large-scale state-channel networks. There is also a documentation website and helper functions written in TypeScript.

# ForceMove

The ForceMove framework takes a pragmatic approach to state channels directly funded by on-chain deposits: sacrificing generality of the supported applications,
for simplicity in the on-chain and off-chain logic. In particular, the framework can't (yet) support
any applications that have state transitions whose validity depends on time, or other properties
that are external to the channel's state. For example, as it currently stands, you couldn't build
a state channel sports betting game, where bets have to be made by a deadline and the winner
is determined through an oracle feed.

A full description of the framework and it's capabilities can be found in the [whitepaper](https://magmo.com/force-move-games.pdf).

# Nitro and the nitro-adjudicator

Nitro protocol subsumes and extends ForceMove by allowing for ledger channels (which can allocate funds to other state channels) and virtual channels (which allow intermediaries to help other state-channel-network users open and close channels off-chain).

A full description of the framework and it's capabilities can be found in a second [whitepaper](https://eprint.iacr.org/2019/219).

The nitro-adjudicator supports an arbitrary number of state channels, and introduces new on-chain functions to manage state channel networks.

### Development

We use [etherlime](https://etherlime.gitbook.io/) for smart contract development.

To get started:

1. Download the repo and `cd` into the directory.
2. Run `yarn install`.
3. Run `yarn startGanache`.
4. Run `yarn test`.

## Documentation website

1. Run `cd website`
2. Run `yarn install`
3. Run `yarn start`

See https://docusaurus.io/docs/en/installation for more information.
