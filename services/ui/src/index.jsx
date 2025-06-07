import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './main.jsx';
import ErrorBoundary from './main.jsx'; // ErrorBoundary is defined in main.jsx

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
