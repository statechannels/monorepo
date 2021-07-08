// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

library Outcome {
    //An outcome is an array of OutcomeItems
    // Outcome = OutcomeItem[]
    // OutcomeItem = (asset, AssetOutcome)
    // AssetOutcome = (AssetOutcomeType, Allocation | Guarantee)
    // Allocation = AllocationItem[]
    // AllocationItem = (Destination, Amount)
    // Guarantee = (ChannelAddress, Destination[])
    // Destination = ChannelAddress | ExternalDestination

    struct OutcomeItem {
        address asset;
        bytes assetOutcomeBytes; // abi.encode(AssetOutcome)
    }

    enum AssetOutcomeType {Allocation, Guarantee}

    struct AssetOutcome {
        AssetOutcomeType assetOutcomeType;
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
