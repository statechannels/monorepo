type Proof = SignedState[];

type Peer = 'Alice' | 'Bob' | 'Indigo' | 'Irene' | 'Ivy';

type EmbeddedSupportProof = any;

type SignedState = {
  signedby(...peers: Peer[]): boolean;
  type: 'Setup' | 'Resolved';
  turnNum: number;
  participants: ['Alice', 'Indigo', 'Irene', 'Ivy', 'Bob'];

  // app data
  hash: string;
  signatures?: [string, string];
  appSupportProof?: EmbeddedSupportProof;
};

/**
 * @param proof support proof of 4
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
 *    --> Setup -> Resolved
 *   |     |
 *   |     | (3 times)
 *   |_____|
 *
 * In the happy path, Alice through Ivy sign a state with turn number equal to their
 * index. This state includes a special hash in its app data, which is the hash of
 * a ledger update that adds a guarantee.
 *
 * Turn 4 state is signed by Bob, and must include a support proof for X.
 * The turn 4 state must also reveal two signatures for each hash provided in states
 * 0,1,2,3. This creates a dichotomy:
 * - either a support proof for J is provided, allowing all guarantees can be claimed
 * - or, no support proof for J is provided, meaning all guarantees turn into refunds
 *
 * The support proof for X from the last state provided is used to update Alice & Bob's
 * outcome in the joint channel. As X is a unidirectional channel, Bob is incentivized
 * to provide the latest support proof he's aware of.
 *
 * The intermediary balances should be invariant.
 */
export function validSupport(proof: Proof): boolean {
  const [j0, j1, j2, j3, j4] = proof;

  [j0, j1, j2, j3].map((state, idx) => {
    requireThat(state.type === 'Setup');
    requireThat(state.turnNum === idx);
    requireThat(state.signedby(state.participants[idx]));
  });

  requireThat(j4.turnNum === 4);
  requireThat(j4.type === 'Resolved');
  requireThat(j4.signedby('Bob'));
  requireThat(j4.appSupportProof && j4.appSupportProof.isValid());

  [0, 1, 2, 3].map(i => {
    const hash = proof[i].hash;
    const [sig1, sig2] = j4.signatures![i];

    requireThat(recoverSigner(hash, sig1) === j0.participants[i]);
    requireThat(recoverSigner(hash, sig2) === j0.participants[i + 1]);
  });

  requireThat(balancesAreCorrect(j0, j4));

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
