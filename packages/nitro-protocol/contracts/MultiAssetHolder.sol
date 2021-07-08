// SPDX-License-Identifier: MIT
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;
import './Outcome.sol';
import './ForceMove.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import './interfaces/IMultiAssetHolder.sol';

/**
@dev An implementation of the IMultiAssetHolder interface. The AssetHolder contract escrows ETH or tokens against state channels. It allows assets to be internally accounted for, and ultimately prepared for transfer from one channel to other channel and/or external destinations, as well as for guarantees to be claimed.
 */
contract MultiAssetHolder is IMultiAssetHolder, ForceMove {
    using SafeMath for uint256;

    /**
     * holdings[asset][channelId] is the amount of asset held against channel channelId. 0 address implies ETH
     */
    mapping(address => mapping(bytes32 => uint256)) public holdings;

    // **************
    // External methods
    // **************

    /**
     * @notice Deposit ETH or erc20 tokens against a given destination.
     * @dev Deposit ETH or erc20 tokens against a given destination.
     * @param asset erc20 token address, or zero address to indicate ETH
     * @param destination ChannelId to be credited.
     * @param expectedHeld The number of wei/tokens the depositor believes are _already_ escrowed against the channelId.
     * @param amount The intended number of wei/tokens to be deposited.
     */
    function deposit(
        address asset,
        bytes32 destination,
        uint256 expectedHeld,
        uint256 amount
    ) external override payable {
        require(!_isExternalDestination(destination), 'Deposit to external destination');
        uint256 amountDeposited;
        // this allows participants to reduce the wait between deposits, while protecting them from losing funds by depositing too early. Specifically it protects against the scenario:
        // 1. Participant A deposits
        // 2. Participant B sees A's deposit, which means it is now safe for them to deposit
        // 3. Participant B submits their deposit
        // 4. The chain re-orgs, leaving B's deposit in the chain but not A's
        require(holdings[asset][destination] >= expectedHeld, 'holdings < expectedHeld');
        require(
            holdings[asset][destination] < expectedHeld.add(amount),
            'holdings already sufficient'
        );

        // The depositor wishes to increase the holdings against channelId to amount + expectedHeld
        // The depositor need only deposit (at most) amount + (expectedHeld - holdings) (the term in parentheses is non-positive)

        amountDeposited = expectedHeld.add(amount).sub(holdings[asset][destination]); // strictly positive
        // require successful deposit before updating holdings (protect against reentrancy)
        if (asset == address(0)) {
            require(msg.value == amount, 'Incorrect msg.value for deposit');
        } else {
            // require successful deposit before updating holdings (protect against reentrancy)
            require(
                IERC20(asset).transferFrom(msg.sender, address(this), amountDeposited),
                'Could not deposit ERC20s'
            );
        }

        holdings[asset][destination] = holdings[asset][destination].add(amountDeposited);
        emit Deposited(destination, asset, amountDeposited, holdings[asset][destination]);

        if (asset == address(0)) {
            // refund whatever wasn't deposited.
            uint256 refund = amount.sub(amountDeposited);
            (bool success, ) = msg.sender.call{value: refund}(''); //solhint-disable-line avoid-low-level-calls
            require(success, 'Could not refund excess funds');
        }
    }

    /**
     * @notice Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @dev Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries.
     * @param fromChannelId Unique identifier for state channel to transfer funds *from*.
     * @param outcomeBytes The encoded Outcome of this state channel
     * @param indices Array with each entry denoting the index of a destination to transfer funds to. An empty array indicates "all".
     */
    function transfer(
        uint256 assetIndex, // TODO consider a uint48?
        bytes32 fromChannelId,
        bytes memory outcomeBytes,
        bytes32 stateHash,
        address challengerAddress,
        uint256[] memory indices
    ) external override {
        // checks
        _requireIncreasingIndices(indices);
        _requireChannelFinalized(fromChannelId);
        _requireMatchingFingerprint(
            stateHash,
            challengerAddress,
            keccak256(outcomeBytes),
            fromChannelId
        );

        Outcome.OutcomeItem[] memory outcome = abi.decode(outcomeBytes, (Outcome.OutcomeItem[]));
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

        // effects and interactions
        (allocation, ) = _transfer(asset, fromChannelId, allocation, indices); // update in place to newAllocation
        outcome[assetIndex].assetOutcomeBytes = abi.encode(
            Outcome.AssetOutcome(Outcome.AssetOutcomeType.Allocation, abi.encode(allocation))
        );
        outcomeBytes = abi.encode(outcome);
        bytes32 outcomeHash = keccak256(outcomeBytes);
        _updateFingerprint(fromChannelId, stateHash, challengerAddress, outcomeHash);
        emit FingerprintUpdated(fromChannelId, outcomeBytes);
    }

    /**
     * @notice Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel. Checks against the storage in this contract.
     * @dev Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel. Checks against the storage in this contract.
     */
    function claim(
        uint256 assetIndex, // TODO consider a uint48?
        bytes32 guarantorChannelId,
        bytes memory guarantorOutcomeBytes,
        bytes32 guarantorStateHash,
        address guarantorChallengerAddress,
        bytes memory targetOutcomeBytes,
        bytes32 targetStateHash,
        address targetChallengerAddress,
        uint256[] memory indices
    ) external override {
        // checks
        Outcome.Guarantee memory guarantee;
        address asset;
        {
            _requireIncreasingIndices(indices);
            _requireChannelFinalized(guarantorChannelId);
        }
        {
            bytes32 guarantorOutcomeHash = keccak256(guarantorOutcomeBytes);
            _requireMatchingFingerprint(
                guarantorStateHash,
                guarantorChallengerAddress,
                guarantorOutcomeHash,
                guarantorChannelId
            );
        }

        {
            Outcome.OutcomeItem[] memory outcome = abi.decode(
                guarantorOutcomeBytes,
                (Outcome.OutcomeItem[])
            );
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[assetIndex].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );
            require(
                assetOutcome.assetOutcomeType == Outcome.AssetOutcomeType.Guarantee,
                '!guarantee'
            );
            guarantee = abi.decode(assetOutcome.allocationOrGuaranteeBytes, (Outcome.Guarantee));
            asset = outcome[assetIndex].asset;
        }
        {
            _requireChannelFinalized(guarantee.targetChannelId);
            _requireMatchingFingerprint(
                targetStateHash,
                targetChallengerAddress,
                keccak256(targetOutcomeBytes),
                guarantee.targetChannelId
            );
        }
        Outcome.AllocationItem[] memory allocation;
        {
            Outcome.OutcomeItem[] memory outcome = abi.decode(
                targetOutcomeBytes,
                (Outcome.OutcomeItem[])
            );
            Outcome.AssetOutcome memory assetOutcome = abi.decode(
                outcome[assetIndex].assetOutcomeBytes,
                (Outcome.AssetOutcome)
            );
            require(
                assetOutcome.assetOutcomeType == Outcome.AssetOutcomeType.Allocation,
                '!allocation'
            );
            allocation = abi.decode(
                assetOutcome.allocationOrGuaranteeBytes,
                (Outcome.AllocationItem[])
            );

            // effects and interactions
            allocation = _claim(asset, guarantorChannelId, guarantee, allocation, indices);
            outcome[assetIndex].assetOutcomeBytes = abi.encode(
                Outcome.AssetOutcome(Outcome.AssetOutcomeType.Allocation, abi.encode(allocation))
            );
            bytes memory outcomeBytes = abi.encode(outcome);
            bytes32 outcomeHash = keccak256(outcomeBytes);
            _updateFingerprint(
                guarantee.targetChannelId,
                targetStateHash,
                targetChallengerAddress,
                outcomeHash
            );
            emit FingerprintUpdated(guarantee.targetChannelId, outcomeBytes);
        }
    }

    // **************
    // Internal methods
    // **************

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
            bool allocatesOnlyZeros,
            uint256[] memory payouts,
            uint256 totalPayouts
        )
    {
        // `indices == []` means "pay out to all"
        // Note: by initializing payouts to be an array of fixed length, its entries are initialized to be `0`
        payouts = new uint256[](indices.length > 0 ? indices.length : allocation.length);
        totalPayouts = 0;
        newAllocation = new Outcome.AllocationItem[](allocation.length);
        allocatesOnlyZeros = true; // switched to false if there is an item remaining with amount > 0
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
                        payouts[k] += affordsForDestination;
                        totalPayouts += affordsForDestination;
                        // move on to the next supplied index
                        ++k;
                    }
                    break; // start again with the next guarantee destination
                }
            }
        }

        for (uint256 i = 0; i < allocation.length; i++) {
            if (newAllocation[i].amount != 0) {
                allocatesOnlyZeros = false;
                break;
            }
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
            bool allocatesOnlyZeros,
            uint256[] memory payouts,
            uint256 totalPayouts
        )
    {
        // `indices == []` means "pay out to all"
        // Note: by initializing payouts to be an array of fixed length, its entries are initialized to be `0`
        payouts = new uint256[](indices.length > 0 ? indices.length : allocation.length);
        totalPayouts = 0;
        newAllocation = new Outcome.AllocationItem[](allocation.length);
        allocatesOnlyZeros = true; // switched to false if there is an item remaining with amount > 0
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
            if (newAllocation[i].amount != 0) allocatesOnlyZeros = false;
            // decrease surplus by the current amount if possible, else surplus goes to zero
            surplus -= affordsForDestination;
        }
    }

    /**
     * @notice Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries. Does not check allocationBytes against on chain storage.
     * @dev Transfers as many funds escrowed against `channelId` as can be afforded for a specific destination. Assumes no repeated entries. Does not check allocationBytes against on chain storage.
     * @param fromChannelId Unique identifier for state channel to transfer funds *from*.
     * @param allocation An AssetOutcome.AllocationItem[]
     * @param indices Array with each entry denoting the index of a destination to transfer funds to. Should be in increasing order. An empty array indicates "all".
     */
    function _transfer(
        address asset,
        bytes32 fromChannelId,
        Outcome.AllocationItem[] memory allocation,
        uint256[] memory indices
    ) internal returns (Outcome.AllocationItem[] memory, bool) {
        uint256 initialHoldings = holdings[asset][fromChannelId];

        (
            Outcome.AllocationItem[] memory newAllocation,
            bool allocatesOnlyZeros,
            uint256[] memory payouts,
            uint256 totalPayouts
        ) = _computeNewAllocation(initialHoldings, allocation, indices);

        // *******
        // EFFECTS
        // *******

        holdings[asset][fromChannelId] = initialHoldings.sub(totalPayouts); // expect gas rebate if this is set to 0

        // *******
        // INTERACTIONS
        // *******

        for (uint256 j = 0; j < payouts.length; j++) {
            if (payouts[j] > 0) {
                bytes32 destination = allocation[indices.length > 0 ? indices[j] : j].destination;
                if (_isExternalDestination(destination)) {
                    _transferAsset(asset, _bytes32ToAddress(destination), payouts[j]);
                } else {
                    holdings[asset][destination] += payouts[j];
                }
            }
        }
        return (newAllocation, allocatesOnlyZeros);
    }

    /**
     * @notice Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel.  Does not check allocationBytes or guarantee against on chain storage.
     * @dev Transfers as many funds escrowed against `guarantorChannelId` as can be afforded for a specific destination in the beneficiaries of the __target__ of that channel.  Does not check allocationBytes or guarantee against on chain storage.
     */
    function _claim(
        address asset,
        bytes32 guarantorChannelId,
        Outcome.Guarantee memory guarantee,
        Outcome.AllocationItem[] memory allocation,
        uint256[] memory indices
    ) internal returns (Outcome.AllocationItem[] memory) {
        uint256 initialHoldings = holdings[asset][guarantorChannelId];

        (
            Outcome.AllocationItem[] memory newAllocation,
            ,
            uint256[] memory payouts,
            uint256 totalPayouts
        ) = _computeNewAllocationWithGuarantee(initialHoldings, allocation, indices, guarantee);

        // *******
        // EFFECTS
        // *******

        holdings[asset][guarantorChannelId] = initialHoldings.sub(totalPayouts); // expect gas rebate if this is set to 0

        // *******
        // INTERACTIONS
        // *******

        for (uint256 j = 0; j < payouts.length; j++) {
            if (payouts[j] > 0) {
                bytes32 destination = allocation[indices.length > 0 ? indices[j] : j].destination;
                // storage updated BEFORE external contracts called (prevent reentrancy attacks)
                if (_isExternalDestination(destination)) {
                    _transferAsset(asset, _bytes32ToAddress(destination), payouts[j]);
                } else {
                    holdings[asset][destination] += payouts[j];
                }
            }
        }
        return newAllocation;
        // TODO emit OutcomeUpdated(guarantorChannelId, initialHoldings);
    }

    /**
     * @notice Transfers the given amount of this AssetHolders's asset type to a supplied ethereum address.
     * @dev Transfers the given amount of this AssetHolders's asset type to a supplied ethereum address.
     * @param destination ethereum address to be credited.
     * @param amount Quantity of assets to be transferred.
     */
    function _transferAsset(
        address asset,
        address payable destination,
        uint256 amount
    ) internal {
        if (asset == address(0)) {
            (bool success, ) = destination.call{value: amount}(''); //solhint-disable-line avoid-low-level-calls
            require(success, 'Could not transfer ETH');
        } else {
            IERC20(asset).transfer(destination, amount);
        }
    }

    /**
     * @notice Checks if a given destination is external (and can therefore have assets transferred to it) or not.
     * @dev Checks if a given destination is external (and can therefore have assets transferred to it) or not.
     * @param destination Destination to be checked.
     * @return True if the destination is external, false otherwise.
     */
    function _isExternalDestination(bytes32 destination) internal pure returns (bool) {
        return uint96(bytes12(destination)) == 0;
    }

    /**
     * @notice Converts an ethereum address to a nitro external destination.
     * @dev Converts an ethereum address to a nitro external destination.
     * @param participant The address to be converted.
     * @return The input address left-padded with zeros.
     */
    function _addressToBytes32(address participant) internal pure returns (bytes32) {
        return bytes32(uint256(participant));
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

    // **************
    // Requirers
    // **************

    /**
     * @notice Checks that a given variables hash to the data stored on chain.
     * @dev Checks that a given variables hash to the data stored on chain.
     */
    function _requireMatchingFingerprint(
        bytes32 stateHash,
        address challengerAddress,
        bytes32 outcomeHash,
        bytes32 channelId
    ) internal view {
        (, , uint160 fingerprint) = _unpackStatus(channelId);
        require(
            fingerprint == _generateFingerprint(stateHash, challengerAddress, outcomeHash),
            'incorrect fingerprint'
        );
    }

    function _requireIncreasingIndices(uint256[] memory indices) internal pure {
        for (uint256 i = 0; i + 1 < indices.length; i++) {
            require(indices[i] < indices[i + 1], 'Indices must be sorted');
        }
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? b : a;
    }
}
