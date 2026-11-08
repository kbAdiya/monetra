import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './prototype.css';
import './auth.css';
import './motion.css';
import './polish.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
