pragma solidity ^0.5.11;
pragma experimental ABIEncoderV2;
import './Outcome.sol';
import '@openzeppelin/contracts/math/SafeMath.sol';
import './interfaces/IAssetHolder.sol';

/**
  * @dev An implementation of the IAssetHolder interface. The AssetHolder contract escrows ETH or tokens against state channels. It allows assets to be deposited, and ultimately transferred from one channel to other channel and/or external destinations, as well as for guarantees to be claimed.
*/
contract AssetHolder is IAssetHolder {
    using SafeMath for uint256;

    address AdjudicatorAddress;

    mapping(bytes32 => uint256) public holdings;

    mapping(bytes32 => bytes32) public outcomeHashes;

    // **************
    // Public methods
    // **************

    /**
    * @notice Transfers the funds escrowed against `channelId` to the beneficiaries of that channel.
    * @dev Transfers the funds escrowed against `channelId` and transfers them to the beneficiaries of that channel.
    * @param channelId Unique identifier for a state channel.
    * @param allocationBytes The abi.encode of AssetOutcome.Allocation
    */
    function transferAll(bytes32 channelId, bytes calldata allocationBytes) external {
        // checks
        require(
            outcomeHashes[channelId] ==
                keccak256(
                    abi.encode(
                        Outcome.AssetOutcome(
                            uint8(Outcome.AssetOutcomeType.Allocation),
                            allocationBytes
                        )
                    )
                ),
            'transferAll | submitted data does not match stored outcomeHash'
        );

        Outcome.AllocationItem[] memory allocation = abi.decode(
            allocationBytes,
            (Outcome.AllocationItem[])
        );
        uint256 balance = holdings[channelId];
        uint256 numPayouts = 0;
        uint256 numNewAllocationItems = allocation.length;
        uint256 _amount;
        bool overlap;
        uint256 finalPayoutAmount;
        uint256 firstNewAllocationItemAmount;

        for (uint256 i = 0; i < allocation.length; i++) {
            if (balance == 0) {
                // if funds are completely depleted, keep the allocationItem and do not pay out
            } else {
                _amount = allocation[i].amount;
                if (balance < _amount) {
                    // if funds still exist but are insufficient for this allocationItem, payout what's available and keep the allocationItem (but reduce the amount allocated)
                    // this block is never executed more than once
                    numPayouts++;
                    overlap = true;
                    finalPayoutAmount = balance;
                    firstNewAllocationItemAmount = _amount - balance;
                    balance = 0;
                } else {
                    // if ample funds still exist, pay them out and discard the allocationItem
                    numPayouts++;
                    numNewAllocationItems--;
                    balance = balance.sub(_amount);
                }
            }
        }

        // effects
        holdings[channelId] = balance;

        if (numNewAllocationItems > 0) {
            // construct newAllocation
            Outcome.AllocationItem[] memory newAllocation = new Outcome.AllocationItem[](
                numNewAllocationItems
            );
            for (uint256 k = 0; k < numNewAllocationItems; k++) {
                newAllocation[k] = allocation[allocation.length - numNewAllocationItems + k];
                if (overlap && k == 0) {
                    newAllocation[k].amount = firstNewAllocationItemAmount;
                }
            }

            // store hash
            outcomeHashes[channelId] = keccak256(
                abi.encode(
                    Outcome.AssetOutcome(
                        uint8(Outcome.AssetOutcomeType.Allocation),
                        abi.encode(newAllocation)
                    )
                )
            );
        } else {
            delete outcomeHashes[channelId];
        }

        // holdings updated BEFORE asset transferred (prevent reentrancy)
        uint256 payoutAmount;
        for (uint256 m = 0; m < numPayouts; m++) {
            if (overlap && m == numPayouts - 1) {
                payoutAmount = finalPayoutAmount;
            } else {
                payoutAmount = allocation[m].amount;
            }
            if (_isExternalDestination(allocation[m].destination)) {
                _transferAsset(_bytes32ToAddress(allocation[m].destination), payoutAmount);
                emit AssetTransferred(allocation[m].destination, payoutAmount);
            } else {
                holdings[allocation[m].destination] += payoutAmount;
            }
        }

    }

    /**
    * @notice Transfers the funds escrowed against `guarantorChannelId` to the beneficiaries of the __target__ of that channel.
    * @dev Transfers the funds escrowed against `guarantorChannelId` to the beneficiaries of the __target__ of that channel.
    * @param guarantorChannelId Unique identifier for a guarantor state channel.
    * @param guaranteeBytes The abi.encode of Outcome.Guarantee
    * @param allocationBytes The abi.encode of AssetOutcome.Allocation for the __target__
    */
    function claimAll(
        bytes32 guarantorChannelId,
        bytes calldata guaranteeBytes,
        bytes calldata allocationBytes
    ) external {
        // checks

        require(
            outcomeHashes[guarantorChannelId] ==
                keccak256(
                    abi.encode(
                        Outcome.AssetOutcome(
                            uint8(Outcome.AssetOutcomeType.Guarantee),
                            guaranteeBytes
                        )
                    )
                ),
            'claimAll | submitted data does not match outcomeHash stored against guarantorChannelId'
        );

        Outcome.Guarantee memory guarantee = abi.decode(guaranteeBytes, (Outcome.Guarantee));

        require(
            outcomeHashes[guarantee.targetChannelId] ==
                keccak256(
                    abi.encode(
                        Outcome.AssetOutcome(
                            uint8(Outcome.AssetOutcomeType.Allocation),
                            allocationBytes
                        )
                    )
                ),
            'claimAll | submitted data does not match outcomeHash stored against targetChannelId'
        );

        uint256 balance = holdings[guarantorChannelId];

        Outcome.AllocationItem[] memory allocation = abi.decode(
            allocationBytes,
            (Outcome.AllocationItem[])
        ); // this remains constant length

        uint256[] memory payouts = new uint256[](allocation.length);
        uint256 newAllocationLength = allocation.length;

        // first increase payouts according to guarantee
        for (uint256 i = 0; i < guarantee.destinations.length; i++) {
            // for each destination in the guarantee
            bytes32 _destination = guarantee.destinations[i];
            for (uint256 j = 0; j < allocation.length; j++) {
                if (balance == 0) {
                    break;
                }
                if (_destination == allocation[j].destination) {
                    // find amount allocated to that destination (if it exists in channel alllocation)
                    uint256 _amount = allocation[j].amount;
                    if (_amount > 0) {
                        if (balance >= _amount) {
                            balance -= _amount;
                            allocation[j].amount = 0; // subtract _amount;
                            newAllocationLength--;
                            payouts[j] += _amount;
                            break;
                        } else {
                            allocation[j].amount = _amount - balance;
                            payouts[j] += balance;
                            balance = 0;
                            break;
                        }
                    }
                }
            }
        }

        // next, increase payouts according to original allocation order
        // this block only has an effect if balance > 0
        for (uint256 j= 0; j < allocation.length; j++) {
            // for each entry in the target channel's outcome
            if (balance == 0) {
                break;
            }
            uint256 _amount = allocation[j].amount;
            if (_amount > 0) {
                if (balance >= _amount) {
                    balance -= _amount;
                    allocation[j].amount = 0; // subtract _amount;
                    newAllocationLength--;
                    payouts[j] += _amount;
                } else {
                    allocation[j].amount = _amount - balance;
                    payouts[j] += balance;
                    balance = 0;
                }
            }
        }

        // effects
        holdings[guarantorChannelId] = balance;

        // at this point have payouts array of uint256s, each corresponding to original destinations
        // and allocations has some zero amounts which we want to prune
        Outcome.AllocationItem[] memory newAllocation;
        if (newAllocationLength > 0) {
            newAllocation = new Outcome.AllocationItem[](newAllocationLength);
        }

        uint256 k = 0;
        for (uint256 j = 0; j < allocation.length; j++) {
            // for each destination in the target channel's allocation
            if (allocation[j].amount > 0) {
                newAllocation[k] = allocation[j];
                k++;
            }
            if (payouts[j] > 0) {
                if (_isExternalDestination(allocation[j].destination)) {
                    _transferAsset(_bytes32ToAddress(allocation[j].destination), payouts[j]);
                    emit AssetTransferred(allocation[j].destination, payouts[j]);
                } else {
                    holdings[allocation[j].destination] += payouts[j];
                }
            }

        }
        assert(k == newAllocationLength);

        if (newAllocationLength > 0) {
            // store hash
            outcomeHashes[guarantee.targetChannelId] = keccak256(
                abi.encode(
                    Outcome.AssetOutcome(
                        uint8(Outcome.AssetOutcomeType.Allocation),
                        abi.encode(newAllocation)
                    )
                )
            );
        } else {
            delete outcomeHashes[guarantee.targetChannelId];
        }

    }

    // **************
    // Permissioned methods
    // **************

    modifier AdjudicatorOnly {
        require(msg.sender == AdjudicatorAddress, 'Only the NitroAdjudicator is authorized');
        _;
    }

    /**
    * @notice Sets the given outcomeHash for the given channelId in the outcomeHashes storage mapping
    * @dev Sets the given outcomeHash for the given channelId in the outcomeHashes storage mapping
    * @param channelId Unique identifier for a state channel.
    * @param outcomeHash The keccak256 of the abi.encode of the Outcome.
    */
    function _setAssetOutcomeHash(bytes32 channelId, bytes32 outcomeHash) internal {
        require(outcomeHashes[channelId] == bytes32(0), 'Outcome hash already exists');
        outcomeHashes[channelId] = outcomeHash;
    }

    /**
    * @notice Sets the given outcomeHash for the given channelId in the outcomeHashes storage mapping.
    * @dev Sets the given outcomeHash for the given channelId in the outcomeHashes storage mapping.
    * @param channelId Unique identifier for a state channel.
    * @param outcomeHash The keccak256 of the abi.encode of the Outcome.
    */
    function setAssetOutcomeHash(bytes32 channelId, bytes32 outcomeHash)
        external
        AdjudicatorOnly
        returns (bool success)
    {
        _setAssetOutcomeHash(channelId, outcomeHash);
        return true;
    }

    // **************
    // Internal methods
    // **************

    /**
    * @notice Transfers the given amount of this AssetHolders's asset type to a supplied ethereum address.
    * @dev Transfers the given amount of this AssetHolders's asset type to a supplied ethereum address.
    * @param destination ethereum address to be credited.
    * @param amount Quantity of assets to be transferred.
    */
    function _transferAsset(address payable destination, uint256 amount) internal {}

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
}
