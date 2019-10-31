pragma solidity ^0.5.11;
import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

/**
  * @dev This contract extends an ERC20 implementation, and mints 10,000 tokens to the deploying account. Used for testing purposes.
*/
contract Token is ERC20 {

    /**
    * @dev Constructor function minting 10,000 tokens to the msg.sender (deploying account).
    */
    constructor() public {
        _mint(msg.sender, 10000);
    }
}
