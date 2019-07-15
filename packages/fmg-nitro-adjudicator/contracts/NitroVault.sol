pragma solidity ^0.5.2;
pragma experimental ABIEncoderV2;
import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "fmg-core/contracts/Commitment.sol";
import "fmg-core/contracts/Rules.sol";
import "./NitroAdjudicator.sol";

contract IERC20 { // ERC20 Interface
    // function totalSupply() public view returns (uint);
    // function balanceOf(address tokenOwner) public view returns (uint balance);
    // function allowance(address tokenOwner, address spender) public view returns (uint remaining);
    function transfer(address to, uint tokens) public returns (bool success);
    // function approve(address spender, uint tokens) public returns (bool success);
    function transferFrom(address from, address to, uint tokens) public returns (bool success);
    // event Transfer(address indexed from, address indexed to, uint tokens);
    // event Approval(address indexed tokenOwner, address indexed spender, uint tokens);
}

contract NitroVault {
    using Commitment for Commitment.CommitmentStruct;
    using SafeMath for uint;
    NitroAdjudicator Adjudicator;

    constructor(address _NitroAdjudicatorAddress) public {
        Adjudicator = NitroAdjudicator(_NitroAdjudicatorAddress);
    }

    struct Authorization {
        // Prevents replay attacks:
        // It's required that the participant signs the message, meaning only
        // the participant can authorize a withdrawal.
        // Moreover, the participant should sign the address that they wish
        // to send the transaction from, preventing any replay attack.
        address participant; // the account used to sign commitment transitions
        address destination; // either an account or a channel
        uint amount;
        address sender; // the account used to sign transactions
    }

    struct Signature {
        uint8 v;
        bytes32 r;
        bytes32 s;
    }
    struct ConclusionProof {
        Commitment.CommitmentStruct penultimateCommitment;
        Signature penultimateSignature;
        Commitment.CommitmentStruct ultimateCommitment;
        Signature ultimateSignature;
    }

    mapping(address => mapping(address => uint)) public holdings;
    mapping(address => Outcome) internal outcomes;
    address private constant zeroAddress = address(0);

    // **************
    // ETH and Token Management
    // **************


function deposit(address destination, uint expectedHeld,
 uint amount, address token) public payable {
       if (token == zeroAddress) {
        require(msg.value == amount, "Insufficient ETH for ETH deposit");
        } else {
            IERC20 _token = IERC20(token);
            require(_token.transferFrom(msg.sender,address(this),amount), 'Could not deposit ERC20s');
            }

        uint amountDeposited;
        // This protects against a directly funded channel being defunded due to chain re-orgs,
        // and allow a wallet implementation to ensure the safety of deposits.
        require(
            holdings[destination][token] >= expectedHeld,
            "Deposit: holdings[destination][token] is less than expected"
        );

        // If I expect there to be 10 and deposit 2, my goal was to get the
        // balance to 12.
        // In case some arbitrary person deposited 1 eth before I noticed, making the
        // holdings 11, I should be refunded 1.
        if (holdings[destination][token] == expectedHeld) {
            amountDeposited = amount;
        } else if (holdings[destination][token] < expectedHeld.add(amount)) {
            amountDeposited = expectedHeld.add(amount).sub(holdings[destination][token]);
        } else {
            amountDeposited = 0;
        }
        holdings[destination][token] = holdings[destination][token].add(amountDeposited);
        if (amountDeposited < amount) {
            // refund whatever wasn't deposited.
            if (token == zeroAddress) {
              msg.sender.transfer(amount - amountDeposited); // TODO use safeMath here
          }
            else {
                IERC20 _token = IERC20(token);
                _token.transfer(msg.sender, amount - amountDeposited); // TODO use safeMath here
                // TODO compute amountDeposited *before* calling into erc20 contract, so we only need 1 call not 2
                }
        }
        emit Deposited(destination, amountDeposited, holdings[destination][token]);
    }

    function transferAndWithdraw(address channel,
        address participant,
        address payable destination,
        uint amount,
        address token,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public payable {
        transfer(channel, participant, amount, token);
        withdraw(participant, destination, amount, token, _v, _r ,_s);
    }

    function withdraw(address participant,
        address payable destination,
        uint amount,
        address token,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) public payable {
        require(
            holdings[participant][token] >= amount,
            "Withdraw: overdrawn"
        );
        Authorization memory authorization = Authorization(
            participant,
            destination,
            amount,
            msg.sender
        );

        require(
            recoverSigner(abi.encode(authorization), _v, _r, _s) == participant,
            "Withdraw: not authorized by participant"
        );

        holdings[participant][token] = holdings[participant][token].sub(amount);
        // Decrease holdings before calling to token contract (protect against reentrancy)
        if (token == zeroAddress) {destination.transfer(amount);}
        else {
            IERC20 _token = IERC20(token);
            _token.transfer(destination,amount);
            }

    }


    function transfer(address channel, address destination, uint amount, address token) public {
        require(
            outcomes[channel].challengeCommitment.guaranteedChannel == zeroAddress,
            "Transfer: channel must be a ledger channel"
        );
        require(
            outcomes[channel].finalizedAt <= now,
            "Transfer: outcome must be final"
        );
        require(
            outcomes[channel].finalizedAt > 0,
            "Transfer: outcome must be present"
        );

        uint channelAffordsForDestination = affords(destination, outcomes[channel], holdings[channel][token]);

        require(
            amount <= channelAffordsForDestination,
            "Transfer: channel cannot afford the requested transfer amount"
        );

        holdings[destination][token] = holdings[destination][token] + amount;
        holdings[channel][token] = holdings[channel][token] - amount;

        // here we want to *set* outcomes, not just *get* outcomes
        // TODO REINSTATE
        // Adjudicator.setOutcome(channel) = reduce(outcomes[channel], destination, amount, token);
    }

    function claim(address guarantor, address recipient, uint amount, address token) public {
        NitroAdjudicator.Outcome memory guarantee = outcomes[guarantor];
        require(
            guarantee.challengeCommitment.guaranteedChannel != zeroAddress,
            "Claim: a guarantee channel is required"
        );

        require(
            isChannelClosed(guarantor),
            "Claim: channel must be closed"
        );

        uint funding = holdings[guarantor][token];
        NitroAdjudicator.Outcome memory reprioritizedOutcome = reprioritize(
            Adjudicator.getOutcome(guarantee.challengeCommitment.guaranteedChannel),
            guarantee
        );
        if (affords(recipient, reprioritizedOutcome, funding) >= amount) {
                    // here we want to *set* outcomes, not just *get* outcomes
        // TODO REINSTATE
            // Adjudicator.setOutcome(guarantee.challengeCommitment.guaranteedChannel) = reduce(
                // Adjudicator.getOutcome(guarantee.challengeCommitment.guaranteedChannel),
                // recipient,
                // amount,
                // token
            // );
            holdings[guarantor][token] = holdings[guarantor][token].sub(amount);
            holdings[recipient][token] = holdings[recipient][token].add(amount);
        } else {
            revert('Claim: guarantor must be sufficiently funded');
        }
    }

    // ********************
    // ETH and Token Management Logic
    // ********************

    function reprioritize(
        NitroAdjudicator.Outcome memory allocation,
        NitroAdjudicator.Outcome memory guarantee
    ) internal pure returns (NitroAdjudicator.Outcome memory) {
        require(
            guarantee.challengeCommitment.guaranteedChannel != zeroAddress,
            "Claim: a guarantee channel is required"
        );
        address[] memory newDestination = new address[](guarantee.destination.length);
        uint[] memory newAllocation = new uint[](guarantee.destination.length);
        for (uint aIdx = 0; aIdx < allocation.destination.length; aIdx++) {
            for (uint gIdx = 0; gIdx < guarantee.destination.length; gIdx++) {
                if (guarantee.destination[gIdx] == allocation.destination[aIdx]) {
                    newDestination[gIdx] = allocation.destination[aIdx];
                    newAllocation[gIdx] = allocation.allocation[aIdx];
                    break;
                }
            }
        }

        return NitroAdjudicator.Outcome(
            newDestination,
            allocation.finalizedAt,
            allocation.challengeCommitment,
            newAllocation,
            allocation.token
        );
    }

    function affords(
        address recipient,
        NitroAdjudicator.Outcome memory outcome,
        uint funding
    ) internal pure returns (uint256) {
        uint result = 0;
        uint remainingFunding = funding;

        for (uint i = 0; i < outcome.destination.length; i++) {
            if (remainingFunding <= 0) {
                break;
            }

            if (outcome.destination[i] == recipient) {
                // It is technically allowed for a recipient to be listed in the
                // outcome multiple times, so we must iterate through the entire
                // array.
                result = result.add(min(outcome.allocation[i], remainingFunding));
            }
            if (remainingFunding > outcome.allocation[i]){
                remainingFunding = remainingFunding.sub(outcome.allocation[i]);
            }else{
                remainingFunding = 0;
            }
        }

        return result;
    }

    function reduce(
        NitroAdjudicator.Outcome memory outcome,
        address recipient,
        uint amount,
        address token
    ) internal pure returns (NitroAdjudicator.Outcome memory) {
        // TODO only reduce entries corresponding to token argument
        uint256[] memory updatedAllocation = outcome.allocation;
        uint256 reduction = 0;
        uint remainingAmount = amount;
        for (uint i = 0; i < outcome.destination.length; i++) {
            if (outcome.destination[i] == recipient) {
                // It is technically allowed for a recipient to be listed in the
                // outcome multiple times, so we must iterate through the entire
                // array.
                reduction = reduction.add(min(outcome.allocation[i], remainingAmount));
                remainingAmount = remainingAmount.sub(reduction);
                updatedAllocation[i] = updatedAllocation[i].sub(reduction);
            }
        }

        return NitroAdjudicator.Outcome(
            outcome.destination,
            outcome.finalizedAt,
            outcome.challengeCommitment, // Once the outcome is finalized,
            updatedAllocation,
            outcome.token
        );
    }

    // ****************
    // Events
    // ****************
    

    event Deposited(address destination, uint256 amountDeposited, uint256 destinationHoldings);
   
    function isChannelClosed(address channel) internal view returns (bool) {
        return outcomes[channel].finalizedAt < now && outcomes[channel].finalizedAt > 0;
    }

    function moveAuthorized(Commitment.CommitmentStruct memory _commitment, Signature memory signature) internal pure returns (bool){
        return _commitment.mover() == recoverSigner(
            abi.encode(_commitment),
            signature.v,
            signature.r,
            signature.s
        );
    }

    function recoverSigner(bytes memory _d, uint8 _v, bytes32 _r, bytes32 _s) internal pure returns(address) {
        bytes memory prefix = "\x19Ethereum Signed Message:\n32";
        bytes32 h = keccak256(_d);

        bytes32 prefixedHash = keccak256(abi.encodePacked(prefix, h));

        address a = ecrecover(prefixedHash, _v, _r, _s);

        return(a);
    }

    function min(uint a, uint b) internal pure returns (uint) {
        if (a <= b) {
            return a;
        }

        return b;
    }
}