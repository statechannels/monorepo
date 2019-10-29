# 🔌 Channel Provider

This package contains a browser-based loader for the [Embedded Wallet](../embedded-wallet).

It exposes a global object called `channelProvider` that implements the [EIP 1193](https://github.com/ryanio/EIPs/blob/master/EIPS/eip-1193.md) standard.

In the near future, it'll feature-detect if a wallet such as MetaMask has state channels support. If it does, the package does nothing; if it doesn't, it'll plug in the Embedded Wallet into a dApp.

## Usage

Include the `channel-provider.min.js` file in your app via a `script` tag:

```html
<script src="node_modules/@statechannels/channel-provider/dist/channel-provider.min.js"></script>
```

Then, enable the provider, passing on an URL to where is the Embedded Wallet UI hosted.

> _This isn't final behavior. Eventually, the UI will be integrated inside a wallet like MetaMask, and the URL won't be necessary.
> Right now, we need this because of the usage of the `.postMessage()` API + CORS requirements._

```js
window.channelProvider.enable('http://sc-embedded-wallet.netlify.com');
```

### API

| Method                                                                      | Description                                                                                                       |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `enable(url?: string)`                                                      | Configures the dApp to be able to send/receive JSON-RPC messages.                                                 |
| `send<ResultType>(method: string, params?: any[]`): Promise<ResultType>     | Sends a message to the wallet using JSON-RPC and returns the result, if any.                                      |
| `subscribe(subscriptionType: string, callback?: Function): Promise<string>` | Allows to subscribe to an event feed, returns a `subscriptionId` that can be used later with `.on()` or `.off()`. |
| `unsubscribe(subscriptionId: string)`                                       | Removes all event listeners tied to a given `subscriptionId` and stops listening events on the requested feed.    |
| `on(eventNameOrSubscriptionId: string, callback?: Function): void`          | Allows to register events or to listen for a subscription by its ID.                                              |
| `off(eventNameOrSubscriptionId: string, callback?: Function): void`         | Allows to unregister events or to stop listening for a subscription by its ID.                                    |
