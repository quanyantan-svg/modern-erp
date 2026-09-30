import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './styles/v16-tokens.css';
import './styles/v16-mobile-enterprise.css';
import './styles/v16-sales-orders.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
