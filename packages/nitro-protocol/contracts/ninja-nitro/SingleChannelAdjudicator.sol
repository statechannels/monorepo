// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '../interfaces/IAssetHolder.sol';
import '../ForceMove.sol';
import '../Outcome.sol';
import './AdjudicatorFactory.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

contract SingleChannelAdjudicator is
    ForceMove //, IAssetHolder { // TODO
{
    address public immutable adjudicatorFactoryAddress;

    constructor(address a) {
        adjudicatorFactoryAddress = a;
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
     * @notice Triggers transferAll in all external Asset Holder contracts specified in a given outcome for a given channelId.
     * @dev Triggers transferAll in  all external Asset Holder contracts specified in a given outcome for a given channelId.
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
     * @notice Converts a nitro destination to an ethereum address.
     * @dev Converts a nitro destination to an ethereum address.
     * @param destination The destination to be converted.
     * @return The rightmost 160 bits of the input string.
     */
    function _bytes32ToAddress(bytes32 destination) internal pure returns (address payable) {
        return address(uint160(uint256(destination)));
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

    function _computeNewOutcomeAfterClaim(
        uint256[] memory initialHoldings,
        Outcome.OutcomeItem[] memory outcome,
        bytes32 targetChannelId,
        uint256[][] memory indices,
        Outcome.OutcomeItem[] memory guarantorOutcome
    )
        public
        pure
        returns (Outcome.OutcomeItem[] memory newOutcome, Outcome.OutcomeItem[] memory payOuts)
    {
        require(initialHoldings.length == indices.length && outcome.length == indices.length);
        require(outcome.length == guarantorOutcome.length);
        newOutcome = new Outcome.OutcomeItem[](outcome.length);
        payOuts = new Outcome.OutcomeItem[](outcome.length);
        // loop over tokens
        for (uint256 i = 0; i < outcome.length; i++) {
            require(outcome[i].assetHolderAddress == guarantorOutcome[i].assetHolderAddress);
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[i].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );
            require(assetOutcome.assetOutcomeType == uint8(Outcome.AssetOutcomeType.Allocation));
            Outcome.AssetOutcome memory gAssetOutcome = abi.decode(
                guarantorOutcome[i].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );
            require(gAssetOutcome.assetOutcomeType == uint8(Outcome.AssetOutcomeType.Guarantee));
            Outcome.Guarantee memory guarantee = abi.decode(
                gAssetOutcome.allocationOrGuaranteeBytes,
                (Outcome.Guarantee)
            );
            require(guarantee.targetChannelId == targetChannelId);
            Outcome.AllocationItem[] memory allocation = abi.decode(
                assetOutcome.allocationOrGuaranteeBytes,
                (Outcome.AllocationItem[])
            );
            (
                Outcome.AllocationItem[] memory newAllocation, // TODO make use of safeToDelete
                ,
                Outcome.AllocationItem[] memory payouts
            ) = _computeNewAllocationWithGuarantee(
                initialHoldings[i],
                allocation,
                indices[i],
                guarantee
            );

            newOutcome[i] = Outcome.OutcomeItem(
                outcome[i].assetHolderAddress,
                abi.encode(
                    Outcome.AssetOutcome(
                        uint8(Outcome.AssetOutcomeType.Allocation),
                        abi.encode(newAllocation)
                    )
                )
            );

            payOuts[i] = Outcome.OutcomeItem(
                outcome[i].assetHolderAddress,
                abi.encode(
                    Outcome.AssetOutcome(
                        uint8(Outcome.AssetOutcomeType.Allocation),
                        abi.encode(payouts)
                    )
                )
            );
        }
    }

    function _computeNewAllocation(
        uint256 initialHoldings,
        Outcome.AllocationItem[] memory allocation,
        uint256[] memory indices
    )
        public
        pure
        returns (
            Outcome.AllocationItem[] memory newAllocation,
            bool safeToDelete,
            uint256[] memory payouts,
            uint256 totalPayouts
        )
    {
        // `indices == []` means "pay out to all"
        // Note: by initializing payouts to be an array of fixed length, its entries are initialized to be `0`
        payouts = new uint256[](indices.length > 0 ? indices.length : allocation.length);
        totalPayouts = 0;
        newAllocation = new Outcome.AllocationItem[](allocation.length);
        safeToDelete = true; // switched to false if there is an item remaining with amount > 0
        uint256 surplus = initialHoldings; // tracks funds available during calculation
        uint256 k = 0; // indexes the `indices` array

        // loop over allocations and decrease surplus
        for (uint256 i = 0; i < allocation.length; i++) {
            // copy destination part
            newAllocation[i].destination = allocation[i].destination;
            // compute new amount part
            uint256 affordsForDestination = min(allocation[i].amount, surplus);
            if ((indices.length == 0) || ((k < indices.length) && (indices[k] == i))) {
                // found a match
                // reduce the current allocationItem.amount
                newAllocation[i].amount = allocation[i].amount - affordsForDestination;
                // increase the relevant payout
                payouts[k] = affordsForDestination;
                totalPayouts += affordsForDestination;
                // move on to the next supplied index
                ++k;
            } else {
                newAllocation[i].amount = allocation[i].amount;
            }
            if (newAllocation[i].amount != 0) safeToDelete = false;
            // decrease surplus by the current amount if possible, else surplus goes to zero
            surplus -= affordsForDestination;
        }
    }

    function _computeNewAllocationWithGuarantee(
        uint256 initialHoldings,
        Outcome.AllocationItem[] memory allocation,
        uint256[] memory indices,
        Outcome.Guarantee memory guarantee // TODO this could just accept guarantee.destinations ?
    )
        public
        pure
        returns (
            Outcome.AllocationItem[] memory newAllocation,
            bool safeToDelete,
            Outcome.AllocationItem[] memory payOuts
        )
    {
        // `indices == []` means "pay out to all"
        // Note: by initializing payOuts to be an array of fixed length, its entries are initialized to be `0`
        newAllocation = new Outcome.AllocationItem[](allocation.length);
        payOuts = new Outcome.AllocationItem[](
            indices.length > 0 ? indices.length : allocation.length
        );
        safeToDelete = true; // switched to false if there is an item remaining with amount > 0
        uint256 surplus = initialHoldings; // tracks funds available during calculation
        uint256 k = 0; // indexes the `indices` array

        // copy allocation
        for (uint256 i = 0; i < allocation.length; i++) {
            newAllocation[i].destination = allocation[i].destination;
            newAllocation[i].amount = allocation[i].amount;
        }

        // for each guarantee destination
        for (uint256 j = 0; j < guarantee.destinations.length; j++) {
            if (surplus == 0) break;
            for (uint256 i = 0; i < newAllocation.length; i++) {
                if (surplus == 0) break;
                // search for it in the allocation
                if (guarantee.destinations[j] == newAllocation[i].destination) {
                    // if we find it, compute new amount
                    uint256 affordsForDestination = min(allocation[i].amount, surplus);
                    // decrease surplus by the current amount regardless of hitting a specified index
                    surplus -= affordsForDestination;
                    if ((indices.length == 0) || ((k < indices.length) && (indices[k] == i))) {
                        // only if specified in supplied indices, or we if we are doing "all"
                        // reduce the new allocationItem.amount
                        newAllocation[i].amount -= affordsForDestination;
                        // increase the relevant payout
                        payOuts[k].destination = allocation[i].destination;
                        payOuts[k].amount += affordsForDestination;
                        // move on to the next supplied index
                        ++k;
                    }
                    break; // start again with the next guarantee destination
                }
            }
        }

        for (uint256 i = 0; i < allocation.length; i++) {
            if (newAllocation[i].amount != 0) {
                safeToDelete = false;
                break;
            }
        }
    }

    function payOutTarget(
        bytes32 guarantorChannelId,
        ChannelDataLite calldata cDL,
        Outcome.OutcomeItem[] memory payouts
    ) external {
        Outcome.OutcomeItem[] memory guarantorOutcome = abi.decode(
            cDL.outcomeBytes,
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
        bytes32 outcomeHash = keccak256(cDL.outcomeBytes);
        _requireMatchingStorage(
            ChannelData(
                cDL.turnNumRecord,
                cDL.finalizesAt,
                cDL.stateHash,
                cDL.challengerAddress,
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
        ChannelDataLite calldata guaranteeCDL,
        ChannelDataLite calldata targetCDL,
        uint256[][] memory indices
    ) external {
        // CHECKS
        for (uint256 i = 0; i + 1 < indices.length; i++) {
            _requireIncreasingIndices(indices[i]);
        }
        Outcome.OutcomeItem[] memory guarantorOutcome = abi.decode(
            guaranteeCDL.outcomeBytes,
            (Outcome.OutcomeItem[])
        );
        address guarantor = AdjudicatorFactory(adjudicatorFactoryAddress).getChannelAddress(
            guarantorChannelId
        );
        address targetChannelAddress = AdjudicatorFactory(adjudicatorFactoryAddress)
            .getChannelAddress(targetChannelId);
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
        uint256[] memory initialHoldings = new uint256[](indices.length);
        for (uint256 i = 0; i + 1 < indices.length; i++) {
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
        require(
            keccak256(abi.encode(newOutcome)) != keccak256(targetCDL.outcomeBytes),
            'outcome did not change'
        ); // TODO this is mostly for debugging
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

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? b : a;
    }

    function _transferAsset(
        address assetHolderAddress,
        bytes32 destination,
        uint256 amount
    ) internal {
        if (assetHolderAddress == address(0)) {
            (bool success, ) = _bytes32ToAddress(destination).call{value: amount}(''); //solhint-disable-line avoid-low-level-calls
            require(success, 'Could not transfer ETH');
        } else {
            // assume ERC20 Token
            require(
                IERC20(assetHolderAddress).transfer(_bytes32ToAddress(destination), amount),
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
