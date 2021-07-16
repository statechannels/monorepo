// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '../interfaces/IAssetHolder.sol';
import '../ForceMove.sol';
import '../Outcome.sol';
import './AdjudicatorFactory.sol';
import './OutcomeTransformations.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract SingleChannelAdjudicator is ForceMove, OutcomeTransformations {
    address public immutable adjudicatorFactoryAddress;

    constructor(address a) {
        adjudicatorFactoryAddress = a;
    }

    receive() external payable {} // solhint-disable-line no-empty-blocks

    struct ChannelDataAlt {
        uint48 turnNumRecord;
        uint48 finalizesAt;
        bytes32 stateHash; // keccak256(abi.encode(State))
        address challengerAddress;
        bytes outcomeBytes;
    }

    /**
     * @notice Verifies a conclusion proof, pays out all assets and selfdestructs
     * @dev Verifies a conclusion proof, pays out all assets and selfdestructs
     * @param largestTurnNum The largest turn number of the submitted states; will overwrite the stored value of `turnNumRecord`.
     * @param fixedPart Data describing properties of the state channel that do not change with state updates.
     * @param appPartHash The keccak256 of the abi.encode of `(challengeDuration, appDefinition, appData)`. Applies to all states in the finalization proof.
     * @param outcomeBytes abi.encode of an array of Outcome.OutcomeItem structs.
     * @param numStates The number of states in the finalization proof.
     * @param whoSignedWhat An array denoting which participant has signed which state: `participant[i]` signed the state with index `whoSignedWhat[i]`.
     * @param sigs An array of signatures that support the state with the `largestTurnNum`.
     */
    function concludeAndTransferAll(
        uint48 largestTurnNum,
        FixedPart memory fixedPart,
        bytes32 appPartHash,
        bytes memory outcomeBytes,
        uint8 numStates,
        uint8[] memory whoSignedWhat,
        Signature[] memory sigs
    ) public {
        bytes32 outcomeHash = keccak256(outcomeBytes);
        _ninjaConclude(
            largestTurnNum,
            fixedPart,
            appPartHash,
            outcomeHash,
            numStates,
            whoSignedWhat,
            sigs
        );
        _transferAllAssets(abi.decode(outcomeBytes, (Outcome.OutcomeItem[])));
        selfdestruct(address(0));
    }

    /**
     * @notice Pays out all allocations for all assets in the supplied outcome
     * @dev Pays out all allocations for all assets in the supplied outcome
     * @param outcome An array of Outcome.OutcomeItem structs.
     */
    function _transferAllAssets(Outcome.OutcomeItem[] memory outcome) internal {
        // loop over tokens
        for (uint256 i = 0; i < outcome.length; i++) {
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[i].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );

            if (assetOutcome.assetOutcomeType == uint8(Outcome.AssetOutcomeType.Allocation)) {
                Outcome.AllocationItem[] memory allocation = abi.decode(
                    assetOutcome.allocationOrGuaranteeBytes,
                    (Outcome.AllocationItem[])
                );

                // loop over payouts for this token
                for (uint256 j = 0; j < allocation.length; j++) {
                    _transferAsset(
                        outcome[i].assetHolderAddress,
                        allocation[j].destination,
                        allocation[j].amount
                    );
                }
            } else {
                revert('AssetOutcome not an allocation');
            }
        }
    }

    /**
     * @notice Finalizes a channel by providing a finalization proof. Internal method. Does not touch storage.
     * @dev Finalizes a channel by providing a finalization proof. Internal method. Does not touch storage.
     * @param largestTurnNum The largest turn number of the submitted states; will overwrite the stored value of `turnNumRecord`.
     * @param fixedPart Data describing properties of the state channel that do not change with state updates.
     * @param appPartHash The keccak256 of the abi.encode of `(challengeDuration, appDefinition, appData)`. Applies to all states in the finalization proof.
     * @param outcomeHash The keccak256 of the `outcome`. Applies to all stats in the finalization proof.
     * @param numStates The number of states in the finalization proof.
     * @param whoSignedWhat An array denoting which participant has signed which state: `participant[i]` signed the state with index `whoSignedWhat[i]`.
     * @param sigs An array of signatures that support the state with the `largestTurnNum`.
     */
    function _ninjaConclude(
        uint48 largestTurnNum,
        FixedPart memory fixedPart,
        bytes32 appPartHash,
        bytes32 outcomeHash,
        uint8 numStates,
        uint8[] memory whoSignedWhat,
        Signature[] memory sigs
    ) internal returns (bytes32 channelId) {
        channelId = _getChannelId(fixedPart);
        _requireChannelIdMatchesContract(channelId);
        _requireChannelNotFinalized(channelId);

        // input type validation
        requireValidInput(
            fixedPart.participants.length,
            numStates,
            sigs.length,
            whoSignedWhat.length
        );

        require(largestTurnNum + 1 >= numStates, 'largestTurnNum too low');
        // ^^ SW-C101: prevent underflow

        // By construction, the following states form a valid transition
        bytes32[] memory stateHashes = new bytes32[](numStates);
        for (uint48 i = 0; i < numStates; i++) {
            stateHashes[i] = keccak256(
                abi.encode(
                    State(
                        largestTurnNum + (i + 1) - numStates, // turnNum
                        // ^^ SW-C101: It is not easy to use SafeMath here, since we are not using uint256s
                        // Instead, we are protected by the require statement above
                        true, // isFinal
                        channelId,
                        appPartHash,
                        outcomeHash
                    )
                )
            );
        }

        // checks
        require(
            _validSignatures(
                largestTurnNum,
                fixedPart.participants,
                stateHashes,
                sigs,
                whoSignedWhat
            ),
            'Invalid signatures / !isFinal'
        );

        // effects

        emit Concluded(channelId, uint48(block.timestamp)); //solhint-disable-line not-rely-on-time
    }

    /**
     * @notice Checks if a given destination is external (i.e. simply a padded Ethereum addtess), or a channelId (which has a corresponding create2 address)
     * @dev Checks if a given destination is external (i.e. simply a padded Ethereum addtess), or a channelId (which has a corresponding create2 address)
     * @param destination Destination to be checked.
     * @return True if the destination is external, false otherwise.
     */
    function _isExternalDestination(bytes32 destination) internal pure returns (bool) {
        return uint96(bytes12(destination)) == 0;
    }

    /**
     * @notice Converts a nitro destination to an ethereum address.
     * @dev Converts a nitro destination to an ethereum address.
     * @param destination The destination to be converted.
     * @return The rightmost 160 bits of the input string.
     */
    function _bytes32ToAddress(bytes32 destination) internal pure returns (address payable) {
        return payable(uint160(uint256(destination)));
    }

    function _requireChannelIdMatchesContract(bytes32 channelId) internal view {
        // the placeholderFactory will be replaced with the address of the real AdjudicatorFactory
        // at deploy time (it will be linked).
        require(
            AdjudicatorFactory(adjudicatorFactoryAddress).getChannelAddress(channelId) ==
                address(this),
            'Wrong channelId'
        );
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

    // ASSET HOLDING PART

    /**
     * @notice Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @dev Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @param fromChannelId Unique identifier for state channel to transfer funds *from*.
     * @param outcomeBytes The abi.encode of AssetOutcome.Allocation
     * @param indices Array with each entry denoting the index of a destination to transfer funds to. An empty array indicates "all".
     */
    function transfer(
        bytes32 fromChannelId,
        uint48 turnNumRecord,
        uint48 finalizesAt,
        bytes32 stateHash,
        address challengerAddress,
        bytes calldata outcomeBytes,
        uint256[] memory indices
    ) external {
        // checks
        _requireIncreasingIndices(indices);

        bytes32 outcomeHash = keccak256(outcomeBytes);
        _requireMatchingStorage(
            ChannelData(turnNumRecord, finalizesAt, stateHash, challengerAddress, outcomeHash),
            fromChannelId
        );

        // effects and interactions

        // loop over tokens
        Outcome.OutcomeItem[] memory outcome = abi.decode(outcomeBytes, (Outcome.OutcomeItem[]));

        for (uint256 i = 0; i < outcome.length; i++) {
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[i].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );

            if (assetOutcome.assetOutcomeType == uint8(Outcome.AssetOutcomeType.Allocation)) {
                assetOutcome.allocationOrGuaranteeBytes = abi.encode(
                    _transfer(
                        outcome[i].assetHolderAddress,
                        assetOutcome.allocationOrGuaranteeBytes,
                        indices
                    )
                );
                outcome[i] = Outcome.OutcomeItem(
                    outcome[i].assetHolderAddress,
                    abi.encode(assetOutcome)
                );
            } else {
                revert('AssetOutcome not an allocation');
            }
        }

        statusOf[fromChannelId] = _generateStatus(
            ChannelData(
                turnNumRecord,
                finalizesAt,
                stateHash,
                challengerAddress,
                keccak256(abi.encode(outcome))
            )
        );
    }

    /**
     * @notice Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries. Does not check allocationBytes against on chain storage.
     * @dev Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries. Does not check allocationBytes against on chain storage.
     * @param allocationBytes The abi.encode of AssetOutcome.Allocation
     * @param indices Array with each entry denoting the index of a destination to transfer funds to. Should be in increasing order. An empty array indicates "all".
     */
    function _transfer(
        address assetHolderAddress,
        bytes memory allocationBytes,
        uint256[] memory indices
    ) internal returns (Outcome.AllocationItem[] memory) {
        Outcome.AllocationItem[] memory allocation = abi.decode(
            allocationBytes,
            (Outcome.AllocationItem[])
        );
        uint256 initialHoldings = _holdings(assetHolderAddress);

        (
            Outcome.AllocationItem[] memory newAllocation,
            ,
            uint256[] memory payouts,

        ) = _computeNewAllocation(initialHoldings, allocation, indices);

        // *******
        // EFFECTS
        // *******

        // *******
        // INTERACTIONS
        // *******

        for (uint256 j = 0; j < payouts.length; j++) {
            if (payouts[j] > 0) {
                bytes32 destination = allocation[indices.length > 0 ? indices[j] : j].destination;
                // storage updated BEFORE external contracts called (prevent reentrancy attacks)
                _transferAsset(assetHolderAddress, destination, payouts[j]);
            }
        }
        // emit AllocationUpdated(fromChannelId, initialHoldings); // TODO emit an OutcomeUpdated event
        return newAllocation;
    }

    /**
     * @notice Pays out assets according to the supplied payouts, only if this channel has been finalized as a guarantor channel, and only if supplied by the __target__ of this channel
     */
    function payOutTarget(
        bytes32 guarantorChannelId,
        ChannelDataAlt calldata channelDataAlt,
        Outcome.OutcomeItem[] memory payouts
    ) external {
        Outcome.OutcomeItem[] memory guarantorOutcome = abi.decode(
            channelDataAlt.outcomeBytes,
            (Outcome.OutcomeItem[])
        );
        Outcome.AssetOutcome memory gAssetOutcome = abi.decode(
            guarantorOutcome[0].assetOutcomeBytes, // The target channel contract has already checked that all entires have the same target
            (Outcome.AssetOutcome)
        );
        Outcome.Guarantee memory guarantee = abi.decode(
            gAssetOutcome.allocationOrGuaranteeBytes,
            (Outcome.Guarantee)
        );
        address targetChannelAddress = AdjudicatorFactory(adjudicatorFactoryAddress)
            .getChannelAddress(guarantee.targetChannelId);
        require(msg.sender == targetChannelAddress, 'only the target channel is auth');
        bytes32 outcomeHash = keccak256(channelDataAlt.outcomeBytes);
        _requireMatchingStorage(
            ChannelData(
                channelDataAlt.turnNumRecord,
                channelDataAlt.finalizesAt,
                channelDataAlt.stateHash,
                channelDataAlt.challengerAddress,
                outcomeHash
            ),
            guarantorChannelId
        );
        _transferAllAssets(payouts);
    }

    /**
     * @notice Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel. Checks against the storage in this contract.
     */
    function claim(
        bytes32 guarantorChannelId,
        bytes32 targetChannelId,
        ChannelDataAlt calldata guaranteeCDL,
        ChannelDataAlt calldata targetCDL,
        uint256[][] memory indices
    ) external {
        // CHECKS
        for (uint256 i = 0; i < indices.length; i++) {
            _requireIncreasingIndices(indices[i]);
        }
        Outcome.OutcomeItem[] memory guarantorOutcome = abi.decode(
            guaranteeCDL.outcomeBytes,
            (Outcome.OutcomeItem[])
        );
        AdjudicatorFactory adjudicatorFactory = AdjudicatorFactory(adjudicatorFactoryAddress);
        address payable guarantor = adjudicatorFactory.getChannelAddress(guarantorChannelId);
        address targetChannelAddress = adjudicatorFactory.getChannelAddress(targetChannelId);
        require(address(this) == targetChannelAddress, 'incorrect target channel address');
        _requireMatchingStorage(
            ChannelData(
                targetCDL.turnNumRecord,
                targetCDL.finalizesAt,
                targetCDL.stateHash,
                targetCDL.challengerAddress,
                keccak256(targetCDL.outcomeBytes)
            ),
            targetChannelId
        );
        // COMPUTATIONS
        Outcome.OutcomeItem[] memory outcome = abi.decode(
            targetCDL.outcomeBytes,
            (Outcome.OutcomeItem[])
        );
        uint256[] memory initialHoldings = new uint256[](outcome.length);
        for (uint256 i = 0; i < outcome.length; i++) {
            initialHoldings[i] = _holdings(guarantor, outcome[i].assetHolderAddress);
        }
        (
            Outcome.OutcomeItem[] memory newOutcome,
            Outcome.OutcomeItem[] memory payOuts
        ) = _computeNewOutcomeAfterClaim(
            initialHoldings,
            outcome,
            targetChannelId,
            indices,
            guarantorOutcome
        );
        // EFFECTS

        statusOf[targetChannelId] = _generateStatus(
            ChannelData(
                targetCDL.turnNumRecord,
                targetCDL.finalizesAt,
                targetCDL.stateHash,
                targetCDL.challengerAddress,
                keccak256(abi.encode(newOutcome))
            )
        );
        // INTERACTIONS
        SingleChannelAdjudicator(guarantor).payOutTarget(guarantorChannelId, guaranteeCDL, payOuts);
    }

    function _requireIncreasingIndices(uint256[] memory indices) internal pure {
        for (uint256 i = 0; i + 1 < indices.length; i++) {
            require(indices[i] < indices[i + 1], 'Indices must be sorted');
        }
    }

    function _transferAsset(
        address assetHolderAddress,
        bytes32 destination,
        uint256 amount
    ) internal {
        address payable recipient = _isExternalDestination(destination)
            ? _bytes32ToAddress(destination)
            : AdjudicatorFactory(adjudicatorFactoryAddress).getChannelAddress(destination);
        if (assetHolderAddress == address(0)) {
            (bool success, ) = recipient.call{value: amount}(''); //solhint-disable-line avoid-low-level-calls
            require(success, 'Could not transfer ETH');
        } else {
            // assume ERC20 Token
            require(
                IERC20(assetHolderAddress).transfer(recipient, amount),
                'Could not transfer ERC20 tokens'
            );
        }
    }

    function _holdings(address assetHolderAddress) internal view returns (uint256) {
        if (assetHolderAddress == address(0)) {
            return address(this).balance;
        } else {
            // assume ERC20 Token
            return IERC20(assetHolderAddress).balanceOf(address(this));
        }
    }

    function _holdings(address channelAddress, address assetHolderAddress)
        internal
        view
        returns (uint256)
    {
        if (assetHolderAddress == address(0)) {
            return channelAddress.balance;
        } else {
            // assume ERC20 Token
            return IERC20(assetHolderAddress).balanceOf(channelAddress);
        }
    }
}
