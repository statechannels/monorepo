import React from 'react';
import {RouteComponentProps} from 'react-router-dom';
import {FormButton} from '../../components/form';
import {ShareList} from '../../components/share-list/ShareList';
import {RoutePath} from '../../routes';
import './Welcome.scss';
import { mockTorrents } from '../../constants';


const Welcome: React.FC<RouteComponentProps> = ({history}) => {
  return (
    <section className="section fill">
      <div className="jumbotron"></div>
      <div className="subtitle">
        <p>
          Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt
          ut labore et dolore magna aliqua.
        </p>
      </div>
      <h2>Download a sample file</h2>
      <ShareList torrents={mockTorrents} history={history} />
      <h2>Or share a file</h2>
      <FormButton name="upload" block={true} onClick={() => history.push(RoutePath.Upload)}>
        Upload
      </FormButton>
    </section>
  );
};

export default Welcome;
