const createChannel = {
  jsonrpc: '2.0',
  id: 1581594378830,
  method: 'CreateChannel',
  params: {
    participants: [
      {
        participantId: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
        signingAddress: '0xAE363d29fc0f6A9bbB3C0',
        destination: '0x63e3faac9ac7'
      },
      {
        participantId: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
        signingAddress: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
        destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
      }
    ],
    allocations: [
      {
        asset: '0x0000000000000000000000000000000000000000',
        allocationItems: [
          {
            destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7',
            amount: '0x06f05b59d3b20000'
          },
          {
            destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7',
            amount: '0x06f05b59d3b20000'
          }
        ]
      }
    ],
    appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
    appData:
      '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004444444444444444444444444444444444444444444444444444444444444444'
  }
};

const closeChannel = {
  jsonrpc: '2.0',
  id: 1581594323759,
  method: 'CloseChannel',
  params: {
    channelId: '0x430869383d611bBB1ce7Ca207024E7901bC26b40'
  }
};

export const badRequests = [createChannel, closeChannel];
