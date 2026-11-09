// Yalnızca bota karşı pratik modu (sunucusuz önizleme sayfası için)
import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import './styles.css';
import Play71 from './pages/Play71';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><HashRouter><Routes><Route path="*" element={<Play71 />} /></Routes></HashRouter></React.StrictMode>,
);
