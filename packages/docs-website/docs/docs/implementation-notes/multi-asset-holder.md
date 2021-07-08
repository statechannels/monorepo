---
id: multi-asset-holder
title: MultiAssetHolder.sol
---

The multi-asset-holder contract describes how ETH and/or tokens are held on-chain for any given channel, and how to interpret the channel outcomes in order to determine and execute any payouts that are due.

MultiAssetHolder.sol is a base contract that it is not actually deployed. It is inherited by NitroAdjudicator (which is deployed).

In Nitro a payout is of one of two types: it is either a payout to a channel participant or it is a payout to another channel. It is this second type of payout that allows channels to fund one another in Nitro, enabling the virtual channels that are used to build state channel networks.

---

## Outcomes

ForceMove specifies that a state should have a default `outcome` but does not specify the format of that `outcome`, and simply treats it as an unstructured `bytes` field. In this section we look at the outcome formats needed for Nitro.

Nitro supports multiple different assets (e.g. ETH and one or more ERC20s) being held in the same channel.

The adjudicator stores (the hash of) an encoded `outcome` for each finalized channel. A decoded `outcome` is an array of `OutcomeItems`. These individual `OutcomeItems` contain the address of the asset contract in question (or `0x0` to indicate ETH), as well as some `bytes` that encode an `AssetOutcome`. This data structure contains some more `bytes` encoding either an allocation or a guarantee, as well as the `AssetOutcomeType`: an integer which indicates which.

In `Outcome.sol`:

```solidity
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

library Outcome {
  // An outcome is an array of OutcomeItems
  // Outcome = OutcomeItem[]
  // OutcomeItem = (asset, AssetOutcome)
  // AssetOutcome = (AssetOutcomeType, Allocation | Guarantee)
  // Allocation = AllocationItem[]
  // AllocationItem = (Destination, Amount)
  // Guarantee = (ChannelId, Destination[])
  // Destination = ChannelId | ExternalDestination

  struct OutcomeItem {
    address asset;
    bytes assetOutcomeBytes; // abi.encode(AssetOutcome)
  }

  enum AssetOutcomeType {Allocation, Guarantee}

  struct AssetOutcome {
    uint8 assetOutcomeType; // AssetOutcomeType.Allocation or AssetOutcomeType.Guarantee
    bytes allocationOrGuaranteeBytes; // abi.encode(AllocationItem[]) or abi.encode(Guarantee), depending on OutcomeType
  }

  // reserve Allocation to refer to AllocationItem[]
  struct AllocationItem {
    bytes32 destination;
    uint256 amount;
  }

  struct Guarantee {
    bytes32 targetChannelId;
    bytes32[] destinations;
  }
}

```

### Destinations

A `Destination` is a `bytes32` and represents either:

1. A `ChannelId` (see the section on [channelId](./force-move#channelid)), or
2. An `ExternalDestination`, which is an ethereum address left-padded with zeros.

:::tip
In JavaScript, the `ExternalDestination` corresponding to `address` may be computed as

```
'0x' + address.padStart(64, '0')
```

:::

---

## `deposit`

The deposit method allows ETH or ERC20 tokens to be escrowed against a channel.

Call signature:

```solidity
function deposit(address asset, bytes32 destination, uint256 expectedHeld, uint256 amount) external payable
```

Checks:

- `destination` must NOT be an [external destination](#destinations).
- The holdings for `destination` must be greater than or equal to `expectedHeld`.
- The holdings for `destination` must be less than the sum of the amount expected to be held and the amount declared in the deposit.

### ETH checks

The transaction must be accompanied by exactly `amount` wei.

### ERC20 checks

This contract must be able to successfully call `transferFrom` on that ERC20 Token contract, with the Token account being `msg.sender` with a sufficient number of tokens specified.

```solidity
// ...
  IERC20 Token;
//...
}

contract IERC20 {
    // Abstraction of the parts of the ERC20 Interface that we need
    function transfer(address to, uint256 tokens) public returns (bool success);
    function transferFrom(address from, address to, uint256 tokens) public returns (bool success);
}

```

Effects:

Increase holdings for `destination` to the sum of the amount expected to be held and the amount declared in the deposit.

Emit a `Deposited` event with `indexed` parameter `destination`.

:::warning
You may only deposit to a channel address. This is currently enforced at the contract level, but this may change in future. Do not attempt to deposit into external destinations.
:::

:::caution
Depositing ahead of other participants who have higher precedence in the initial outcome is not safe (they can steal your funds). Always ensure that the channel is funded, up to and including all participants with higher precedence, before making a deposit.
:::
