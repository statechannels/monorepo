import debug from 'debug';
import React, {Dispatch, SetStateAction, useEffect, useState} from 'react';
import {Redirect, RouteComponentProps} from 'react-router';
import {OnboardingFlowPaths, useOnboardingFlowContext} from '../../flows';
import {closeWallet} from '../../message-dispatchers';
import {Dialog, Slider} from '../../ui';
const log = debug('wallet:budget-allocation');

const allow = (amountToAllocate: number, useRedirect: Dispatch<SetStateAction<boolean>>) => () => {
  log("`Allow` clicked: I'll allow it, with %o ETH", amountToAllocate);
  log('Handing off to NoHub');
  useRedirect(true);
};

const reject = () => {
  log('`Reject` clicked: You shall not pass.');
  closeWallet();
};

const BudgetAllocation: React.FC<RouteComponentProps> = () => {
  const [amountToAllocate, setAmountToAllocate] = useState<number>(0.2);
  const [redirect, useRedirect] = useState<boolean>(false);
  const onboardingFlowContext = useOnboardingFlowContext();

  useEffect(() => {
    log('Initiated flow step with request %o', onboardingFlowContext.request);
  }, [onboardingFlowContext.request]);

  return (
    <Dialog
      title="statechannels.com want to allocate"
      onClose={closeWallet}
      buttons={{
        primary: {
          label: `Allow ${amountToAllocate} ETH`,
          onClick: allow(amountToAllocate, useRedirect)
        },
        secondary: {label: 'Reject', onClick: reject}
      }}
    >
      {redirect ? <Redirect to={OnboardingFlowPaths.NoHub} /> : null}
      <div>
        Recommended amount: <strong>0.2 ETH</strong> of your send.
      </div>
      <Slider
        initialValue={0.2}
        min={0}
        max={2}
        unit="ETH"
        step={0.01}
        onChange={setAmountToAllocate}
      />
    </Dialog>
  );
};

export {BudgetAllocation};
