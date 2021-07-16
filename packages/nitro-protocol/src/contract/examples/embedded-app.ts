type Proof = SignedState[];
type EmbeddedSupportProof = any;

type Peer = 'Alice' | 'Bob' | 'Irene';
type SignedState = {
  signedby(...peers: Peer[]): boolean;
  type: 'None' | 'A' | 'B' | 'AB';
  supportProof?: EmbeddedSupportProof;
};

/**
 * @param proof support proof of 1, 2 or 3 signed states
 * @returns boolean
 *
 * This is an implementation of a joint channel between three peers,
 * - Alice
 * - Bob
 * - Irene, the intermediary
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
 * In the happy path, peers doubly sign None states, which sets up an embedded app
 * channel X. Irene does not need to know anything about X.
 *
 * In the sad path, Alice & Bob can force a transition, providing a support proof for
 * the embedded app X. Alice does so by moving to an A state; Bob by moving to a B
 * state. The other peer is then allowed to force a transition to an AB state, allowing
 * them to provide a superior support proof for X.
 *
 * The support proof for X from the last state provided is used to update Alice & Bob's
 * outcome in the joint channel. Irene's balance should be invariant.
 */
export function validSupport(proof: Proof): boolean {
  const [first, second, third] = proof;
  requireThat(first.type === 'None');

  if (proof.length === 1) {
    requireThat(first.signedby('Alice', 'Bob', 'Irene'));
  } else if (proof.length === 2) {
    // None -> A or None -> B are allowed
    requireThat(second.type === 'A' || second.type === 'B');
    if (second.type === 'A') {
      requireThat(first.signedby('Bob', 'Irene'));
      requireThat(second.signedby('Alice'));
    } else if (second.type === 'B') {
      requireThat(first.signedby('Alice', 'Irene'));
      requireThat(second.signedby('Bob'));
    } else {
      revert('Invalid second state -- expecting A or B');
    }

    requireThat(validTransition(first, second));
  } else if (proof.length === 3) {
    if (second.type === 'A') {
      requireThat(first.signedby('Irene'));
      requireThat(second.signedby('Alice'));
      requireThat(third.signedby('Bob'));
    } else if (second.type === 'B') {
      requireThat(first.signedby('Irene'));
      requireThat(second.signedby('Bob'));
      requireThat(third.signedby('Alice'));
    } else {
      revert('Invalid second state -- expecting A or B');
    }

    requireThat(third.type === 'AB');

    requireThat(validTransition(first, second));
    requireThat(validTransition(second, third));
  } else {
    revert('Invalid proof length -- expecting at most three states');
  }

  return true;
}

function validTransition(_first: SignedState, _second: SignedState): boolean {
  // Check that
  // - the embedded app's support proof is valid for both states
  // - the embeddeded turn number is larger in _second than in _first
  // - Irene's funds are invariant
  // - The channel's total funds are invariant.
  // - Alice & Bob's funds are updated according to outcome

  return true;
}

function requireThat(predicate: boolean): void {
  if (!predicate) revert('Revert');
}

function revert(reason: string): void {
  throw new Error(reason);
}
