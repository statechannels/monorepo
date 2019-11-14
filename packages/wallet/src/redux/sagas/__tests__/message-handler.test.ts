import {messageHandler} from "../message-handler";
import * as walletStates from "../../state";
import {addressResponse} from "../../actions";
import {expectSaga} from "redux-saga-test-plan";
import {Wallet} from "ethers";
import {messageSender} from "../message-sender";
import * as matchers from "redux-saga-test-plan/matchers";
import {getAddress} from "../../selectors";
import {asAddress, bsAddress} from "../../__tests__/state-helpers";
import {getProvider} from "../../../utils/contract-utils";
describe("message listener", () => {
  const wallet = Wallet.createRandom();
  const initialState = walletStates.initialized({
    ...walletStates.EMPTY_SHARED_DATA,

    processStore: {},
    channelSubscriptions: {},
    privateKey: wallet.privateKey,
    address: wallet.address
  });

  it("handles an address request", () => {
    const requestMessage = JSON.stringify({
      jsonrpc: "2.0",
      method: "GetAddress",
      id: 1,
      params: {}
    });

    return (
      expectSaga(messageHandler, requestMessage, "localhost")
        .withState(initialState)
        // Mock out the fork call so we don't actually try to post the message
        .provide([[matchers.fork.fn(messageSender), 0]])
        .fork(messageSender, addressResponse({id: 1, address: wallet.address}))
        .run()
    );
  });
  describe("CreateChannel", () => {
    it("handles a create channel request", async () => {
      const destinationA = Wallet.createRandom().address;
      const signingAddressA = asAddress;
      const signingAddressB = bsAddress;
      const destinationB = Wallet.createRandom().address;
      const appDefinition = Wallet.createRandom().address;
      const appData = "0x0";
      const participants = [
        {
          participantId: "user-a",
          signingAddress: signingAddressA,
          destination: destinationA
        },
        {
          participantId: "user-b",
          signingAddress: signingAddressB,
          destination: destinationB
        }
      ];
      const allocations = [
        {
          token: "0x0",
          allocationItems: [
            {destination: destinationA, amount: "12"},
            {destination: destinationB, amount: "12"}
          ]
        }
      ];
      const requestMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "CreateChannel",
        id: 1,
        params: {
          participants,
          allocations,
          appDefinition,
          appData
        }
      });
      const {effects} = await expectSaga(messageHandler, requestMessage, "localhost")
        .withState(initialState)
        // Mock out the fork call so we don't actually try to post the message
        .provide([
          [matchers.fork.fn(messageSender), 0],
          [matchers.select.selector(getAddress), asAddress],
          [
            matchers.call.fn(getProvider),
            {
              getCode: address => {
                return "0x12345";
              }
            }
          ]
        ])
        .run();

      expect(effects.put[1].payload.action).toMatchObject({
        type: "WALLET.APPLICATION.OWN_STATE_RECEIVED",
        state: {
          channel: {participants: [signingAddressA, signingAddressB]},
          outcome: [
            {
              assetHolderAddress: "0x0",
              allocation: [
                {destination: destinationA, amount: "12"},
                {destination: destinationB, amount: "12"}
              ]
            }
          ]
        }
      });

      expect(effects.fork[0].payload.args[0]).toMatchObject({
        type: "WALLET.CREATE_CHANNEL_RESPONSE",
        id: 1,
        channelId: expect.any(String)
      });
    });

    it("returns an error when the contract is not deployed", async () => {
      const destinationA = Wallet.createRandom().address;
      const signingAddressA = Wallet.createRandom().address;
      const signingAddressB = Wallet.createRandom().address;
      const destinationB = Wallet.createRandom().address;
      const appDefinition = Wallet.createRandom().address;
      const appData = "0x0";
      const participants = [
        {
          participantId: "user-a",
          signingAddress: signingAddressA,
          destination: destinationA
        },
        {
          participantId: "user-b",
          signingAddress: signingAddressB,
          destination: destinationB
        }
      ];
      const allocations = [
        {
          token: "0x0",
          allocationItems: [
            {destination: destinationA, amount: "12"},
            {destination: destinationB, amount: "12"}
          ]
        }
      ];
      const requestMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "CreateChannel",
        id: 1,
        params: {
          participants,
          allocations,
          appDefinition,
          appData
        }
      });
      const {effects} = await expectSaga(messageHandler, requestMessage, "localhost")
        .withState(initialState)
        // Mock out the fork call so we don't actually try to post the message
        .provide([
          [matchers.fork.fn(messageSender), 0],
          [matchers.select.selector(getAddress), asAddress],
          [
            matchers.call.fn(getProvider),
            {
              getCode: address => {
                return "0x";
              }
            }
          ]
        ])
        .run();

      expect(effects.fork[0].payload.args[0]).toMatchObject({
        type: "WALLET.NO_CONTRACT_ERROR",
        id: 1
      });
    });
    it("returns an error the first participant does not have our address", async () => {
      const destinationA = Wallet.createRandom().address;
      const signingAddressA = Wallet.createRandom().address;
      const signingAddressB = bsAddress;
      const destinationB = Wallet.createRandom().address;
      const appDefinition = Wallet.createRandom().address;
      const appData = "0x0";
      const participants = [
        {
          participantId: "user-a",
          signingAddress: signingAddressA,
          destination: destinationA
        },
        {
          participantId: "user-b",
          signingAddress: signingAddressB,
          destination: destinationB
        }
      ];
      const allocations = [
        {
          token: "0x0",
          allocationItems: [
            {destination: destinationA, amount: "12"},
            {destination: destinationB, amount: "12"}
          ]
        }
      ];
      const requestMessage = JSON.stringify({
        jsonrpc: "2.0",
        method: "CreateChannel",
        id: 1,
        params: {
          participants,
          allocations,
          appDefinition,
          appData
        }
      });
      const {effects} = await expectSaga(messageHandler, requestMessage, "localhost")
        .withState(initialState)
        // Mock out the fork call so we don't actually try to post the message
        .provide([
          [matchers.fork.fn(messageSender), 0],
          [matchers.select.selector(getAddress), asAddress],
          [
            matchers.call.fn(getProvider),
            {
              getCode: address => {
                return "0x";
              }
            }
          ]
        ])
        .run();

      expect(effects.fork[0].payload.args[0]).toMatchObject({
        type: "WALLET.NO_CONTRACT_ERROR",
        id: 1
      });
    });
  });

  it("handles an update channel request", async () => {
    const destinationA = Wallet.createRandom().address;
    const signingAddressA = Wallet.createRandom().address;
    const signingAddressB = Wallet.createRandom().address;
    const destinationB = Wallet.createRandom().address;

    const appDefinition = Wallet.createRandom().address;
    const appData = "0x0";
    const participants = [
      {
        participantId: "user-a",
        signingAddress: signingAddressA,
        destination: destinationA
      },
      {
        participantId: "user-b",
        signingAddress: signingAddressB,
        destination: destinationB
      }
    ];
    const allocations = [
      {
        token: "0x0",
        allocationItems: [
          {destination: destinationA, amount: "12"},
          {destination: destinationB, amount: "12"}
        ]
      }
    ];

    const testChannelStore = {
      "0xlol": {
        address: "0x",
        privateKey: "0x",
        channelId: "0xlol",
        libraryAddress: appDefinition,
        ourIndex: 0,
        participants,
        channelNonce: "0x",
        turnNum: 0,
        signedStates: [
          {
            state: {
              turnNum: 0,
              isFinal: false,
              channel: {participants: [signingAddressA, signingAddressB]},
              outcome: [
                {
                  assetHolderAddress: "0x0",
                  allocation: [
                    {destination: destinationA, amount: "12"},
                    {destination: destinationB, amount: "12"}
                  ]
                }
              ],
              challengeDuration: 0,
              appDefinition,
              appData: "0x"
            },
            signature: {v: 0, r: "", s: ""}
          }
        ],
        funded: true
      }
    };

    const requestMessage = JSON.stringify({
      jsonrpc: "2.0",
      method: "UpdateChannel",
      id: 1,
      params: {
        channelId: "0xlol",
        allocations,
        appData
      }
    });

    const {effects} = await expectSaga(messageHandler, requestMessage, "localhost")
      .withState({...initialState, channelStore: testChannelStore})
      // Mock out the fork call so we don't actually try to post the message
      .provide([[matchers.fork.fn(messageSender), 0]])
      .run();

    expect(effects.put[0].payload.action).toMatchObject({
      type: "WALLET.APPLICATION.OWN_STATE_RECEIVED",
      state: {
        appData,
        channel: {participants: [signingAddressA, signingAddressB]},
        outcome: [
          {
            assetHolderAddress: "0x0",
            allocation: [
              {destination: destinationA, amount: "12"},
              {destination: destinationB, amount: "12"}
            ]
          }
        ]
      }
    });
  });
});
