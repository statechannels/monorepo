// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.7.4;
pragma experimental ABIEncoderV2;

import '@openzeppelin/contracts/utils/Create2.sol';
import './SingleChannelAdjudicator.sol';

contract AdjudicatorFactory {
    // Creation code constants taken from EIP1167
    bytes private constant proxyCreationCodePrefix = hex'3d602d80600a3d3981f3_363d3d373d3d3d363d73';
    bytes private constant proxyCreationCodeSuffix = hex'5af43d82803e903d91602b57fd5bf3';

    bytes32 private creationCodeHash;
    address private mastercopy;

    event ChannelCreation(address channel);

    function setup(address _mastercopy) public {
        require(mastercopy == address(0), 'Can only set mstrcpy addr once');
        mastercopy = _mastercopy;
        creationCodeHash = keccak256(_getProxyCreationCode(_mastercopy));
    }

    ////////////////////////////////////////
    // Public Methods

    /// @dev Allows us to get the mastercopy that this factory will deploy channels against
    function getMastercopy() external view returns (address) {
        return mastercopy;
    }

    /// @dev Returns the proxy code used to both calculate the CREATE2 address and deploy the channel proxy pointed to the `ChannelMastercopy`
    function getProxyCreationCode() public view returns (bytes memory) {
        return _getProxyCreationCode(mastercopy);
    }

    /// @dev Allows us to get the address for a new channel contract created via `createChannel`
    function getChannelAddress(bytes32 channelId) external view returns (address payable) {
        return payable(Create2.computeAddress(channelId, creationCodeHash));
    }

    /// @dev Allows us to create new channel contract and get it all set up in one transaction
    function createChannel(bytes32 channelId) public {
        _deployChannelProxy(channelId);
    }

    /// @dev Allows us to create new channel contract, payout all of the funds, and destroy the contract
    function createAndPayout(
        bytes32 channelId,
        uint48 largestTurnNum,
        SingleChannelAdjudicator.FixedPart memory fixedPart,
        bytes32 appPartHash,
        bytes memory outcomeBytes,
        uint8 numStates,
        uint8[] memory whoSignedWhat,
        SingleChannelAdjudicator.Signature[] memory sigs
    ) public {
        address payable channel = payable(_deployChannelProxy(channelId));
        SingleChannelAdjudicator(channel).concludeAndTransferAll(
            largestTurnNum,
            fixedPart,
            appPartHash,
            outcomeBytes,
            numStates,
            whoSignedWhat,
            sigs
        );
    }

    ////////////////////////////////////////
    // Internal Methods

    function _getProxyCreationCode(address _mastercopy) internal pure returns (bytes memory) {
        return abi.encodePacked(proxyCreationCodePrefix, _mastercopy, proxyCreationCodeSuffix);
    }

    /// @dev Allows us to create new channel contact using CREATE2
    function _deployChannelProxy(bytes32 channelId) internal returns (address) {
        // the channelId is used as the create2 salt
        return Create2.deploy(0, channelId, getProxyCreationCode());
    }
}
