import React from 'react';
import {DomainBudget} from '@statechannels/client-api-schema';
import {ChannelState} from '../../clients/payment-channel-client';
import {prettyPrintWei} from '../../utils/calculateWei';
import {utils} from 'ethers';
import './DomainBudgetTable.scss';
import {track} from '../../analytics';
import {Avatar, Badge} from '@material-ui/core';
import {Blockie, Tooltip} from 'rimble-ui';

const bigNumberify = utils.bigNumberify;

export type DomainBudgetTableProps = {
  channelCache: Record<string, ChannelState>;
  budgetCache: DomainBudget;
  mySigningAddress: string;
  withdraw: () => void;
};

export const DomainBudgetTable: React.FC<DomainBudgetTableProps> = props => {
  const {budgetCache, channelCache, mySigningAddress, withdraw} = props;

  const myPayingChannelIds: string[] = Object.keys(channelCache).filter(
    key => channelCache[key].payer === mySigningAddress
  );
  const myReceivingChannelIds: string[] = Object.keys(channelCache).filter(
    key => channelCache[key].beneficiary === mySigningAddress
  );

  const spent = myPayingChannelIds
    .map(id => channelCache[id].beneficiaryBalance)
    .reduce((a, b) => bigNumberify(a).add(bigNumberify(b)), bigNumberify(0));

  const received = myReceivingChannelIds
    .map(id => channelCache[id].beneficiaryBalance)
    .reduce((a, b) => bigNumberify(a).add(bigNumberify(b)), bigNumberify(0));

  const spendBudget = bigNumberify(budgetCache.budgets[0].availableSendCapacity);

  const receiveBudget = bigNumberify(budgetCache.budgets[0].availableReceiveCapacity);

  return (
    <>
      <table className="domain-budget-table">
        <thead>
          <tr className="budget-info">
            <td className="budget-button">Wallet Action</td>
            <td className="budget-identity">Identity</td>
            <td className="budget-number"> Spent / Budget </td>
            <td className="budget-number"> Earned / Budget </td>
          </tr>
        </thead>
        <tbody>
          <tr className="budget-info">
            <td className="budget-button">
              <button
                id="budget-withdraw"
                onClick={() => {
                  track('Withdraw Initiated', {spent, received, spendBudget, receiveBudget});
                  withdraw();
                }}
              >
                Withdraw
              </button>
            </td>
            <td className="budget-identity">
              <span>
                <Tooltip message={window.channelProvider.selectedAddress}>
                  <Badge badgeContent={0} overlap={'circle'} showZero={false} max={999}>
                    <Avatar>
                      <Blockie
                        opts={{
                          seed: window.channelProvider.selectedAddress,
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
              </span>
            </td>
            <td className="budget-sent">
              {' '}
              {`${prettyPrintWei(spent)} / ${prettyPrintWei(spendBudget)}`}{' '}
            </td>
            <td className="budget-received">
              {' '}
              {`${prettyPrintWei(received)} / ${prettyPrintWei(receiveBudget)}`}{' '}
            </td>
          </tr>
        </tbody>
      </table>
    </>
  );
};
