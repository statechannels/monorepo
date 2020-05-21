import _, {Dictionary} from 'lodash';
import prettier from 'prettier-bytes';
import React, {useContext} from 'react';
import {ChannelState} from '../../../clients/payment-channel-client';
import './ChannelsList.scss';
import {prettyPrintWei, prettyPrintBytes} from '../../../utils/calculateWei';
import {utils} from 'ethers';
import {TorrentUI} from '../../../types';
import {Blockie, Tooltip} from 'rimble-ui';
import {Badge, Avatar} from '@material-ui/core';

type UploadInfoProps = {
  torrent: TorrentUI;
  channels: Dictionary<ChannelState>;
  mySigningAddress: string;
};

function channelIdToTableRow(
  channelId: string,
  channels: Dictionary<ChannelState>,
  torrent: TorrentUI,
  participantType: 'payer' | 'beneficiary'
  // Challenging doesn't work in virtual channels: https://github.com/statechannels/monorepo/issues/1773
  // clickHandler: (string) => Promise<ChannelState>
) {
  // let channelButton;
  const channel = channels[channelId];
  const isBeneficiary = participantType === 'beneficiary';
  const wire = torrent.wires.find(
    wire =>
      wire.paidStreamingExtension.leechingChannelId === channelId ||
      wire.paidStreamingExtension.seedingChannelId === channelId
  );
  // if (channel.status === 'closing') {
  //   channelButton = <button disabled>Closing ...</button>;
  // } else if (channel.status === 'closed') {
  //   channelButton = <button disabled>Closed</button>;
  // } else if (channel.status === 'challenging') {
  //   channelButton = <button disabled>Challenging</button>;
  // } else {
  //   channelButton = getPeerStatus(torrent, wire) ? <button disabled>Running</button> : null;
  // Challenging doesn't work in virtual channels: https://github.com/statechannels/monorepo/issues/1773
  // (
  //   <button className="button-alt" onClick={() => clickHandler(channelId)}>
  //     Challenge Channel
  //   </button>
  // );
  // }

  let dataTransferred: string;
  // const peerAccount = isBeneficiary ? channel['payer'] : channel['beneficiary']; // If I am the payer, my peer is the beneficiary and vice versa
  const peerOutcomeAddress = isBeneficiary
    ? channel.payerOutcomeAddress
    : channel.beneficiaryOutcomeAddress;

  const peerSelectedAddress = '0x' + peerOutcomeAddress.slice(26).toLowerCase();
  // For now, this ^ is the ethereum address in my peer's metamask

  if (wire) {
    dataTransferred = isBeneficiary ? prettier(wire.uploaded) : prettier(wire.downloaded);
  } else {
    // Use the beneficiery balance as an approximate of the file size, when wire is dropped.
    dataTransferred = prettyPrintBytes(utils.bigNumberify(channel.beneficiaryBalance));
  }

  const weiTransferred = prettyPrintWei(utils.bigNumberify(channel.beneficiaryBalance));

  return (
    <tr className="peerInfo" key={channelId}>
      <td className="channel">
        <button disabled>{channel.status}</button>
        {/* temporal thing to show the true state instead of a parsed one */}
      </td>
      <td className="peer-id">
        <Tooltip message={peerSelectedAddress}>
          <Badge
            badgeContent={
              channel.turnNum.toNumber() > 3 ? Math.trunc(channel.turnNum.toNumber() / 2) : 0
            }
            color={isBeneficiary ? 'primary' : 'error'}
            overlap={'circle'}
            showZero={false}
            max={999}
          >
            <Avatar>
              <Blockie
                opts={{
                  seed: peerSelectedAddress,
                  color: '#2728e2',
                  bgcolor: '#46A5D0',
                  size: 15,
                  scale: 3,
                  spotcolor: '#000'
                }}
              />
            </Avatar>
          </Badge>
        </Tooltip>
      </td>
      <td className="transferred">
        {dataTransferred + ' '}
        <i className={isBeneficiary ? 'up' : 'down'}></i>
      </td>
      {isBeneficiary ? (
        <td className="earned">{weiTransferred}</td>
      ) : (
        <td className="paid">-{weiTransferred}</td>
      )}
    </tr>
  );
}

export const ChannelsList: React.FC<UploadInfoProps> = ({torrent, channels, mySigningAddress}) => {
  const channelsInfo = _.keys(channels)
    .filter(
      id => channels[id].payer === mySigningAddress || channels[id].beneficiary === mySigningAddress
    )
    .sort((id1, id2) => Number(id1) - Number(id2));
  return (
    <section className="wires-list">
      <table className="wires-list-table">
        {channelsInfo.length > 0 && (
          <thead>
            <tr className="peerInfo">
              <td>Status</td>
              <td>Peer</td>
              <td>Data</td>
              <td>Funds</td>
            </tr>
          </thead>
        )}
        <tbody>
          {channelsInfo.map(key =>
            channelIdToTableRow(
              key,
              channels,
              torrent,
              channels[key].beneficiary === mySigningAddress ? 'beneficiary' : 'payer'
              // Challenging doesn't work in virtual channels: https://github.com/statechannels/monorepo/issues/1773
              // ,context.paymentChannelClient.challengeChannel
            )
          )}
        </tbody>
      </table>
    </section>
  );
};
