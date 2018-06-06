import React from 'react';
import { Link } from 'react-router-dom';

import { ROUTE_PATHS, BRAND_COLOR } from '../constants';

export default function Header() {
  return (
    <div
      style={{
        width: '100%',
        height: 42,
        borderBottomStyle: 'solid',
        borderBottomWidth: 1,
        borderBottomColor: '#bbb',
        backgroundColor: BRAND_COLOR,
        color: '#fff',
      }}
    >
      <div style={{ position: 'absolute', left: 20 }}>
        <Link to="/">
          <h3>RPS</h3>
        </Link>
      </div>
      <div
        style={{
          position: 'absolute',
          left: '50%',
          transform: 'translateX(-50%)',
        }}
      >
        <h3>Rock, Paper, Scissors</h3>
      </div>
      <div style={{ position: 'absolute', right: 20, top: 0 }}>
        <Link style={{ display: 'inline-block', marginRight: 16 }} to="/">
          <h3>Home</h3>
        </Link>
        <Link style={{ display: 'inline-block' }} to={`/${ROUTE_PATHS.ABOUT}`}>
          <h3>About</h3>
        </Link>
      </div>
    </div>
  );
}
