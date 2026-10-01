import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import './styles/v16-tokens.css';
import './styles/v16-mobile-enterprise.css';
import './styles/v16-sales-orders.css';
import './styles/v16-sales-order-document.css';
import './styles/v16-purchase-receipts.css';
import './styles/v16-mrp-planning.css';
import './styles/v16-inventory-control.css';
import './styles/v16-decision-reports.css';
import './styles/v16-sitewide-rollout.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
