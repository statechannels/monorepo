import React from 'react';
import {FormButton} from '../../form';

import {Link, useHistory} from 'react-router-dom';
import {RoutePath} from '../../../routes';

import './LayoutHeader.scss';

export const LayoutHeader: React.FC = () => {
  const history = useHistory();
  return (
    <header className="header">
      <nav className="header-content">
        <Link className="header-logo" to={RoutePath.Root}>
          <span className="header-logo-hidden">Web3Torrent Logo - Go to Home</span>
        </Link>
        <div className="actions-container">
          <FormButton
            name="budgets"
            onClick={() => {
              if (history.location.pathname === RoutePath.Budgets) {
                history.goBack();
              } else {
                history.push(RoutePath.Budgets);
              }
            }}
          >
            {history.location.pathname === RoutePath.Budgets ? 'Back' : 'Your budget'}
          </FormButton>
          <FormButton name="upload" onClick={() => history.push(RoutePath.Upload)}>
            Upload
          </FormButton>
        </div>
      </nav>
    </header>
  );
};
