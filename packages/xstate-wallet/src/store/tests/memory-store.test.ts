import {bigNumberify, BigNumber} from 'ethers/utils';
import {calculateChannelId, createSignatureEntry} from './../state-utils';
import {ChannelStoreEntry} from '../channel-store-entry';
import {MemoryBackend as Backend} from '../memory-backend';
import {CHAIN_NETWORK_ID, CHALLENGE_DURATION} from '../../config';
import {simpleEthAllocation, makeDestination} from '../../utils';
import {State, Objective} from './../types';
import {Wallet} from 'ethers';
import {Store} from './../store';

const {address: aAddress, privateKey: aPrivateKey} = new Wallet(
  '0x95942b296854c97024ca3145abef8930bf329501b718c0f66d57dba596ff1318'
); // 0x11115FAf6f1BF263e81956F0Cc68aEc8426607cf

const {address: bAddress, privateKey: bPrivateKey} = new Wallet(
  '0xb3ab7b031311fe1764b657a6ae7133f19bac97acd1d7edca9409daa35892e727'
); // 0x2222E21c8019b14dA16235319D34b5Dd83E644A9
const [aDestination, bDestination] = [aAddress, bAddress].map(makeDestination); // for convenience

const outcome = simpleEthAllocation([
  {destination: aDestination, amount: new BigNumber(5)},
  {destination: bDestination, amount: new BigNumber(6)}
]);
const turnNum = bigNumberify(4);
const appData = '0xabc';
const isFinal = false;
const chainId = CHAIN_NETWORK_ID;
const participants = [
  {participantId: 'a', destination: aDestination, signingAddress: aAddress},
  {participantId: 'b', destination: bDestination, signingAddress: bAddress}
];
const stateVars = {outcome, turnNum, appData, isFinal};
const channelNonce = bigNumberify(0);
const appDefinition = '0x5409ED021D9299bf6814279A6A1411A7e866A631';

const challengeDuration = bigNumberify(CHALLENGE_DURATION);
const channelConstants = {chainId, participants, channelNonce, appDefinition, challengeDuration};
const state: State = {...stateVars, ...channelConstants};
const channelId = calculateChannelId(channelConstants);
const signature = createSignatureEntry(state, aPrivateKey);
const signedState = {...state, signatures: [signature]};
const signedStates = [signedState];

const aStore = async (noPrivateKeys = false) => {
  const store = new Store(undefined, new Backend());
  const privateKeys = noPrivateKeys ? undefined : [aPrivateKey];
  await store.initialize(privateKeys, true);
  return store;
};

describe('getAddress', () => {
  it('returns an address', async () => {
    const store = await aStore();
    const address = await store.getAddress();

    expect(address).toEqual(aAddress);
  });
});

describe('channelUpdatedFeed', () => {
  test('it fires when a state with the correct channel id is received', async () => {
    const store = await aStore();
    const outputs: ChannelStoreEntry[] = [];
    store.channelUpdatedFeed(channelId).subscribe(x => {
      outputs.push(x);
    });
    await store.pushMessage({signedStates});

    expect(outputs[0].latest).toMatchObject(state);
  });

  test("it doesn't fire if the channelId doesn't match", async () => {
    const store = await aStore();

    const outputs: ChannelStoreEntry[] = [];
    store.channelUpdatedFeed('a-different-channel-id').subscribe(x => outputs.push(x));
    await store.pushMessage({signedStates});

    expect(outputs).toEqual([]);
  });
});

test('newObjectiveFeed', async () => {
  const objective: Objective = {
    type: 'OpenChannel',
    participants: [],
    data: {targetChannelId: 'foo', fundingStrategy: 'Direct'}
  };

  const store = await aStore();

  const outputs: Objective[] = [];
  store.objectiveFeed.subscribe(x => outputs.push(x));

  await store.pushMessage({objectives: [objective]});
  expect(outputs).toEqual([objective]);

  // doing it twice doesn't change anything
  await store.pushMessage({objectives: [objective]});
  expect(outputs).toEqual([objective]);
});

describe('createChannel', () => {
  it('returns a channel-store-entry', async () => {
    const store = await aStore();

    const firstEntry = await store.createChannel(
      participants,
      challengeDuration,
      stateVars,
      appDefinition
    );

    expect(firstEntry.channelId).toMatch(/0x/);

    const secondEntry = await store.createChannel(
      participants,
      challengeDuration,
      stateVars,
      appDefinition
    );

    expect(firstEntry.channelId).not.toEqual(secondEntry.channelId);
  });

  it("fails if the wallet doesn't hold the private key for any participant", async () => {
    const store = await aStore(true);

    await expect(
      store.createChannel(participants, challengeDuration, stateVars, appDefinition)
    ).rejects.toMatchObject({
      message: "Couldn't find the signing key for any participant in wallet."
    });
  });
});

describe('pushMessage', () => {
  it('stores states', async () => {
    const store = await aStore();
    await store.createChannel(
      signedState.participants,
      signedState.challengeDuration,
      {...signedState, turnNum: bigNumberify(0)},
      signedState.appDefinition
    );

    const nextState = {...state, turnNum: state.turnNum.add(2)};
    await store.pushMessage({
      signedStates: [{...nextState, signatures: [createSignatureEntry(nextState, bPrivateKey)]}]
    });
    expect((await store.getEntry(channelId)).latest).toMatchObject(nextState);
  });

  it('creates a channel if it receives states for a new channel', async () => {
    const store = await aStore();
    await store.pushMessage({signedStates});
    expect(await store.getEntry(channelId)).not.toBeUndefined();
  });
});
