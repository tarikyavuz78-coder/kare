import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './styles.css';
import App from './App';

// Ekran dönünce görünür yüksekliği yeniden ölç (bazı Android WebView'ler eski boyutta kalabiliyor)
const setAppHeight = () => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`);
setAppHeight();
for (const ev of ['resize', 'orientationchange']) {
  window.addEventListener(ev, () => { setAppHeight(); setTimeout(setAppHeight, 150); setTimeout(setAppHeight, 500); });
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><App /></HashRouter></React.StrictMode>,
);
