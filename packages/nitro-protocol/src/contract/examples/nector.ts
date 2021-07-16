type Peer = 'Alice' | 'Bob';

type Outcome = {
  Alice: number;
  Bob: number;
};

type TransferResolution = {
  data: any;

  // helper
  signedBy(peer: Peer): boolean;
};
type Rules = {
  resolve(resolution: TransferResolution, data: any): Outcome;
};

type Transfer = {
  id: string; // This would be a hash of the rules, participants, and nonce;
  nonce: number; // to allow for distinct transfers between a fixed set of participants
  rules: Rules;
  data: any;
  recipient: Peer;
  resolution?: TransferResolution;
};

type SignedState = {
  signedby(...peers: Peer[]): boolean;
  type: 'None' | 'A' | 'B' | 'AB';
  transfers: Transfer[];
  outcome: Outcome;
};

type Proof = SignedState[];

/**
 * @param proof support proof of 1, 2 or 3 signed states
 * @returns boolean
 *
 * This is an implementation of validSupportProof which implements the Vector protocol
 * as a Nitro app (more or less).
 *
 * This allows these state transitions:
 *      AB
 *      ^^
 *     /  \
 *   A      B
 *   ^      ^
 *    \    /
 *     None
 *
 * In the happy path, peers doubly sign None states in order to
 * - add or remove transfers
 * - reconcile deposits
 * etc
 *
 * In the sad path, each party can force a transition, resolving any transfers that
 * benefit them. Alice does so by moving to an A state; Bob by moving to a B state.
 * The other peer is then allowed to force a transition to an AB state.
 *
 * Transfers can be _resolved_ by providing a _resolution_. A resolved transfer
 * returns an _amount_, which updates the balance of the transfer's _recipient_.
 */
export function validSupport(proof: Proof): boolean {
  const [first, second, third] = proof;
  requireThat(first.type === 'None');

  if (proof.length === 1) {
    requireThat(first.signedby('Alice', 'Bob'));
    return true;
  }

  // None -> A or None -> B are allowed, meaning any peer can present their resolutions
  requireThat(second.type === 'A' || second.type === 'B');
  if (second.type === 'A') {
    requireThat(first.signedby('Bob'));
    requireThat(second.signedby('Alice'));
  } else if (second.type === 'B') {
    requireThat(first.signedby('Alice'));
    requireThat(second.signedby('Bob'));
  } else {
    revert('Invalid second state -- expecting A or B');
  }

  validateTransferSet(first, second);

  if (proof.length === 3) {
    // 'A' -> 'AB' and 'B' -> 'AB' are allowed, giving the "other" peer a chance to present their own resolutions
    requireThat(third.type === 'AB');

    if (second.type === 'A') {
      requireThat(third.signedby('Bob'));
    } else if (second.type === 'B') {
      requireThat(third.signedby('Alice'));
    }

    validateTransferSet(first, third);
  } else if (proof.length > 3) {
    // Peers only get one chance each to present their resolutions.
    revert('Invalid proof length -- expecting at most three states');
  }

  // This is a crude accounting computation to assert that the result of the transfers presented is correctly accounted for.
  const totalTransferred = first.transfers
    .map((transfer, idx) => {
      const {recipient, rules, data} = transfer;

      // The transfer may resolve to a variable amount, according to the data supplied.
      // This allows eg. a HashLock transfer to resolve to
      // - no change, if the pre-image is not supplied or is incorrect
      // - a non-zero change, if the pre-image is correctly supplied

      // Only the recipient of a transfer can sign the resolution.
      // They will only sign _one_ resolution for each transfer, when construcing a dispute transaction.
      // Therefore, it's safe to pick off _any_ resolution off of either the second or third state.

      const resolution = second.transfers[idx].resolution ?? third?.transfers[idx].resolution;
      const changes = resolution ? rules.resolve(resolution, data) : {Alice: 0, Bob: 0};

      if (recipient === 'Alice') {
        requireThat(changes.Alice >= 0);
      } else {
        requireThat(changes.Bob >= 0);
      }
      requireThat(changes.Alice == -changes.Alice);

      return changes;
    })
    .reduce((total, current) => ({
      Alice: total.Alice + current.Alice,
      Bob: total.Bob + current.Bob,
    }));

  const latest = proof[proof.length - 1];
  requireThat(first.outcome.Alice + totalTransferred.Alice === latest.outcome.Alice);
  requireThat(first.outcome.Bob + totalTransferred.Bob === latest.outcome.Bob);

  return true;
}

// Checks that the set of transfers is the same between the first state and the second state
function validateTransferSet(first: SignedState, second: SignedState): boolean {
  requireThat(first.transfers.length === second.transfers.length);

  first.transfers.map((firstTransfer, idx) => {
    const secondTransfer = second.transfers[idx];

    requireThat(firstTransfer.id === secondTransfer.id);
    requireThat(firstTransfer.data === secondTransfer.data);
  });

  return true;
}

function requireThat(predicate: boolean, reason?: string): void {
  if (!predicate) revert(reason ?? 'revert');
}

function revert(reason: string): void {
  throw new Error(reason);
}
