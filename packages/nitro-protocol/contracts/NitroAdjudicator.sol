// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import './ForceMove.sol';
import './Outcome.sol';
import './MultiAssetHolder.sol';

/**
 * @dev The NitroAdjudicator contract extends MultiAssetHolder and hence inherits all MultiAssetHolder methods.
 */
contract NitroAdjudicator is MultiAssetHolder {
    /**
     * @notice Finalizes a channel by providing a finalization proof, and liquidates all assets for the channel.
     * @dev Finalizes a channel by providing a finalization proof, and liquidates all assets for the channel.
     * @param largestTurnNum The largest turn number of the submitted states; will overwrite the stored value of `turnNumRecord`.
     * @param fixedPart Data describing properties of the state channel that do not change with state updates.
     * @param appPartHash The keccak256 of the abi.encode of `(challengeDuration, appDefinition, appData)`. Applies to all states in the finalization proof.
     * @param outcomeBytes abi.encode of an array of Outcome.OutcomeItem structs.
     * @param numStates The number of states in the finalization proof.
     * @param whoSignedWhat An array denoting which participant has signed which state: `participant[i]` signed the state with index `whoSignedWhat[i]`.
     * @param sigs An array of signatures that support the state with the `largestTurnNum`.
     */
    function concludeAndTransferAllAssets(
        uint48 largestTurnNum,
        FixedPart memory fixedPart,
        bytes32 appPartHash,
        bytes memory outcomeBytes,
        uint8 numStates,
        uint8[] memory whoSignedWhat,
        Signature[] memory sigs
    ) public {
        bytes32 outcomeHash = keccak256(outcomeBytes);
        bytes32 channelId = _conclude(
            largestTurnNum,
            fixedPart,
            appPartHash,
            outcomeHash,
            numStates,
            whoSignedWhat,
            sigs
        );

        transferAllAssets(channelId, outcomeBytes, bytes32(0), address(0));
    }

    /**
     * @notice Liquidates all assets for the channel
     * @dev Liquidates all assets for the channel
     * @param channelId Unique identifier for a state channel
     * @param outcomeBytes abi.encode of an array of Outcome.OutcomeItem structs.
     * @param stateHash stored state hash for the channel
     * @param challengerAddress stored challenger address for the channel
     */
    function transferAllAssets(
        bytes32 channelId,
        bytes memory outcomeBytes,
        bytes32 stateHash,
        address challengerAddress
    ) public {
        // checks
        _requireChannelFinalized(channelId);
        _requireMatchingFingerprint(
            stateHash,
            challengerAddress,
            keccak256(outcomeBytes),
            channelId
        );
        Outcome.OutcomeItem[] memory outcome = abi.decode(outcomeBytes, (Outcome.OutcomeItem[]));

        for (uint256 assetIndex = 0; assetIndex < outcome.length; assetIndex++) {
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[assetIndex].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );
            require(
                assetOutcome.assetOutcomeType == Outcome.AssetOutcomeType.Allocation,
                '!allocation'
            );
            Outcome.AllocationItem[] memory allocation = abi.decode(
                assetOutcome.allocationOrGuaranteeBytes,
                (Outcome.AllocationItem[])
            );
            address asset = outcome[assetIndex].asset;
            uint256 initialHoldings;
            (allocation, initialHoldings) = _transfer(
                asset,
                channelId,
                allocation,
                new uint256[](0)
            ); // update in place to newAllocation
            outcome[assetIndex].assetOutcomeBytes = abi.encode(
                Outcome.AssetOutcome(Outcome.AssetOutcomeType.Allocation, abi.encode(allocation))
            );
            emit AllocationUpdated(channelId, assetIndex, initialHoldings);
        }
        outcomeBytes = abi.encode(outcome);
        bytes32 outcomeHash = keccak256(outcomeBytes);
        _updateFingerprint(channelId, stateHash, challengerAddress, outcomeHash);
    }

    /**
    * @notice Check that the submitted pair of states form a valid transition (public wrapper for internal function _requireValidTransition)
    * @dev Check that the submitted pair of states form a valid transition (public wrapper for internal function _requireValidTransition)
    * @param nParticipants Number of participants in the channel.
    transition
    * @param isFinalAB Pair of booleans denoting whether the first and second state (resp.) are final.
    * @param ab Variable parts of each of the pair of states
    * @param turnNumB turnNum of the later state of the pair.
    * @param appDefinition Address of deployed contract containing application-specific validTransition function.
    * @return true if the later state is a validTransition from its predecessor, reverts otherwise.
    */
    function validTransition(
        uint256 nParticipants,
        bool[2] memory isFinalAB, // [a.isFinal, b.isFinal]
        IForceMoveApp.VariablePart[2] memory ab, // [a,b]
        uint48 turnNumB,
        address appDefinition
    ) public pure returns (bool) {
        return _requireValidTransition(nParticipants, isFinalAB, ab, turnNumB, appDefinition);
    }
}
