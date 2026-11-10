import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles.css';
import App from './App';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';

// uygulama dikey açılır; yalnızca 71 masası yatay kilitlenir
if (Capacitor.isNativePlatform()) ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => undefined);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>,
);
