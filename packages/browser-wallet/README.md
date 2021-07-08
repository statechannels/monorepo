# 🌐 Browser wallet

State channels wallet.

Currently, an application should run this wallet inside an iFrame and communicate with it via @statechannels/[iframe-channel-provider](https://www.npmjs.com/package/@statechannels/iframe-channel-provider) and [@statechannels/channel-client](https://www.npmjs.com/package/@statechannels/channel-client).

See https://docs.statechannels.org

[![Netlify Status](https://api.netlify.com/api/v1/badges/fe975674-cea9-44ed-b9f4-685c03d9f17c/deploy-status)](https://app.netlify.com/sites/xstate-wallet/deploys)

## Configurable Environment Variables

| Variable                  | Possible Values        | Description                                                      |
| ------------------------- | ---------------------- | ---------------------------------------------------------------- |
| LOG_DESTINATION           | "console", a file name | When running tests, use `console.log` or to a file               |
| USE_INDEXED_DB            | empty, or truthy value | If truthy, uses IndexedDB in the browser and in-memory otherwise |
| CLEAR_STORAGE_ON_START    | empty, or truthy value | If truthy, clears any data in the store before start             |
| NITRO_ADJUDICATOR_ADDRESS | address                | Address of NitroAdjudicator contract on-chain                    |
| HUB_ADDRESS               | address                | Signing address of firebase:simple-hub participant               |
| HUB_DESTINATION           | empty or bytes32       | Destination of firebase:simple-hub participant                   |
| CHAIN_NETWORK_ID          | string or integer      | Chain identifier e.g., 3 for Ropsten                             |

### Why are webpack loaders in `dependencies`?

Currently the [`e2e-tests`](http://github.com/statechannels/apps/blob/master/packages/e2e-tests) package relies on `xstate-wallet` to run. Since we use environment variables as configuration options, and these are baked into the webpack builds at compile-time, we instead distribute the entire webpack dev server environment over `npm` to simplify things. We should move configuration options to be something declared at runtime.
