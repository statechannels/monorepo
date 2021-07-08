---
id: quick-start
title: Quick Start
---

## Add precompiled contracts to your project

To get started with the nitro contracts, we recommend you install the @statechannels/nitro-protocol package using your favourite node package manager:

```console
> yarn add @statechannels/nitro-protocol
```

You can import precompiled contract artifacts into your project like this:

```javascript
const {NitroAdjudicatorArtifact} = require('@statechannels/nitro-protocol').ContractArtifacts;
```

## Deploy contract artifacts

We recommend that you deploy these artifacts to a local blockchain in order to connect and interact with them. Your deployment code might look something like this:

```javascript
const {
  NitroAdjudicatorArtifact,
  TrivialAppArtifact
} = require('@statechannels/nitro-protocol').ContractArtifacts;

const {GanacheDeployer} = require('@statechannels/devtools');

const deploy = async () => {
  const deployer = new GanacheDeployer(Number(process.env.GANACHE_PORT));

  const NITRO_ADJUDICATOR_ADDRESS = await deployer.deploy(NitroAdjudicatorArtifact);
  const TRIVIAL_APP_ADDRESS = await deployer.deploy(TrivialAppArtifact);

  return {
    NITRO_ADJUDICATOR_ADDRESS,
    TRIVIAL_APP_ADDRESS
  };
};

module.exports = {
  deploy
};
```
