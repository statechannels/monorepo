import {StateChannelsResponse, ChannelResult, DomainBudget} from '../../../../lib/src';

const channelResult: ChannelResult = {
  channelId: '0x697ecf681033a2514ed19c90299a67ae8677f3c78b5877fe4550c4f0960e87b7',
  status: 'proposed',
  turnNum: 0,
  participants: [
    {
      participantId: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
      signingAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
      destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
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
          amount: '0x00000000000000000000000000000000000000000000000006f05b59d3b20000'
        },
        {
          destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7',
          amount: '0x00000000000000000000000000000000000000000000000006f05b59d3b20000'
        }
      ]
    }
  ],
  appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
  appData:
    '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004444444444444444444444444444444444444444444444444444444444444444',
  fundingStatus: 'Uncategorized',
  adjudicatorStatus: 'Open'
};
const budget: DomainBudget = {
  domain: 'www.somewhere.com',
  hubAddress: '0x00',
  budgets: []
};

export const goodResponses: StateChannelsResponse[] = [
  {
    jsonrpc: '2.0',
    id: 1581594378830,
    result: channelResult
  },
  {
    jsonrpc: '2.0',
    id: 2581594378830,
    result: [channelResult, channelResult]
  },
  {
    jsonrpc: '2.0',
    id: 1581594378831,
    result: budget
  },
  {
    jsonrpc: '2.0',
    id: 1581594378832,
    result: {success: true}
  },
  {
    jsonrpc: '2.0',
    id: 1581594378833,
    result: {
      signingAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
      destinationAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
      walletVersion: 'five'
    }
  },
  {
    jsonrpc: '2.0',
    id: 1581594378833,
    result: {}
  }
];
