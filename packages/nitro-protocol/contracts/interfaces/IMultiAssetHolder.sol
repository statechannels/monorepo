// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '../Outcome.sol';

/**
 * @dev The IMultiAssetHolder interface calls for functions that allow assets to be transferred from one channel to other channel and/or external destinations, as well as for guarantees to be claimed.
 */
interface IMultiAssetHolder {
    /**
     * @notice Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @dev Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @param assetIndex The index of the asset to be paid out (in the outcome)
     * @param fromChannelId Unique identifier for state channel to transfer funds *from*.
     * @param outcomeBytes The abi.encode of AssetOutcome.Allocation
     * @param stateHash the hash of the state stored on chain
     * @param challengerAddress the challengerAddress stored on chain
     * @param indices Array with each entry denoting the index of a destination to transfer funds to.
     */
    function transfer(
        uint256 assetIndex,
        bytes32 fromChannelId,
        bytes calldata outcomeBytes,
        bytes32 stateHash,
        address challengerAddress,
        uint256[] memory indices
    ) external;

    /**
     * @notice Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel. Checks against the storage in this contract.
     * @dev Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel. Checks against the storage in this contract.
     * @param assetIndex The index of the asset to be paid out (in the outcome)
     * @param guarantorChannelId Unique identifier for a guarantor state channel.
     * @param guarantorOutcomeBytes The abi.encode of the guarantor outcome.
     * @param guarantorStateHash the hash of the state stored on chain for the guarantor
     * @param guarantorChallengerAddress the challengerAddress stored on chain for the guarantor channel
     * @param targetOutcomeBytes The abi.encode of the guarantor outcome.
     * @param targetStateHash the hash of the state stored on chain for the guarantor
     * @param targetChallengerAddress the challengerAddress stored on chain for the guarantor channel
     * @param indices Array with each entry denoting the index of a destination (in the target channel) to transfer funds to. Should be in increasing order. An empty array indicates "all".
     */
    function claim(
        uint256 assetIndex,
        bytes32 guarantorChannelId,
        bytes memory guarantorOutcomeBytes,
        bytes32 guarantorStateHash,
        address guarantorChallengerAddress,
        bytes memory targetOutcomeBytes,
        bytes32 targetStateHash,
        address targetChallengerAddress,
        uint256[] memory indices
    ) external;

    /**
     * @notice Deposit ETH against a given destination.
     * @dev Deposit ETH against a given destination.
     * @param asset erc20 token address, or zero address to indicate ETH
     * @param destination ChannelId to be credited.
     * @param expectedHeld The number of wei the depositor believes are _already_ escrowed against the channelId.
     * @param amount The intended number of wei to be deposited.
     */
    function deposit(
        address asset,
        bytes32 destination,
        uint256 expectedHeld,
        uint256 amount
    ) external payable;

    /**
     * @dev Indicates that `amountDeposited` has been deposited into `destination`.
     * @param destination The channel being deposited into.
     * @param amountDeposited The amount being deposited.
     * @param destinationHoldings The new holdings for `destination`.
     */
    event Deposited(
        bytes32 indexed destination,
        address asset,
        uint256 amountDeposited,
        uint256 destinationHoldings
    );

    /**
     * @dev Indicates the fingerprint for this channelId has changed due to a transfer or claim. Includes sufficient data to compute:
     * - the preimage of this hash as well as
     * - the new holdings for this channelId and any others that were transferred to
     * - the payouts to external destinations
     * @param channelId The channelId of the funds being withdrawn.
     * @param outcomeBytes The (encoded) new outcome hashed into the fingerprint
     */
    event FingerprintUpdated(bytes32 indexed channelId, bytes outcomeBytes);
}
