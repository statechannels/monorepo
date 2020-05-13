import {web3torrent} from '../clients/web3torrent-client';
import {INITIAL_BUDGET_AMOUNT} from '../constants';
import {useState, useEffect} from 'react';
import {DomainBudget} from '@statechannels/client-api-schema';

export function useBudget({ready}: {ready: boolean}) {
  const {paymentChannelClient} = web3torrent;

  const [budget, setBudget] = useState<DomainBudget>(undefined);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const getAndSetBudget = async () => {
      const budget = await paymentChannelClient.getBudget();

      setBudget(budget);
      setLoading(false);
    };
    if (ready) getAndSetBudget();
  }, [ready, paymentChannelClient]);

  const createBudget = async () => {
    setLoading(true);
    await paymentChannelClient.createBudget(INITIAL_BUDGET_AMOUNT);
    setBudget(paymentChannelClient.budgetCache);
    setLoading(false);
  };

  const closeBudget = async () => {
    setLoading(true);
    await paymentChannelClient.closeAndWithdraw();
    setBudget(paymentChannelClient.budgetCache);
    setLoading(false);
  };

  return {budget, loading, createBudget, closeBudget};
}
