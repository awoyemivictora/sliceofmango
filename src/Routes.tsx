import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

// Import page components
import TurboSniperDashboard from './pages/TurboSniperDashboard';
import FlashSniperTradingInterface from './pages/FlashSniperTradingInterface';
import LandingPage from './pages/LandingPage';

const AppRoutes = () => {
  return (
    <Router>
      <Routes>
        {/* <Route path="/" element={<TurboSniperDashboard />} /> */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/trading-interface" element={<FlashSniperTradingInterface />} />
      </Routes>
    </Router>
  );
};

export default AppRoutes;