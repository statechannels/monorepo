import {
  ChannelProposedNotification,
  ChannelUpdatedNotification,
  ChannelClosingNotification,
  MessageQueuedNotification,
  BudgetUpdatedNotification,
  UiNotification
} from '../../../notifications';
import {ChannelResult, DomainBudget} from '../../../data-types';

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
const channelProposed: ChannelProposedNotification = {
  jsonrpc: '2.0',
  method: 'ChannelProposed',
  params: channelResult
};

const channelUpdated: ChannelUpdatedNotification = {
  jsonrpc: '2.0',
  method: 'ChannelUpdated',
  params: channelResult
};

const channelClosing: ChannelClosingNotification = {
  jsonrpc: '2.0',
  method: 'ChannelClosed',
  params: channelResult
};

const message = {
  data: {
    participants: [
      {
        destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7',
        participantId: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
        signingAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0'
      },
      {
        destination: '0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7',
        participantId: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
        signingAddress: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0'
      }
    ],
    signedState: {
      signature: {
        r: '0x733ccfc3b0b13b446de290a9b056a5b9d7eb1538c1d48f8b863f731a0ea522c4',
        recoveryParam: 1,
        s: '0x6ad30427d0859d782c98ccdc5fe10fc9c3d6480ee5080f70fd96128e4d61d507',
        v: 28
      },
      state: {
        appData:
          '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004444444444444444444444444444444444444444444444444444444444444444',
        appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
        challengeDuration: 300,
        channel: {
          chainId: '0x2329',
          channelNonce: '0x11b1a311d845ca99f8e3c9a5f828f574b1afe2c3a0eb8cd51115dff18f0f34a0',
          participants: [
            '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
            '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0'
          ]
        },
        isFinal: false,
        outcome: [
          {
            allocationItems: [
              {
                amount: '0x06f05b59d3b20000',
                destination: '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
              },
              {
                amount: '0x06f05b59d3b20000',
                destination: '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
              }
            ],
            asset: '0x4ad3F07BEFDC54511449A1f553E36A653c82eA57'
          }
        ],
        turnNum: 0
      }
    },
    type: 'Channel.Open'
  },
  recipient: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
  sender: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0'
};

const messageQueued: MessageQueuedNotification = {
  jsonrpc: '2.0',
  method: 'MessageQueued',
  params: message
};
const budget: DomainBudget = {
  domain: 'www.somewhere.com',
  hubAddress: '0x00',
  budgets: []
};
const budgetUpdated: BudgetUpdatedNotification = {
  jsonrpc: '2.0',
  method: 'BudgetUpdated',
  params: budget
};
const uIUpdate: UiNotification = {
  jsonrpc: '2.0',
  method: 'UIUpdate',
  params: {
    showWallet: true
  }
};
export const goodNotifications = [
  channelProposed,
  channelUpdated,
  channelClosing,
  messageQueued,
  budgetUpdated,
  uIUpdate
];
