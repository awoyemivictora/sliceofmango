import React from 'react';
import Routes from './Routes';
import { WalletProvider } from './contexts/WalletContext';
import './styles/index.css';


// const App: React.FC = () => {
//   return (
//       <Routes />
//   );
// };

// export default App;




const App: React.FC = () => {
  return (
      <WalletProvider>
      <Routes />
    </WalletProvider>

  );
};

export default App;
