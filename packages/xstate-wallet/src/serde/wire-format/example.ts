import {bigNumberify} from 'ethers/utils';
import {Message} from '../../store/types';
import {Message as WireMessage} from '@statechannels/wire-format';
import {makeDestination} from '../../utils/outcome';

export const wireStateFormat = {
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
  appData:
    '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004444444444444444444444444444444444444444444444444444444444444444',
  appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
  challengeDuration: '0x00000000000000000000000000000000000000000000000000000000000004a0',
  channelId: '0x9afc73af1808170a4ee408649219ee8322957645e40e227cb1ea29ea98034699',
  chainId: '0x2329',
  channelNonce: '0x11b1a311d845ca99f8e3c9a5f828f574b1afe2c3a0eb8cd51115dff18f0f34a0',
  isFinal: false,
  outcome: [
    {
      allocationItems: [
        {
          amount: '0x00000000000000000000000000000000000000000000000006f05b59d3b20000',
          destination: '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
        },
        {
          amount: '0x00000000000000000000000000000000000000000000000006f05b59d3b20000',
          destination: '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
        }
      ],
      assetHolderAddress: '0x4ad3F07BEFDC54511449A1f553E36A653c82eA57'
    }
  ],
  turnNum: '0x0000000000000000000000000000000000000000000000000000000000000001',
  signatures: [
    '0x733ccfc3b0b13b446de290a9b056a5b9d7eb1538c1d48f8b863f731a0ea522c46ad30427d0859d782c98ccdc5fe10fc9c3d6480ee5080f70fd96128e4d61d50728'
  ]
};

export const internalStateFormat = {
  participants: [
    {
      destination: makeDestination('0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'),
      participantId: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
      signingAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0'
    },
    {
      destination: makeDestination('0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'),
      participantId: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
      signingAddress: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0'
    }
  ],
  appData:
    '0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016345785d8a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004444444444444444444444444444444444444444444444444444444444444444',
  appDefinition: '0x430869383d611bBB1ce7Ca207024E7901bC26b40',
  challengeDuration: bigNumberify(
    '0x00000000000000000000000000000000000000000000000000000000000004a0'
  ),
  chainId: '0x2329',
  channelNonce: bigNumberify('0x11b1a311d845ca99f8e3c9a5f828f574b1afe2c3a0eb8cd51115dff18f0f34a0'),
  isFinal: false,
  outcome: {
    type: 'SimpleAllocation' as 'SimpleAllocation',
    assetHolderAddress: '0x4ad3F07BEFDC54511449A1f553E36A653c82eA57',
    allocationItems: [
      {
        amount: bigNumberify('0x00000000000000000000000000000000000000000000000006f05b59d3b20000'),
        destination: makeDestination(
          '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
        )
      },
      {
        amount: bigNumberify('0x00000000000000000000000000000000000000000000000006f05b59d3b20000'),
        destination: makeDestination(
          '0x00000000000000000000000063e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'
        )
      }
    ]
  },
  turnNum: bigNumberify('0x0000000000000000000000000000000000000000000000000000000000000001'),
  signatures: [
    '0x733ccfc3b0b13b446de290a9b056a5b9d7eb1538c1d48f8b863f731a0ea522c46ad30427d0859d782c98ccdc5fe10fc9c3d6480ee5080f70fd96128e4d61d50728'
  ]
};
export const wireMessageFormat: WireMessage = {
  recipient: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
  sender: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
  data: {
    signedStates: [wireStateFormat],
    objectives: [
      {
        type: 'OpenChannel',
        data: {
          targetChannelId: '0x9afc73af1808170a4ee408649219ee8322957645e40e227cb1ea29ea98034699'
        },
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
        ]
      }
    ]
  }
};

export const internalMessageFormat: Message = {
  signedStates: [internalStateFormat],
  objectives: [
    {
      type: 'OpenChannel',
      data: {targetChannelId: '0x9afc73af1808170a4ee408649219ee8322957645e40e227cb1ea29ea98034699'},
      participants: [
        {
          destination: makeDestination('0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'),
          participantId: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0',
          signingAddress: '0xAE363d29fc0f6A9bbBbEcC87751e518Cd9CA83C0'
        },
        {
          destination: makeDestination('0x63e3fb11830c01ac7c9c64091c14bb6cbaac9ac7'),
          participantId: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0',
          signingAddress: '0x590A3Bd8D4A3b78411B3bDFb481E44e85C7345c0'
        }
      ]
    }
  ]
};
