type Proof = SignedState[];

type Peer = 'Alice' | 'Bob' | 'Indigo' | 'Irene' | 'Ivy';

type EmbeddedSupportProof = any;

type SignedState = {
  signedby(...peers: Peer[]): boolean;
  type: 'None' | 'A' | 'B' | 'AB';
  turnNum: number;
  participants: ['Alice', 'Indigo', 'Irene', 'Ivy', 'Bob'];

  // app data
  hash: string;
  signatures?: [string, string];
  appSupportProof?: EmbeddedSupportProof;
};

/**
 * @param proof support proof of 4 or 5 signed states
 * @returns boolean
 * (For readability, this is specific to 3 intermediaries, but it is easy to see
 * how to generalize it.)
 *
 * This is an implementation of a joint channel between five peers,
 * 0: Alice
 * 1: Indigo
 * 2: Irene
 * 3: Ivy
 * 4: Bob
 *
 * It enables Alice & Bob to virtually fund an embedded app channel X, achieving TTP=2.
 *
 * This allows these state transitions:
 *      AB
 *      ^^
 *     /  \
 *   A      B
 *   ^      ^
 *    \    /
 *     None <--
 *      |     | (3 times)
 *       _____|
 *
 * In the happy path, Alice through Ivy sign a state with turn number equal to their
 * index. This state includes a special hash in its app data, which is the hash of
 * a ledger update that adds a guarantee.
 *
 * Turn 4 state can be signed by either Alice (moving to an A state) or Bob
 * (moving to a B state) by providing a valid support proof for X. Note that Bob
 * doesn't need to explicitly sign a state in the joint channel -- his signature in
 * the support proof for X can be used as implicit support for the outcome in J.
 *
 * The turn 4 state must reveal two signatures for each hash provided in states 0,1,2,3.
 * This creates a dichotomy:
 * - either a support proof for J is provided, allowing all guarantees can be claimed
 * - or, no support proof for J is provided, meaning all guarantees turn into refunds
 *
 * Likewise, from a B state, Alice can move to an AB state by providing a superior
 * support proof. This enables TTP=2 in a bi-directional virtually funded channel
 * among `N` intermediaries.
 *
 * The support proof for X from the last state provided is used to update Alice & Bob's
 * outcome in the joint channel. Irene's balance should be invariant.
 */
export function validSupport(proof: Proof): boolean {
  const [j0, j1, j2, j3, j4, j5] = proof;

  [j0, j1, j2, j3].map((state, idx) => {
    requireThat(state.type === 'None');
    requireThat(state.turnNum === idx);
    requireThat(state.signedby(state.participants[idx]));
  });

  requireThat(j4.turnNum === 4);

  // OPTIONAL: The following logic is only required to enables bidirectional embedded app channels.
  // Either Alice or Bob can sign state 4!
  requireThat(j4.type === 'A' || j4.type === 'B');
  if (j4.type === 'A') {
    requireThat(j4.signedby('Alice'));
  } else {
    requireThat(j4.signedby('Bob'));
  }
  // For unidirectional embedded app channels, the logic would be:
  // requireThat(j4.signedby('Bob'));
  //
  // END OF OPTIONAL LOGIC

  requireThat(j4.appSupportProof && j4.appSupportProof.isValid());

  [0, 1, 2, 3].map(i => {
    const hash = proof[i].hash;
    const [sig1, sig2] = j4.signatures![i];

    requireThat(recoverSigner(hash, sig1) === j0.participants[i]);
    requireThat(recoverSigner(hash, sig2) === j0.participants[i + 1]);
  });

  // OPTIONAL: The following logic is only required to enables bidirectional embedded app channels.
  // QUESTION: if it's not bi-directional, do Vector-style transfers make more sense? They are much simpler!
  // In case Alice provided j4, Bob can provide a j5 with a greater support proof.
  // In case Bob provided j4, Alice can provide a j5 with a greater support proof.

  if (j5) {
    requireThat(j5.type === 'AB');

    // The "other" peer gets one chance to provide a greater support proof.
    if (j4.type === 'A') {
      requireThat(j5.signedby('Bob'));
    } else {
      requireThat(j5.signedby('Alice'));
    }

    requireThat(j5.appSupportProof && j5.appSupportProof.isValid());
    requireThat(j5.appSupportProof.turnNum >= j4.appSupportProof.turnNum);
  }
  // END OF OPTIONAL LOGIC

  const last = j5 ?? j4;

  requireThat(balancesAreCorrect(j0, last));

  return true;
}

function balancesAreCorrect(first: SignedState, last: SignedState): boolean {
  const _appChannelOutcome = last.appSupportProof.outcome;

  // require that the difference between the first state's outcome and last state's outcome matches up
  // with the provided app channel outcome
  return true;
}

function recoverSigner(data: string, signature: string): Peer {
  throw 'unimplemented';
}

function requireThat(predicate: boolean): void {
  if (!predicate) revert('Revert');
}

function revert(reason: string): void {
  throw new Error(reason);
}
