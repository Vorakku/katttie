import React from 'react';
import ReactDOM from 'react-dom/client';
import { App, readRoute } from './App';
import './styles/globals.css';

// Read and remove invite fragments before any embedded content is mounted.
const route = readRoute();
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App initialRoute={route} /></React.StrictMode>);
