pragma solidity ^0.5.11;
pragma experimental ABIEncoderV2;

contract IAssetHolder {
    address AdjudicatorAddress;

    mapping(bytes32 => uint256) public holdings;

    mapping(bytes32 => bytes32) public outcomeHashes;

    /**
    * @notice Transfers the funds escrowed against `channelId` to the beneficiaries of that channel.
    * @dev Transfers the funds escrowed against `channelId` and transfers them to the beneficiaries of that channel.
    * @param channelId Unique identifier for a state channel.
    * @param allocationBytes The abi.encode of AssetOutcome.Allocation
    */
    function transferAll(bytes32 channelId, bytes calldata allocationBytes) external;

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
    ) external;

    /**
    * @dev Indicates that `amountDeposited` has been deposited into `destination`.
    * @param destination The channel being deposited into.
    * @param amountDeposited The amount being deposited.
    * @param destinationHoldings The new holdings for `destination`.
    */
    event Deposited(
        bytes32 indexed destination,
        uint256 amountDeposited,
        uint256 destinationHoldings
    );

    /**
    * @dev Indicates that `amount` assets have been transferred to the external adress denoted by `destination`.
    * @param destination An external address, right-padded with zeros.
    * @param amount Number of assets transferred (wei or tokens).
    */
    event AssetTransferred(bytes32 indexed destination, uint256 amount);

}
