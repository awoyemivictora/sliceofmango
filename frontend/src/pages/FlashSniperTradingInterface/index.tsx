import React, { useState, useEffect, useCallback, useRef } from 'react';
import { getOrCreateWallet } from '@/utils/wallet.js';
import { Connection, Transaction, Keypair as SolanaKeypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { useNavigate } from 'react-router-dom';
import { debounce } from 'lodash';
import { apiService } from '@/services/api';
import { registerWallet, verifyWallet, getNonce } from '@/services/auth';
import { config } from '@/config/production';



// Add these interfaces
interface ActiveTrade {
  mintAddress: string;
  pairAddress?: string;
  tokenSymbol: string;
  entryPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  buyTimestamp: string;
}

// Enhanced interfaces
interface LogEntry {
  id: string;
  type: 'log';
  log_type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: string;
  token_symbol?: string;
  tx_hash?: string;
  explorer_urls?: {
    solscan: string;
    dexScreener: string;
    jupiter: string;
  };
}


interface TransactionItem {
  id: string;
  type: 'buy' | 'sell';
  token: string;
  token_logo: string;
  amount_sol: number | null;
  amount_tokens?: number | null;
  tx_hash?: string;
  timestamp: string;
  profit_sol?: number | null;
  mint_address?: string;
  explorer_urls?: {
    solscan: string | null;  // Can be null
    dexScreener: string | null;
    jupiter: string | null;
  };
}

interface BuyFormData {
  amount: string;
  priorityFee: string;
  slippage: string;
}

interface SellFormData {
  takeProfit: string;
  stopLoss: string;
  slippage: string;
  timeout: string;
  priorityFee: string;
  useOwnRPC: boolean;
  trailingStopLossPct?: string;
}

interface TradeResponse {
  id: string;
  trade_type: string;
  amount_sol: number;
  token_symbol?: string;
  buy_timestamp?: string;
  sell_timestamp?: string;
}

interface ProfessionalInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suffix?: string;
  type?: string;
  formatOnBlur?: (value: string) => string;
  formatOnFocus?: (value: string) => string;
  label: string;
}

interface JitoTipSettings {
  reservedAmount: string,
  tipPerTx: string;
  currentBalance: number;
  tipAccount: string;
  isInitialized: boolean;
}

// Enhanced log display component with safe date handling
const LogEntryComponent: React.FC<{ log: LogEntry }> = ({ log }) => {
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      return date.toLocaleString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Error formatting timestamp:', error, timestamp);
      return 'Invalid date';
    }
  };

  const getLogTypeColor = (type: string) => {
    switch (type) {
      case 'success': return 'text-green-400';
      case 'warning': return 'text-yellow-400';
      case 'error': return 'text-red-400';
      default: return 'text-white';
    }
  };

  return (
    <div className={`border-l-4 ${
      log.log_type === 'success' ? 'border-green-500' :
      log.log_type === 'warning' ? 'border-yellow-500' :
      log.log_type === 'error' ? 'border-red-500' : 'border-blue-500'
    } pl-4 py-2 bg-dark-2 rounded-r-lg`}>
      <div 
        className="text-sm mb-1"
        dangerouslySetInnerHTML={{ __html: log.message }}
      />
      
      {log.explorer_urls && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          <span className="text-gray-400">View on:</span>
          <a 
            href={log.explorer_urls.solscan} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 transition-colors"
          >
            Solscan
          </a>
          <a 
            href={log.explorer_urls.dexScreener} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-green-400 hover:text-green-300 transition-colors"
          >
            DexScreener
          </a>
          <a 
            href={log.explorer_urls.jupiter} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-purple-400 hover:text-purple-300 transition-colors"
          >
            Jupiter
          </a>
        </div>
      )}
      
      <div className={`text-xs ${getLogTypeColor(log.log_type)} mt-1`}>
        {formatTimestamp(log.timestamp)}
      </div>
    </div>
  );
};

const TransactionItemComponent: React.FC<{ 
  transaction: TransactionItem;
  onOpenChart?: (mintAddress: string) => void;
}> = ({ transaction, onOpenChart }) => {

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return 'Invalid date';
      }
      
      // Check if timestamp is in ISO format
      const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
      if (!isoRegex.test(timestamp)) {
        // Try to parse as different format
        const parsedDate = new Date(Date.parse(timestamp));
        if (!isNaN(parsedDate.getTime())) {
          return parsedDate.toLocaleString('en-US', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
          });
        }
        return 'Invalid date';
      }
      
      return date.toLocaleString('en-US', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Error formatting timestamp:', error, timestamp);
      return 'Invalid date';
    }
  };

  // Safe number formatting with better handling
  const formatAmount = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '0.0000';
    }
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4
    });
  };

  // Format large token amounts (like 253061452000 from your logs)
  const formatTokenAmount = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined || isNaN(amount)) {
      return '0';
    }
    
    // If it's a very large number, format it nicely
    if (amount >= 1000000) {
      return (amount / 1000000).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + 'M';
    } else if (amount >= 1000) {
      return (amount / 1000).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + 'K';
    }
    
    return amount.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  };

  const formatProfit = (profit: number | null | undefined): string => {
    if (profit === null || profit === undefined || isNaN(profit)) {
      return '0.0000';
    }
    return profit.toLocaleString('en-US', {
      minimumFractionDigits: 4,
      maximumFractionDigits: 4,
      signDisplay: 'always'
    });
  };

  // Get display values
  const getDisplayValues = () => {
    if (transaction.type === "sell") {
      return {
        action: "Sold",
        amount: transaction.amount_tokens !== undefined ? 
          `${formatTokenAmount(transaction.amount_tokens)} ${transaction.token}` : 
          `${transaction.token}`,
        solAmount: formatAmount(transaction.amount_sol),
        showProfit: true
      };
    } else {
      return {
        action: "Bought",
        amount: transaction.amount_tokens !== undefined ? 
          `${formatTokenAmount(transaction.amount_tokens)} ${transaction.token}` : 
          `${transaction.token}`,
        solAmount: formatAmount(transaction.amount_sol),
        showProfit: false
      };
    }
  };

  const display = getDisplayValues();

  // Add a proper placeholder for broken images
  const handleImageError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHZpZXdCb3g9IjAgMCA0MCA0MCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjQwIiBoZWlnaHQ9IjQwIiByeD0iMjAiIGZpbGw9IiMyMDJBM0MiLz4KPHBhdGggZD0iTTIwIDEyVjI4TTEyIDIwSDI4IiBzdHJva2U9IiMxMEI5ODEiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8+Cjwvc3ZnPgo=';
    e.currentTarget.onerror = null; // Prevent infinite loop
  };

  // Function to handle logo clicks
  const handleLogoClick = (url: string | null | undefined, platform: string) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback URLs if specific URL is not available
      if (platform === "solscan" && transaction.tx_hash) {
        window.open(`https://solscan.io/tx/${transaction.tx_hash}`, '_blank', 'noopener,noreferrer');
      } else if (platform === "dexScreener" && transaction.mint_address) {
        window.open(`https://dexscreener.com/solana/${transaction.mint_address}`, '_blank', 'noopener,noreferrer');
      } else if (platform === "jupiter" && transaction.mint_address) {
        window.open(`https://jup.ag/token/${transaction.mint_address}`, '_blank', 'noopener,noreferrer');
      }
    }
  };


  return (
    <div className="flex items-center justify-between p-4 border-b border-[#333] hover:bg-dark-2 transition-colors">
      <div className="flex items-center gap-4 flex-1">
        <img 
          src={transaction.token_logo} 
          alt={transaction.token}
          className="w-10 h-10 rounded-full cursor-pointer"
          onClick={() => transaction.type === "buy" && onOpenChart?.(transaction.mint_address || '')}
          onError={handleImageError}
          title={transaction.type === "buy" ? "Open Chart" : "View Transaction"}
        />
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-white">
              {display.action} 
            </strong>
            <span className="text-white font-medium">
              {display.amount}
            </span>
            {display.showProfit && transaction.profit_sol !== undefined && transaction.profit_sol !== null && (
              <span className={`text-sm ${transaction.profit_sol > 0 ? "text-teal-400" : "text-red-500"}`}>
                ({formatProfit(transaction.profit_sol)} SOL)
              </span>
            )}
          </div>
          <p className="text-sm text-gray-400">
            {display.solAmount} SOL
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Explorer Logos */}
        <div className="flex gap-2 mr-3">
          {/* Solscan Logo */}
          <button
            onClick={() => handleLogoClick(
              transaction.explorer_urls?.solscan, 
              "solscan"
            )}
            className={`opacity-70 hover:opacity-100 transition-opacity p-1 hover:bg-[#222] rounded ${
              (!transaction.explorer_urls?.solscan && !transaction.tx_hash) ? "opacity-30 cursor-not-allowed" : ""
            }`}
            title={transaction.explorer_urls?.solscan ? "View on Solscan" : "No transaction link available"}
            disabled={!transaction.explorer_urls?.solscan && !transaction.tx_hash}
          >
            <img src="/images/solscan.png" alt="Solscan" className="w-5 h-5" />
          </button>
          
          {/* DexScreener Logo */}
          <button
            onClick={() => handleLogoClick(
              transaction.explorer_urls?.dexScreener, 
              "dexscreener"
            )}
            className={`opacity-70 hover:opacity-100 transition-opacity p-1 hover:bg-[#222] rounded ${
              (!transaction.explorer_urls?.dexScreener && !transaction.mint_address) ? "opacity-30 cursor-not-allowed" : ""
            }`}
            title={transaction.explorer_urls?.dexScreener ? "View on DexScreener" : "View token on DexScreener"}
            disabled={!transaction.explorer_urls?.dexScreener && !transaction.mint_address}
          >
            <img src="/images/dexscreener.png" alt="DexScreener" className="w-5 h-5" />
          </button>
          
          {/* Jupiter Logo */}
          <button
            onClick={() => handleLogoClick(
              transaction.explorer_urls?.jupiter, 
              "jupiter"
            )}
            className={`opacity-70 hover:opacity-100 transition-opacity p-1 hover:bg-[#222] rounded ${
              (!transaction.explorer_urls?.jupiter && !transaction.mint_address) ? "opacity-30 cursor-not-allowed" : ""
            }`}
            title={transaction.explorer_urls?.jupiter ? "View on Jupiter" : "View token on Jupiter"}
            disabled={!transaction.explorer_urls?.jupiter && !transaction.mint_address}
          >
            <img src="/images/jupiter.png" alt="Jupiter" className="w-5 h-5" />
          </button>
        </div>

        <span className="text-xs text-gray-500 min-w-[140px] text-right">
          {formatTimestamp(transaction.timestamp)}
        </span>
        
        {/* Chart button for buy transactions */}
        {/* {transaction.type === "buy" && onOpenChart && transaction.mint_address && (
          <button
            onClick={() => onOpenChart(transaction.mint_address!)}
            className="p-2 text-blue-400 hover:text-blue-300 transition-colors"
            title="Open Chart"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
          </button>
        )} */}
      </div>
    </div>
  );
};

// Add these format functions near your other format functions
const formatNumberOnFocus = (value: string): string => {
  return value.replace(/,/g, '').trim();
};

const formatNumberOnBlur = (value: string): string => {
  if (!value.trim()) return '0';
  const cleanValue = value.replace(/,/g, '').trim();
  // Format with commas for thousands
  return cleanValue ? parseInt(cleanValue, 10).toLocaleString('en-US') : '0';
};

const formatSolOnFocus = (value: string): string => {
  return value.replace(' SOL', '').trim();
};

const formatSolOnBlur = (value: string): string => {
  if (!value.trim()) return '0.01 SOL';
  const cleanValue = value.replace(' SOL', '').trim();
  const numValue = parseFloat(cleanValue) || 0.01;
  return `${numValue.toFixed(4)} SOL`;
};

// const ProfessionalInput: React.FC<ProfessionalInputProps> = ({
//   value,
//   onChange,
//   placeholder,
//   suffix,
//   type = 'text',
//   formatOnBlur,
//   formatOnFocus,
//   label,
// }) => {
//   const [isFocused, setIsFocused] = useState(false);
//   const [displayValue, setDisplayValue] = useState(value);
//   const [showTooltip, setShowTooltip] = useState(false);
//   const inputRef = useRef<HTMLInputElement>(null);
//   const tooltipRef = useRef<HTMLDivElement>(null);

//   // Default values for each field type
//   const getDefaultValue = () => {
//     if (suffix === 'SOL') return '0.0000 SOL';
//     if (suffix === '%') return '0%';
//     if (suffix === ' seconds') return '0 seconds';
//     return '';
//   };

//   const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
//     setIsFocused(true);
//     let rawValue = value;
    
//     // If value is default, show empty for editing
//     if (value === getDefaultValue()) {
//       rawValue = '';
//     } else if (formatOnFocus) {
//       rawValue = formatOnFocus(value);
//     } else if (suffix && value.endsWith(suffix)) {
//       rawValue = value.replace(suffix, '').trim();
//     }
    
//     setDisplayValue(rawValue);
//     setTimeout(() => e.target.select(), 100);
//   };

//   const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
//     setIsFocused(false);
//     let formattedValue = displayValue.trim();
    
//     // If empty, use default value
//     if (!formattedValue) {
//       formattedValue = getDefaultValue();
//     } else if (formatOnBlur) {
//       formattedValue = formatOnBlur(formattedValue);
//     } else if (suffix && formattedValue && !formattedValue.endsWith(suffix)) {
//       formattedValue = `${formattedValue}${suffix}`;
//     }
    
//     setDisplayValue(formattedValue);
//     onChange(formattedValue);
//   };

//   const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
//     const newValue = e.target.value;
//     setDisplayValue(newValue);
    
//     // Only update parent if no suffix or formatting (real-time updates)
//     if (!suffix && !formatOnBlur) {
//       onChange(newValue);
//     }
//   };

//   useEffect(() => {
//     if (!isFocused) {
//       setDisplayValue(value);
//     }
//   }, [value, isFocused]);

//   const handleTooltipClick = () => {
//     setShowTooltip(!showTooltip);
//   };

//   useEffect(() => {
//     const handleClickOutside = (event: MouseEvent) => {
//       if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
//         setShowTooltip(false);
//       }
//     };
//     document.addEventListener('mousedown', handleClickOutside);
//     return () => {
//       document.removeEventListener('mousedown', handleClickOutside);
//     };
//   }, []);

//   const showSuffix = suffix && !isFocused && displayValue && !displayValue.endsWith(suffix);

//   const getTooltipText = () => {
//     switch (label) {
//       case 'Amount':
//         return 'The amount of SOL to use for the buy transaction.';
//       case 'Take profit':
//         return 'Set the percentage at which to take profits.';
//       case 'Stop loss':
//         return 'Set the percentage at which to cut losses.';
//       case 'Timeout':
//         return 'Duration before the trade is canceled if not executed.';
//       case 'Top 10 Holders Max':
//         return 'Maximum percentage of tokens held by top 10 holders.';
//       case 'Bundled Max':
//         return 'Limit on bundled transactions to avoid scams.';
//       case 'Max Same Block Buys':
//         return 'Maximum buys in the same block to prevent manipulation.';
//       case 'Safety Check Period':
//         return 'Time period for safety checks before trading.';
//       default:
//         return 'This is a helper text for the input field.';
//     }
//   };

//   return (
//     <div className="relative">
//       <div className="flex items-center gap-2 mb-2">
//         <label className="block text-muted text-sm font-medium">{label}</label>
//         <div className="relative">
//           <span
//             className="flex items-center justify-center w-4 h-4 bg-teal-400 rounded-full text-white text-xs cursor-pointer"
//             onClick={handleTooltipClick}
//             aria-label="Help tooltip"
//           >
//             ?
//           </span>
//           {showTooltip && (
//             <div
//               ref={tooltipRef}
//               className="absolute z-10 bg-dark-2 text-white text-xs p-2 rounded-lg shadow-lg w-48 -top-10 left-6"
//             >
//               {getTooltipText()}
//             </div>
//           )}
//         </div>
//       </div>
//       <input
//         ref={inputRef}
//         type={type}
//         value={isFocused ? displayValue : value}
//         onChange={handleChange}
//         onFocus={handleFocus}
//         onBlur={handleBlur}
//         placeholder={isFocused ? placeholder : ''}
//         className="w-full bg-accent border-t border-[#22253e] rounded-lg p-3 text-white text-sm font-medium outline-none transition-all duration-200 focus:border-emerald-400 focus:bg-white/5 pr-10"
//       />
//       {showSuffix && (
//         <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted text-sm pointer-events-none">
//           {suffix}
//         </span>
//       )}
//     </div>
//   );
// };

const ProfessionalInput: React.FC<ProfessionalInputProps> = ({
  value,
  onChange,
  placeholder,
  suffix,
  type = 'text',
  formatOnBlur,
  formatOnFocus,
  label,
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(value);
  const [showTooltip, setShowTooltip] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Default values for each field type
  const getDefaultValue = () => {
    if (suffix === 'SOL') return '0.0100 SOL';
    if (suffix === '%') return '0%';
    if (suffix === ' seconds') return '0 seconds';
    return '';
  };

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    let rawValue = value;
    
    // If value is default, show empty for editing
    if (value === getDefaultValue()) {
      rawValue = '';
    } else if (formatOnFocus) {
      rawValue = formatOnFocus(value);
    } else if (suffix && value.endsWith(suffix)) {
      rawValue = value.replace(suffix, '').trim();
    }
    
    setDisplayValue(rawValue);
    setTimeout(() => e.target.select(), 100);
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false);
    let formattedValue = displayValue.trim();
    
    // If empty, use default value
    if (!formattedValue) {
      formattedValue = getDefaultValue();
    } else if (formatOnBlur) {
      formattedValue = formatOnBlur(formattedValue);
    } else if (suffix && formattedValue && !formattedValue.endsWith(suffix)) {
      formattedValue = `${formattedValue}${suffix}`;
    }
    
    setDisplayValue(formattedValue);
    onChange(formattedValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setDisplayValue(newValue);
    
    // Only update parent if no suffix or formatting (real-time updates)
    if (!suffix && !formatOnBlur) {
      onChange(newValue);
    }
  };

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(value);
    }
  }, [value, isFocused]);

  const handleTooltipClick = () => {
    setShowTooltip(!showTooltip);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        setShowTooltip(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const showSuffix = suffix && !isFocused && displayValue && !displayValue.endsWith(suffix);

  const getTooltipText = () => {
    switch (label) {
      case 'Reserved Tip Amount':
        return 'Total SOL reserved for Jito tips. Bot auto-funds this amount when tip account is low. Recommended: 0.01-0.05 SOL';
      case 'Tip/Transaction':
        return 'Tip amount per buy/sell transaction in lamports. Recommended: 100,000 (0.0001 SOL)';
      case 'Amount':
        return 'The amount of SOL to use for each buy transaction.';
      case 'Take profit':
        return 'Percentage gain at which to sell for profit. Example: 40% means sell when price increases by 40%';
      case 'Stop loss':
        return 'Percentage loss at which to cut losses. Example: 20% means sell when price drops by 20%';
      case 'Timeout':
        return 'Duration before trade is cancelled if not executed. Prevents hanging transactions.';
      case 'Top 10 Holders Max':
        return 'Maximum percentage of tokens held by top 10 holders. Lower values indicate better distribution.';
      case 'Bundled Max':
        return 'Maximum allowed bundled transactions in same block. Helps detect wash trading.';
      case 'Max Same Block Buys':
        return 'Maximum number of buy transactions allowed in the same block. Prevents manipulation.';
      case 'Safety Check Period':
        return 'Time period for safety checks before trading. Allows token to establish legitimacy.';
      default:
        return 'Configure this setting for optimal trading performance.';
    }
  };

  // Get tooltip position that won't cause horizontal scroll
  const getTooltipPosition = () => {
    if (!inputRef.current) return {};
    
    const rect = inputRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    
    // On mobile, show tooltip above the input
    if (viewportWidth < 768) {
      // Check if there's enough space above
      if (rect.top > 120) {
        return {
          bottom: '100%',
          top: 'auto',
          left: '50%',
          transform: 'translateX(-50%)',
          marginBottom: '8px',
          maxWidth: 'min(280px, 90vw)',
        };
      } else {
        // Not enough space above, show below
        return {
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: '8px',
          maxWidth: 'min(280px, 90vw)',
        };
      }
    } else {
      // On desktop, show to the right if there's space
      if (rect.right + 300 < viewportWidth) {
        return {
          top: '50%',
          left: '100%',
          transform: 'translateY(-50%)',
          marginLeft: '8px',
          maxWidth: '280px',
        };
      } else {
        // Not enough space to the right, show to the left
        return {
          top: '50%',
          right: '100%',
          left: 'auto',
          transform: 'translateY(-50%)',
          marginRight: '8px',
          maxWidth: '280px',
        };
      }
    }
  };

    return (
    <div className="relative">
      <div className="flex items-center gap-2 mb-2">
        <label className="block text-muted text-sm font-medium">{label}</label>
        <div className="relative">
          <span
            className="flex items-center justify-center w-4 h-4 bg-teal-400 rounded-full text-white text-xs cursor-pointer"
            onClick={handleTooltipClick}
            aria-label="Help tooltip"
          >
            ?
          </span>
          {showTooltip && (
            <div
              ref={tooltipRef}
              className="absolute z-10 bg-dark-2 text-white text-xs p-2 rounded-lg shadow-lg w-48 -top-10 left-6"
            >
              {getTooltipText()}
            </div>
          )}
        </div>
      </div>
      <input
        ref={inputRef}
        type={type}
        value={isFocused ? displayValue : value}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={isFocused ? placeholder : ''}
        className="w-full bg-accent border-t border-[#22253e] rounded-lg p-3 text-white text-sm font-medium outline-none transition-all duration-200 focus:border-emerald-400 focus:bg-white/5 pr-10"
      />
      {showSuffix && (
        <span className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted text-sm pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
  );
};

const FlashSniperTradingInterface: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'logs' | 'transactions'>('transactions');
  const [activeWalletTab, setActiveWalletTab] = useState<'wallet' | 'buySell'>('buySell');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showLoginPopup, setShowLoginPopup] = useState(false);
  const [buyForm, setBuyForm] = useState<BuyFormData>({
    amount: '0.01 SOL',
    priorityFee: '0.12000 SOL',
    slippage: '1%',
  });
  const [sellForm, setSellForm] = useState<SellFormData>({
    takeProfit: '40%',
    stopLoss: '20%',
    slippage: '1%',
    timeout: '60 seconds',
    priorityFee: '0.1000 SOL',
    useOwnRPC: false,
  });
  const [safetyForm, setSafetyForm] = useState({
    top10HoldersMax: '50%',
    bundledMax: '5',
    maxSameBlockBuys: '3',
    safetyCheckPeriod: '300 seconds',
    selectedDex: 'Raydium',
    immutableMetadata: false,
    mintAuthorityRenounced: false,
    freezeAuthorityRenounced: false,
    webacyRiskMax: '50',
  });

  const [walletKeypair, setWalletKeypair] = useState<SolanaKeypair | null>(null);
  const [walletAddress, setWalletAddress] = useState(localStorage.getItem('walletAddress') || '');
  const [privateKeyString, setPrivateKeyString] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showPrivateKeyWarning, setShowPrivateKeyWarning] = useState(() => {
    return !localStorage.getItem('privateKeyAcknowledged');
  });
  const [balance, setBalance] = useState(0);
  const [authToken, setAuthToken] = useState(localStorage.getItem('authToken') || null);
  const [isRegistered, setIsRegistered] = useState(!!localStorage.getItem('authToken'));
  const [isBotRunning, setIsBotRunning] = useState(false);
  const [showCopyMessage, setShowCopyMessage] = useState<'address' | 'privateKey' | null>(null);
  const [hasCheckedBalance, setHasCheckedBalance] = useState(false);
  const [minimumBalanceMet, setMinimumBalanceMet] = useState(false);
  const [customRpc, setCustomRpc] = useState({ https: '', wss: '' });
  const [isPremium, setIsPremium] = useState(false);
  const navigate = useNavigate();
  const [websocket, setWebsocket] = useState<WebSocket | null>(null);
  const [snipedCount, setSnipedCount] = useState(0);
  const [totalProfit, setTotalProfit] = useState(0);
  const [transactions, setTransactions] = useState<TransactionItem[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [activeTrades, setActiveTrades] = useState<ActiveTrade[]>([]);
  const [selectedTrade, setSelectedTrade] = useState<ActiveTrade | null>(null);
  const [showChart, setShowChart] = useState(false);
  const [pendingSettings, setPendingSettings] = useState({
    buy: { ...buyForm },
    sell: { ...sellForm },
    safety: { ...safetyForm }
  });
  const [settingsChanged, setSettingsChanged] = useState(false);
  const [JitoTipSettings, setJitoTipSettings] = useState<JitoTipSettings>({
    reservedAmount: '0.01 SOL',
    tipPerTx: '100,000',
    currentBalance: 0,
    tipAccount: '',
    isInitialized: false,
  });
  // const [isLoadingJitoInfo, setIsLoadingJitoInfo] = useState(false);

  // Function to fetch Jito tip info
  // const fetchJitoTipInfo = async () => {
  //   if (!authToken) {
  //     console.log('No auth token available');
  //     return;
  //   }

  //   try {
  //     const response = await apiService.request('/snipers/user/jito-tip/info', {
  //       headers: { Authorization: `Bearer ${authToken}` }, 
  //     });

  //     // Check if response exists and has status
  //     if (response && response.status === 'success') {
  //       setJitoTipSettings({
  //         reservedAmount: `${response.reserved_amount} SOL`,
  //         tipPerTx: response.tip_per_tx?.toLocaleString() || '100,000',
  //         currentBalance: response.current_balance || 0,
  //         tipAccount: response.tip_account || '',
  //         isInitialized: response.initialized || false,
  //       });

  //       setIsLoadingJitoInfo(true);
  //     } else {
  //       console.warn('Invalid response from Jito tip info:', response);
  //       // Set default values if response is invalid
  //       setJitoTipSettings(prev => ({
  //         ...prev,
  //         currentBalance: 0,
  //         isInitialized: false,
  //       }));
  //     }
  //   } catch (error) {
  //     console.error('Failed to fetch Jito tip info:', error);
  //     // Set default values on error
  //     setJitoTipSettings(prev => ({
  //       ...prev,
  //       currentBalance: 0,
  //       isInitialized: false,
  //     }));
  //   } finally {
  //     setIsLoadingJitoInfo(false);
  //   }
  // }


  // const fundJitoTipAccount = async () => {
  //   // Extract number from string (e.g., "0.01 SOL" -> 0.01)
  //   const amountStr = JitoTipSettings.reservedAmount.replace(' SOL', '');
  //   const amount = parseFloat(amountStr);

  //   if (isNaN(amount) || amount <= 0) {
  //       alert('Please enter a valid amount');
  //       return;
  //   }

  //   try {
  //       const response = await apiService.request('/snipers/user/jito-tip/fund', {
  //           method: 'POST',
  //           headers: {
  //               'Content-Type': 'application/json',
  //               'Authorization': `Bearer ${authToken}`
  //           },
  //           body: JSON.stringify({ amount_sol: amount })
  //       });

  //       if (response.status === 'success') {
  //           alert(`✅ Successfully funded ${amount} SOL to your tip account!\nTransaction: ${response.signature}`);
  //           fetchJitoTipInfo();
  //       }
  //   } catch (error: any) {
  //       console.error('Failed to fund Jito tip account:', error);
  //       alert(`Failed to fund: ${error.message || 'Please try again.'}`);
  //   }
  // };

  // // Function to update tip settings
  // const updateJitoTipSettings = async () => {
  //   const reservedAmount = parseFloat(JitoTipSettings.reservedAmount.replace(' SOL', ''));
  //   const tipPerTx = parseFloat(JitoTipSettings.tipPerTx.replace(/,/g, ''));

  //   try {
  //     const response = await apiService.request('/snipers/user/jito-tip/settings', {
  //       method: 'PUT',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         'Authorization': `Bearer ${authToken}`
  //       },
  //       body: JSON.stringify({
  //         reserved_amount: reservedAmount,
  //         tip_per_tx: tipPerTx  
  //       })
  //     });

  //     if (response.status === 'success') {
  //       // COMING BACK HERE AS WELL. NEED TO DISPLAY A NICE POPUP NOT ALERT
  //       alert('Jito tip settins updated successfully');
  //       fetchJitoTipInfo();
  //     }
  //   } catch (error) {
  //     console.error('Failed to update Jito tip settings:', error);
  //   }
  // };


  // // Add Jito Tip section to your UI in the settings area
  // const JitoTipSection = () => (
  //   <div className="bg-dark-2 rounded-lg shadow-lg overflow-hidden border border-[#22253e]">
  //     <div className="flex items-center justify-between p-4 border-b border-[#000010] bg-gradient-to-r from-dark-2 to-dark-1">
  //       <div className="flex items-center gap-3">
  //         <div className="relative">
  //           <div className="w-8 h-8 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-lg flex items-center justify-center">
  //             <img src="/images/img_flash.svg" alt="Jito Tip" className="w-4 h-4" />
  //           </div>
  //           <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-500 rounded-full border border-dark-2"></div>
  //         </div>
  //         <div>
  //           <h3 className="text-white text-base font-semibold">Jito Tip Management</h3>
  //           <p className="text-xs text-gray-400">Faster transaction inclusion</p>
  //         </div>
  //       </div>
  //       <div className="flex items-center gap-2">
  //         {JitoTipSettings.isInitialized ? (
  //           <span className="px-2 py-1 bg-emerald-900/30 text-emerald-400 text-xs font-medium rounded-full flex items-center gap-1">
  //             <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //               <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
  //             </svg>
  //             Ready
  //           </span>
  //         ) : (
  //           <span className="px-2 py-1 bg-amber-900/30 text-amber-400 text-xs font-medium rounded-full flex items-center gap-1">
  //             <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //               <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
  //             </svg>
  //             Not Ready
  //           </span>
  //         )}
  //       </div>
  //     </div>
      
  //     <div className="p-4 space-y-5">
  //       <div className="text-sm text-gray-300 leading-relaxed bg-dark-1/50 p-3 rounded-lg border border-[#22253e]">
  //         <div className="flex items-start gap-2">
  //           <svg className="w-4 h-4 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
  //             <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  //           </svg>
  //           <p>Jito tips ensure faster transaction inclusion. The bot will automatically initialize and fund this account when you click "Run Bot".</p>
  //         </div>
  //       </div>
        
  //       {/* Balance Status Card */}
  //       <div className="bg-gradient-to-r from-dark-1 to-dark-2 rounded-xl p-4 border border-[#2a2d45] shadow-lg">
  //         <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
  //           <div className="flex items-center gap-3">
  //             <div className={`w-10 h-10 rounded-full flex items-center justify-center ${
  //               JitoTipSettings.currentBalance > 0.01 
  //                 ? 'bg-gradient-to-br from-emerald-500 to-teal-600' 
  //                 : JitoTipSettings.currentBalance > 0.001 
  //                   ? 'bg-gradient-to-br from-amber-500 to-orange-600'
  //                   : 'bg-gradient-to-br from-red-500 to-pink-600'
  //             }`}>
  //               <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  //               </svg>
  //             </div>
  //             <div>
  //               <p className="text-sm text-gray-400">Tip Account Balance</p>
  //               <p className={`text-lg font-bold ${
  //                 JitoTipSettings.currentBalance > 0.01 
  //                   ? 'text-emerald-400' 
  //                   : JitoTipSettings.currentBalance > 0.001 
  //                     ? 'text-amber-400'
  //                     : 'text-red-400'
  //               }`}>
  //                 {JitoTipSettings.currentBalance.toFixed(6)} SOL
  //               </p>
  //             </div>
  //           </div>
            
  //           <div className="flex flex-col sm:items-end gap-2">
  //             <div className="flex items-center gap-2">
  //               {JitoTipSettings.currentBalance > 0.01 && (
  //                 <span className="px-2 py-1 bg-emerald-900/30 text-emerald-400 text-xs font-medium rounded-full flex items-center gap-1">
  //                   <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //                     <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  //                   </svg>
  //                   Optimal
  //                 </span>
  //               )}
  //               {JitoTipSettings.currentBalance <= 0.01 && JitoTipSettings.currentBalance > 0.001 && (
  //                 <span className="px-2 py-1 bg-amber-900/30 text-amber-400 text-xs font-medium rounded-full flex items-center gap-1">
  //                   <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //                     <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  //                   </svg>
  //                   Low
  //                 </span>
  //               )}
  //               {JitoTipSettings.currentBalance <= 0.001 && (
  //                 <span className="px-2 py-1 bg-red-900/30 text-red-400 text-xs font-medium rounded-full flex items-center gap-1">
  //                   <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //                     <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  //                   </svg>
  //                   Critical
  //                 </span>
  //               )}
  //             </div>
              
  //             {JitoTipSettings.currentBalance <= 0.01 && JitoTipSettings.isInitialized && (
  //               <button
  //                 onClick={() => {
  //                   const amount = JitoTipSettings.currentBalance <= 0.001 ? 0.01 : 0.005;
  //                   if (confirm(`Low tip balance detected. Add ${amount} SOL to maintain optimal performance?`)) {
  //                     setJitoTipSettings(prev => ({
  //                       ...prev,
  //                       reservedAmount: `${amount} SOL`
  //                     }));
  //                     setTimeout(() => fundJitoTipAccount(), 100);
  //                   }
  //                 }}
  //                 className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all duration-200 ${
  //                   JitoTipSettings.currentBalance <= 0.001 
  //                     ? 'bg-gradient-to-r from-red-600 to-pink-600 hover:from-red-700 hover:to-pink-700 text-white'
  //                     : 'bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white'
  //                 }`}
  //               >
  //                 {JitoTipSettings.currentBalance <= 0.001 ? '⚠️ Add 0.01 SOL' : '🔋 Add 0.005 SOL'}
  //               </button>
  //             )}
  //           </div>
  //         </div>
          
  //         {/* Balance Meter */}
  //         <div className="mt-4">
  //           <div className="flex justify-between text-xs text-gray-500 mb-1">
  //             <span>0 SOL</span>
  //             <span>Optimal: 0.01+ SOL</span>
  //           </div>
  //           <div className="h-2 bg-dark-1 rounded-full overflow-hidden">
  //             <div 
  //               className={`h-full rounded-full transition-all duration-500 ${
  //                 JitoTipSettings.currentBalance > 0.01 
  //                   ? 'bg-gradient-to-r from-emerald-500 to-teal-500 w-full' 
  //                   : JitoTipSettings.currentBalance > 0.001 
  //                     ? 'bg-gradient-to-r from-amber-500 to-orange-500'
  //                     : 'bg-gradient-to-r from-red-500 to-pink-500'
  //               }`}
  //               style={{ 
  //                 width: `${Math.min(JitoTipSettings.currentBalance * 100, 100)}%` 
  //               }}
  //             ></div>
  //           </div>
  //         </div>
  //       </div>
        
  //       <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
  //         <div className="space-y-3">
  //           <ProfessionalInput
  //             value={JitoTipSettings.reservedAmount}
  //             onChange={(value) => setJitoTipSettings(prev => ({ ...prev, reservedAmount: value }))}
  //             placeholder="0.01"
  //             suffix="SOL"
  //             formatOnFocus={formatSolOnFocus}
  //             formatOnBlur={formatSolOnBlur}
  //             label="Reserved Tip Amount"
  //           />
  //           <div className="flex items-start gap-2 text-xs text-gray-500 bg-dark-1/30 p-2 rounded-lg">
  //             <svg className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
  //               <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  //             </svg>
  //             <span>Auto-fund amount when starting bot (0.01-0.05 SOL recommended)</span>
  //           </div>
  //         </div>
          
  //         <div className="space-y-3">
  //           <ProfessionalInput
  //             value={JitoTipSettings.tipPerTx}
  //             onChange={(value) => setJitoTipSettings(prev => ({ ...prev, tipPerTx: value }))}
  //             placeholder="100000"
  //             formatOnFocus={formatNumberOnFocus}
  //             formatOnBlur={formatNumberOnBlur}
  //             label="Tip/Transaction"
  //           />
  //           <div className="flex items-start gap-2 text-xs text-gray-500 bg-dark-1/30 p-2 rounded-lg">
  //             <svg className="w-3 h-3 text-blue-400 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
  //               <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
  //             </svg>
  //             <span>Tip per transaction in lamports (100,000 = 0.0001 SOL)</span>
  //           </div>
  //         </div>
  //       </div>
        
  //       {JitoTipSettings.tipAccount && (
  //         <div className="bg-dark-1 rounded-xl p-4 border border-[#2a2d45]">
  //           <div className="flex items-center justify-between mb-3">
  //             <div className="flex items-center gap-2">
  //               <div className="w-6 h-6 bg-blue-500/20 rounded flex items-center justify-center">
  //                 <svg className="w-3 h-3 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
  //                 </svg>
  //               </div>
  //               <span className="text-sm text-gray-400 font-medium">Tip Account Details</span>
  //             </div>
  //             <button
  //               onClick={() => {
  //                 navigator.clipboard.writeText(JitoTipSettings.tipAccount);
  //                 alert('Tip account address copied to clipboard!');
  //               }}
  //               className="text-xs text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1"
  //             >
  //               <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
  //               </svg>
  //               Copy
  //             </button>
  //           </div>
            
  //           <div className="text-white text-sm font-mono break-all bg-dark-2 p-3 rounded-lg border border-[#22253e] overflow-x-auto">
  //             {JitoTipSettings.tipAccount}
  //           </div>
            
  //           <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
  //             <div className="bg-dark-2 p-3 rounded-lg border border-[#22253e]">
  //               <p className="text-xs text-gray-400 mb-1">Status</p>
  //               <div className="flex items-center gap-2">
  //                 {JitoTipSettings.isInitialized ? (
  //                   <>
  //                     <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
  //                     <span className="text-emerald-400 text-sm font-medium">Initialized & Ready</span>
  //                   </>
  //                 ) : (
  //                   <>
  //                     <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
  //                     <span className="text-amber-400 text-sm font-medium">Not Initialized</span>
  //                   </>
  //                 )}
  //               </div>
  //             </div>
              
  //             <div className="bg-dark-2 p-3 rounded-lg border border-[#22253e]">
  //               <p className="text-xs text-gray-400 mb-1">Estimated Transactions</p>
  //               <p className="text-white text-sm font-medium">
  //                 {JitoTipSettings.currentBalance > 0 
  //                   ? `${Math.floor(JitoTipSettings.currentBalance * 10000)} left` 
  //                   : '0 left'}
  //               </p>
  //             </div>
  //           </div>
  //         </div>
  //       )}
        
  //       <div className="flex flex-col sm:flex-row gap-3">
  //         <button
  //           onClick={updateJitoTipSettings}
  //           className="flex-1 bg-gradient-to-r from-teal-600 to-cyan-600 text-white text-sm font-medium py-3 px-4 rounded-lg hover:from-teal-700 hover:to-cyan-700 transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
  //           disabled={!JitoTipSettings.tipAccount}
  //         >
  //           <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  //           </svg>
  //           Update Settings
  //         </button>
          
  //         {JitoTipSettings.isInitialized && (
  //           <button
  //             onClick={fundJitoTipAccount}
  //             className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-sm font-medium py-3 px-4 rounded-lg hover:from-blue-700 hover:to-indigo-700 transition-all duration-200 flex items-center justify-center gap-2 shadow-lg"
  //           >
  //             <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
  //               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  //             </svg>
  //             Add Funds
  //           </button>
  //         )}
  //       </div>
        
  //       <div className="text-center">
  //         <div className="flex items-center justify-center gap-2 text-xs text-gray-500 mb-2">
  //           <svg className="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20">
  //             <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
  //           </svg>
  //           <span>Jito tip account will be created automatically when you start the bot.</span>
  //         </div>
          
  //         {JitoTipSettings.currentBalance < 0.001 && JitoTipSettings.isInitialized && (
  //           <div className="flex items-center justify-center gap-2 text-xs text-amber-400 bg-amber-900/20 p-2 rounded-lg border border-amber-800/30">
  //             <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
  //               <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
  //             </svg>
  //             ⚠️ Low tip balance may cause slower transactions. Add funds for optimal performance.
  //           </div>
  //         )}
  //       </div>
  //     </div>
  //   </div>
  // );



  // Function to clear logs
  const handleClearLogs = () => {
    setLogs([]);
    
    // Optional: Add a log entry confirming the logs were cleared
    // const clearLog: LogEntry = {
    //   id: `log-${Date.now()}`,
    //   type: 'log',
    //   log_type: 'info',
    //   message: '📋 Logs cleared manually',
    //   timestamp: new Date().toISOString()
    // };
    // setLogs([clearLog]);
  };

  // Update the bot status check on component mount
  useEffect(() => {
    const checkBotStatus = async () => {
      if (!authToken) return;
      
      try {
        const statusResponse = await apiService.request('/trade/bot/status', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        
        setIsBotRunning(statusResponse.is_running);
        
        // Update localStorage to match actual status
        if (statusResponse.is_running) {
          localStorage.setItem(`bot_running_${walletAddress}`, 'true');
        } else {
          localStorage.removeItem(`bot_running_${walletAddress}`);
        }
      } catch (error) {
        console.error('Error checking bot status:', error);
      }
    };

    checkBotStatus();
  }, [authToken, walletAddress]);

  // Add this function to handle new trades
  const handleNewTrade = (tradeData: any) => {
    if (tradeData.trade_type === 'buy') {
      // Check if trade already exists to prevent duplicates
      const existingTrade = activeTrades.find(t => t.mintAddress === tradeData.mint_address);
      if (existingTrade) {
        console.log('Trade already exists:', tradeData.mint_address);
        return;
      }

      const newTrade: ActiveTrade = {
        mintAddress: tradeData.mint_address,
        pairAddress: tradeData.pair_address,
        tokenSymbol: tradeData.token_symbol || 'UNKNOWN',
        entryPrice: tradeData.price_usd_at_trade,
        takeProfit: tradeData.take_profit ? tradeData.entry_price * (1 + tradeData.take_profit / 100) : undefined,
        stopLoss: tradeData.stop_loss ? tradeData.entry_price * (1 - tradeData.stop_loss / 100) : undefined,
        buyTimestamp: tradeData.buy_timestamp || new Date().toISOString()
      };

      setActiveTrades(prev => {
        // Remove any existing trade with same mintAddress before adding new one
        const filtered = prev.filter(t => t.mintAddress !== newTrade.mintAddress);
        return [...filtered, newTrade];
      });
      
      // Auto-open chart for new trades
      setSelectedTrade(newTrade);
      setShowChart(true);

      // Notify user
      const notificationLog: LogEntry = {
        id: `chart-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'log',
        log_type: 'success',
        message: `📈 Chart opened for ${tradeData.token_symbol}. Monitoring price movements...`,
        timestamp: new Date().toISOString()
      };
      handleLogMessage(notificationLog);
    }

  // Remove trade when sold
  if (tradeData.trade_type === 'sell') {
    setActiveTrades(prev => prev.filter(trade => trade.mintAddress !== tradeData.mint_address));
    
    // Close chart if this was the selected trade
    if (selectedTrade?.mintAddress === tradeData.mint_address) {
      setShowChart(false);
      setSelectedTrade(null);
    }
  }
};

  // Enhanced WebSocket connection with single instance
  useEffect(() => {
    if (!walletAddress || !authToken) {
      if (websocket) {
        websocket.close();
        setWebsocket(null);
      }
      return;
    }

    // Prevent multiple WebSocket connections
        if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) {
          console.log('WebSocket already connected or connecting');
          return;
        }

    let ws: WebSocket;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;

    // In your WebSocket connection useEffect, improve reconnection:
    const connect = () => {
      try {
        // Close existing connection if any
        if (websocket) {
          websocket.close();
        }

        ws = apiService.createWebSocket(walletAddress);

        ws.onopen = () => {
          console.log('WebSocket connected');
          reconnectAttempts = 0;
          setWebsocket(ws);
          
          // Send initial connection message
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ 
              type: 'connection_init', 
              wallet_address: walletAddress 
            }));
          }
          
          const successLog: LogEntry = {
            id: `ws-${Date.now()}`,
            type: 'log',
            log_type: 'success',
            message: 'WebSocket connected successfully',
            timestamp: new Date().toISOString()
          };
          handleLogMessage(successLog);
        };

        ws.onmessage = async (event) => {
          try {
            const data = JSON.parse(event.data);
            await handleWebSocketMessage(data);
          } catch (err) {
            console.error('WS message error:', err);
          }
        };

        ws.onclose = (event) => {
          console.log(`WebSocket disconnected: ${event.code} - ${event.reason}`);
          setWebsocket(null);
          
          const disconnectLog: LogEntry = {
            id: `ws-${Date.now()}`,
            type: 'log',
            log_type: 'warning',
            message: `WebSocket disconnected. ${reconnectAttempts < maxReconnectAttempts ? 'Reconnecting...' : 'Max reconnection attempts reached.'}`,
            timestamp: new Date().toISOString()
          };
          handleLogMessage(disconnectLog);
          
          if (reconnectAttempts < maxReconnectAttempts) {
            const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
            reconnectAttempts++;
            setTimeout(connect, delay);
          }
        };

        ws.onerror = (err) => {
          console.error('WebSocket error:', err);
          const errorLog: LogEntry = {
            id: `ws-${Date.now()}`,
            type: 'log',
            log_type: 'error',
            message: 'WebSocket connection error',
            timestamp: new Date().toISOString()
          };
          handleLogMessage(errorLog);
        };

      } catch (error) {
        console.error('WebSocket connection error:', error);
      }
    };

    connect();

    return () => {
      if (ws) {
        ws.close(1000, 'Component unmount');
      }
    };
  }, [walletAddress, authToken]);

  // Fetch active positions
  useEffect(() => {
    const fetchActivePositions = async () => {
      if (!authToken) return;
      
      try {
        const response = await apiService.request('/trade/active-positions', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        
        const formattedTrades: ActiveTrade[] = response.map((pos: any) => ({
          mintAddress: pos.mint_address,
          pairAddress: pos.pair_address,
          tokenSymbol: pos.token_symbol,
          entryPrice: pos.entry_price,
          takeProfit: pos.take_profit_target ? pos.entry_price * (1 + pos.take_profit_target / 100) : undefined,
          stopLoss: pos.stop_loss_target ? pos.entry_price * (1 - pos.stop_loss_target / 100) : undefined,
          buyTimestamp: pos.buy_timestamp,
          currentPrice: pos.current_price,
          pnlPercent: pos.pnl_percent
        }));
        
        setActiveTrades(formattedTrades);
      } catch (error) {
        console.error('Error fetching active positions:', error);
      }
    };

    fetchActivePositions();
    const interval = setInterval(fetchActivePositions, 10000); // Update every 10 seconds
    return () => clearInterval(interval);
  }, [authToken]);

  // Enhanced WebSocket message handler
  const handleWebSocketMessage = async (data: any) => {
    switch (data.type) {
      case 'log':
        handleLogMessage(data);
        break;
      case 'trade_instruction':
        if (data.action === 'sell') {
          // Create a sell transaction from trade_instruction
          const sellTransaction: TransactionItem = {
            id: `sell-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'sell',
            token: data.token_symbol || 'UNKNOWN',
            token_logo: data.token_logo || `https://dd.dexscreener.com/ds-logo/solana/${data.mint}.png`,
            amount_sol: data.amount_sol || 0,
            amount_tokens: data.token_amount || 0,
            profit_sol: data.profit_usd ? data.profit_usd / 100 : undefined, // Convert if needed
            tx_hash: data.signature,
            timestamp: new Date().toISOString(),
            mint_address: data.mint,
            explorer_urls: data.signature ? {
              solscan: `https://solscan.io/tx/${data.signature}`,
              dexScreener: `https://dexscreener.com/solana/${data.mint}`,
              jupiter: `https://jup.ag/token/${data.mint}`
            } : undefined
          };
          
          setTransactions(prev => {
            const filtered = prev.filter(tx => tx.id !== sellTransaction.id);
            return [sellTransaction, ...filtered.slice(0, 49)];
          });
          
          // Also update total profit
          if (data.profit_usd) {
            setTotalProfit(prev => prev + (parseFloat(data.profit_usd) || 0));
          }
        }
        await handleTradeInstruction(data);
        break;
      case 'new_pool':
        handleNewPoolDetection(data.pool);
        break;
      case 'health_check':
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'health_response' }));
        }
        break;
      case 'balance_update':
        setBalance(data.balance);
        break;
      case 'trade_update':
        // Handle the trade update from the new format
        const tradeData = data.trade;
  
        // Get explorer URLs from the data or generate them
        const explorer_urls = tradeData.explorer_urls || {
          solscan: tradeData.tx_hash ? `https://solscan.io/tx/${tradeData.tx_hash}` : null,
          dexScreener: tradeData.mint_address ? `https://dexscreener.com/solana/${tradeData.mint_address}` : null,
          jupiter: tradeData.mint_address ? `https://jup.ag/token/${tradeData.mint_address}` : null,
        };
        
        // Create transaction item
        const transactionFromTrade: TransactionItem = {
          id: tradeData.id || `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: tradeData.type || 'buy',
          token: tradeData.token_symbol || 'UNKNOWN',
          token_logo: tradeData.token_logo || `https://dd.dexscreener.com/ds-logo/solana/${tradeData.mint_address}.png`,
          amount_sol: tradeData.amount_sol || 0,
          amount_tokens: tradeData.amount_tokens || 0,
          tx_hash: tradeData.tx_hash,
          timestamp: tradeData.timestamp || new Date().toISOString(),
          mint_address: tradeData.mint_address,
          explorer_urls: explorer_urls
        };
        
        // Create a transaction item from the trade update
        // const transactionFromTrade: TransactionItem = {
        //   id: tradeData.id || `trade-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        //   type: tradeData.type || 'buy',
        //   token: tradeData.token_symbol || 'UNKNOWN',
        //   token_logo: tradeData.token_logo || `https://dd.dexscreener.com/ds-logo/solana/${tradeData.mint_address}.png`,
        //   amount_sol: tradeData.amount_sol || 0,
        //   amount_tokens: tradeData.amount_tokens || 0,
        //   tx_hash: tradeData.tx_hash,
        //   timestamp: tradeData.timestamp || new Date().toISOString(),
        //   mint_address: tradeData.mint_address,
        //   explorer_urls: tradeData.explorer_urls || (tradeData.tx_hash ? {
        //     solscan: `https://solscan.io/tx/${tradeData.tx_hash}`,
        //     dexScreener: `https://dexscreener.com/solana/${tradeData.mint_address}`,
        //     jupiter: `https://jup.ag/token/${tradeData.mint_address}`
        //   } : undefined)
        // };
        
        // Add to transactions
        setTransactions(prev => {
          const filtered = prev.filter(tx => tx.id !== transactionFromTrade.id);
          return [transactionFromTrade, ...filtered.slice(0, 49)];
        });
        
        // Also handle as an active trade for buy transactions
        if (tradeData.type === 'buy') {
          const newTrade: ActiveTrade = {
            mintAddress: tradeData.mint_address,
            tokenSymbol: tradeData.token_symbol || 'UNKNOWN',
            entryPrice: tradeData.price_usd_at_trade,
            buyTimestamp: tradeData.timestamp || new Date().toISOString()
          };
          
          setActiveTrades(prev => {
            const filtered = prev.filter(t => t.mintAddress !== newTrade.mintAddress);
            return [...filtered, newTrade];
          });
          
          // Notify user
          const notificationLog: LogEntry = {
            id: `trade-${Date.now()}`,
            type: 'log',
            log_type: 'success',
            message: `📈 Chart opened for ${tradeData.token_symbol}. Monitoring price movements...`,
            timestamp: new Date().toISOString()
          };
          handleLogMessage(notificationLog);
        }
        
        break;
      case 'bot_status':
        setIsBotRunning(data.is_running);
        if (data.is_running) {
          const successLog: LogEntry = {
            id: `log-${Date.now()}`,
            type: 'log',
            log_type: 'success',
            message: '🤖 Persistent bot is running - continues even after browser close',
            timestamp: new Date().toISOString()
          };
          handleLogMessage(successLog);
        }
        break;
      case 'pong':
        // Handle ping-pong for connection health
        break;
      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  };

  // Add manual chart open function
  const openTradeChart = (trade: ActiveTrade) => {
    setSelectedTrade(trade);
    setShowChart(true);
    
    // Scroll to top on mobile when opening chart
    if (window.innerWidth < 1024) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Add close chart function
  const closeChart = () => {
    setShowChart(false);
    setSelectedTrade(null);
  };

  // Add manual sell function
  const handleManualSell = async (trade?: ActiveTrade) => {
    const targetTrade = trade || selectedTrade;
    if (!targetTrade) return;
    
    try {
      const response = await apiService.request('/trade/manual-sell', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}` 
        },
        body: JSON.stringify({
          mint_address: targetTrade.mintAddress,
          amount_percentage: 100 // Sell 100%
        })
      });
      
      // Show success message
      const successLog: LogEntry = {
        id: `sell-${Date.now()}`,
        type: 'log',
        log_type: 'success',
        message: `✅ Manual sell order placed for ${targetTrade.tokenSymbol}`,
        timestamp: new Date().toISOString()
      };
      handleLogMessage(successLog);
      
      // Close chart if this was the selected trade
      if (selectedTrade?.mintAddress === targetTrade.mintAddress) {
        closeChart();
      }
    } catch (error) {
      console.error('Manual sell error:', error);
      const errorLog: LogEntry = {
        id: `sell-error-${Date.now()}`,
        type: 'log',
        log_type: 'error',
        message: `❌ Failed to sell ${targetTrade.tokenSymbol}: ${error}`,
        timestamp: new Date().toISOString()
      };
      handleLogMessage(errorLog);
    }
  };

  const handleLogMessage = (logData: LogEntry) => {
    // Ensure timestamp is valid
    let timestamp = logData.timestamp;
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        // If timestamp is invalid, use current time
        timestamp = new Date().toISOString();
      }
    } catch (error) {
      // If there's any error parsing, use current time
      timestamp = new Date().toISOString();
    }

    const newLog: LogEntry = {
      ...logData,
      timestamp: timestamp,
      id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`
    };

    setLogs(prev => [newLog, ...prev.slice(0, 199)]);
  };

  // Update your handleTradeUpdate function to ensure unique IDs:
  const handleTradeUpdate = (trade: any) => {
    // Create a more unique ID using timestamp and random string
    const uniqueId = `${trade.timestamp || new Date().toISOString()}-${Math.random().toString(36).substr(2, 9)}-${trade.mint_address || 'unknown'}`;
    
    const newTx: TransactionItem = {
      id: trade.id || uniqueId,
      type: trade.trade_type === 'buy' ? 'buy' : 'sell',
      token: trade.token_symbol || 'UNKNOWN',
      token_logo: trade.token_logo || `https://dd.dexscreener.com/ds-logo/solana/${trade.mint_address}.png`,
      amount_sol: trade.amount_sol || 0,
      amount_tokens: trade.token_amounts_purchased || trade.amount_tokens,
      tx_hash: trade.tx_hash,
      timestamp: trade.timestamp || new Date().toISOString(),
      profit_sol: trade.profit_sol,
      mint_address: trade.mint_address,
      explorer_urls: trade.tx_hash ? {
        solscan: `https://solscan.io/tx/${trade.tx_hash}`,
        dexScreener: `https://dexscreener.com/solana/${trade.tx_hash}`,
        jupiter: `https://jup.ag/tx/${trade.tx_hash}`
      } : undefined
    };

    // Use functional update to avoid stale state and ensure uniqueness
    setTransactions(prev => {
      // Filter out any existing transactions with the same ID to prevent duplicates
      const filtered = prev.filter(tx => tx.id !== newTx.id);
      return [newTx, ...filtered.slice(0, 49)];
    });
  };

  const handleNewPoolDetection = (pool: any) => {
    // This will be handled by backend logs now
    console.log('New pool detected:', pool);
  };

  // Also update your sendSettingsUpdate to be more robust
  const sendSettingsUpdate = useCallback(
    debounce((settings: any) => {
      if (websocket && websocket.readyState === WebSocket.OPEN && walletAddress) {
        websocket.send(
          JSON.stringify({
            type: 'settings_update',
            settings,
            wallet_address: walletAddress
          })
        );
      }
    }, 1000), // Increased debounce to 1 second
    [websocket, walletAddress]
  );

  const handleTradeInstruction = async (instruction: any) => {
    try {
      const connection = new Connection(customRpc.https || 'https://rpc.shyft.to?api_key=0C53vJyghxriRpQX', 'confirmed');
      const rawTx = Buffer.from(instruction.raw_tx_base64, 'base64');
      const transaction = Transaction.from(rawTx);
      const keypair = walletKeypair!;
      transaction.sign(keypair);
      const signedTx = transaction.serialize();
      const signedTxBase64 = signedTx.toString('base64');
      
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        await websocket.send(
          JSON.stringify({
            type: 'signed_transaction',
            signed_tx_base64: signedTxBase64,
            instruction_id: instruction.id
          })
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Trade execution error:', errorMessage);
    }
  };

  const updateBotSettings = useCallback(() => {
    const settings = {
      buy_amount_sol: parseFloat(buyForm.amount.replace(' SOL', '')) || 0,
      buy_slippage_bps: parseInt(buyForm.slippage.replace('%', '')) * 100 || 0,
      sell_take_profit_pct: parseFloat(sellForm.takeProfit.replace('%', '')) || 0,
      sell_stop_loss_pct: parseFloat(sellForm.stopLoss.replace('%', '')) || 0,
      sell_timeout_seconds: parseInt(sellForm.timeout.replace(' seconds', '')) || 0,
      sell_slippage_bps: parseInt(sellForm.slippage.replace('%', '')) * 100 || 0,
      trailing_stop_loss_pct: sellForm.trailingStopLossPct
        ? parseFloat(sellForm.trailingStopLossPct.replace('%', '')) || 0
        : undefined,
      filter_socials_added: safetyForm.immutableMetadata,
      filter_liquidity_burnt: safetyForm.immutableMetadata,
      filter_immutable_metadata: safetyForm.immutableMetadata,
      filter_mint_authority_renounced: safetyForm.mintAuthorityRenounced,
      filter_freeze_authority_revoked: safetyForm.freezeAuthorityRenounced,
      filter_pump_fun_migrated: true,
      filter_check_pool_size_min_sol: 0.5,
      bot_check_interval_seconds: 10,
      filter_webacy_risk_max: parseInt(safetyForm.webacyRiskMax) || 50,
      selected_dex: safetyForm.selectedDex,
      ...(isPremium && {
        filter_top_holders_max_pct: parseFloat(safetyForm.top10HoldersMax.replace('%', '')) || 0,
        filter_safety_check_period_seconds: parseInt(safetyForm.safetyCheckPeriod.replace(' seconds', '')) || 0,
        filter_bundled_max: parseInt(safetyForm.bundledMax) || 0,
        filter_max_same_block_buys: parseInt(safetyForm.maxSameBlockBuys) || 0,
      }),
    };
    if (websocket && websocket.readyState === WebSocket.OPEN && walletAddress) {
      websocket.send(
        JSON.stringify({
          type: 'settings_update',
          settings,
          wallet_address: walletAddress
        })
      );
    }
  }, [pendingSettings, websocket, walletAddress]);



  // Enhanced bot control functions with settings update
  const handleRunBot = async () => {
    console.log('Run Bot clicked');
    
    if (!authToken || !walletAddress) {
      alert('Please ensure wallet is registered and authenticated.');
      return;
    }
    
    if (balance < 0.3) {
      alert(`Please deposit at least 0.3 SOL to start the bot. Current balance: ${balance.toFixed(4)} SOL`);
      return;
    }

    try {
      // Update settings before starting bot
      if (settingsChanged) {
        await updateBotSettings();
        const settingsLog: LogEntry = {
          id: `log-${Date.now()}`,
          type: 'log',
          log_type: 'info',
          message: '⚙️ Bot settings updated and applied',
          timestamp: new Date().toISOString()
        };
        handleLogMessage(settingsLog);
        setSettingsChanged(false);
      }

      // Start bot via API
      const response = await apiService.request('/trade/bot/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
      });

      setIsBotRunning(true);
      
      // Send WebSocket message
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
          type: 'start_bot',
          wallet_address: walletAddress
        }));
      }

      localStorage.setItem(`bot_running_${walletAddress}`, 'true');
      
      const successLog: LogEntry = {
        id: `log-${Date.now()}`,
        type: 'log',
        log_type: 'success',
        message: '🚀 Trading bot started successfully! Monitoring for new token pools...',
        timestamp: new Date().toISOString()
      };
      handleLogMessage(successLog);
      
    } catch (error: any) {
      console.error('Error starting bot:', error);
      const errorLog: LogEntry = {
        id: `log-${Date.now()}`,
        type: 'log',
        log_type: 'error',
        message: `Failed to start bot: ${error.message || 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
      handleLogMessage(errorLog);
      alert(`Failed to start bot: ${error.message || 'Please check console for details'}`);
    }
  };


  const handleStopBot = async () => {
    console.log('Stop Bot clicked');
    
    try {
      // Update settings before stopping bot if changed
      if (settingsChanged) {
        await updateBotSettings();
        const settingsLog: LogEntry = {
          id: `log-${Date.now()}`,
          type: 'log',
          log_type: 'info',
          message: '⚙️ Bot settings updated before stopping',
          timestamp: new Date().toISOString()
        };
        handleLogMessage(settingsLog);
        setSettingsChanged(false);
      }

      const response = await apiService.request('/trade/bot/stop', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
      });

      setIsBotRunning(false);
      
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.send(JSON.stringify({
          type: 'stop_bot',
          wallet_address: walletAddress
        }));
      }

      localStorage.removeItem(`bot_running_${walletAddress}`);
      
      const stopLog: LogEntry = {
        id: `log-${Date.now()}`,
        type: 'log',
        log_type: 'info',
        message: '🛑 Trading bot stopped successfully.',
        timestamp: new Date().toISOString()
      };
      handleLogMessage(stopLog);
      
    } catch (error: any) {
      console.error('Error stopping bot:', error);
      alert(`Failed to stop bot: ${error.message || 'Please check console for details'}`);
    }
  };

  const startBotHealthCheck = () => {
    const interval = setInterval(async () => {
      if (!isBotRunning) {
        clearInterval(interval);
        return;
      }
      try {
        // Send ping to keep connection alive
        if (websocket && websocket.readyState === WebSocket.OPEN) {
          websocket.send(JSON.stringify({ type: 'ping' }));
        }
      } catch (error) {
        console.error('Health check failed:', error);
      }
    }, 25000); // Every 25 seconds
    
    return interval;
  };

  // Add this inside your FlashSniperTradingInterface component
  useEffect(() => {
    const handleAuthExpired = () => {
      setAuthToken(null);
      localStorage.removeItem('authToken');
      alert('Your session has expired. Please reconnect your wallet.');
      window.location.reload();
    };

    window.addEventListener('auth-expired', handleAuthExpired);
    return () => window.removeEventListener('auth-expired', handleAuthExpired);
  }, []);

  // Check if bot was running before page refresh
  useEffect(() => {
    const wasBotRunning = localStorage.getItem(`bot_running_${walletAddress}`);
    if (wasBotRunning === 'true' && walletAddress && authToken && balance >= 0.3) {
      // Auto-restart bot
      handleRunBot();
    }
  }, [walletAddress, authToken, balance]);

  // Fetch transaction history
  useEffect(() => {
    const fetchTransactions = async () => {
      if (!authToken) return;
      try {
        const response = await apiService.request('/trade/history', {
          headers: { Authorization: `Bearer ${authToken}` },
        });

        console.log('Transactions API response:', response); // Debug log

        const formatted: TransactionItem[] = response.map((t: any, index: number) => {
          // Ensure we have valid data
          if (!t) return null;
          
          // Parse amounts with better error handling
          let amountTokens = 0;
          let amountSol = 0;
          let profitSol: number | undefined = undefined;
          
          try {
            amountTokens = parseFloat(t.amount_tokens || t.token_amount || 0);
          } catch (e) {
            console.warn('Error parsing amount_tokens:', t.amount_tokens);
          }
          
          try {
            amountSol = parseFloat(t.amount_sol || 0);
          } catch (e) {
            console.warn('Error parsing amount_sol:', t.amount_sol);
          }
          
          try {
            profitSol = t.profit_sol !== undefined && t.profit_sol !== null 
              ? parseFloat(t.profit_sol) 
              : undefined;
          } catch (e) {
            console.warn('Error parsing profit_sol:', t.profit_sol);
          }
          
          // Ensure timestamp is valid
          let timestamp = t.timestamp || t.buy_timestamp || t.sell_timestamp || new Date().toISOString();
          try {
            const date = new Date(timestamp);
            if (isNaN(date.getTime())) {
              timestamp = new Date().toISOString();
            }
          } catch (error) {
            timestamp = new Date().toISOString();
          }
          
          // Get token symbol from various possible fields
          const tokenSymbol = t.token_symbol || t.token || t.mint_address?.substring(0, 8) || 'UNKNOWN';
          
          // Get token logo - check multiple possible sources
          const tokenLogo = t.token_logo || 
                          t.token_logo_url || 
                          `https://dd.dexscreener.com/ds-logo/solana/${t.mint_address || 'unknown'}.png`;
          
          // Get transaction type
          const type = t.type || t.trade_type || (t.sell_timestamp ? 'sell' : 'buy');
          
          // Create explorer URLs if we have a transaction hash
          let explorer_urls = undefined;
          if (t.tx_hash || t.buy_tx_hash || t.sell_tx_hash) {
            const txHash = t.tx_hash || t.buy_tx_hash || t.sell_tx_hash;
            explorer_urls = {
              solscan: `https://solscan.io/tx/${txHash}`,
              dexScreener: `https://dexscreener.com/solana/${t.mint_address || txHash}`,
              jupiter: `https://jup.ag/token/${t.mint_address || 'unknown'}`
            };
          }
          
          return {
            id: t.id || `${timestamp}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            type: type,
            token: tokenSymbol,
            token_logo: tokenLogo,
            amount_sol: amountSol,
            amount_tokens: amountTokens,
            tx_hash: t.tx_hash || t.buy_tx_hash || t.sell_tx_hash,
            timestamp: timestamp,
            profit_sol: profitSol,
            mint_address: t.mint_address,
            explorer_urls: explorer_urls
          };
        }).filter(Boolean); // Remove any null entries

        setTransactions(formatted);
        
      } catch (err) {
        console.error("Failed to load transaction history:", err);
      }
    };

    fetchTransactions();
    const interval = setInterval(fetchTransactions, 10000); // Every 10 seconds
    return () => clearInterval(interval);
  }, [authToken]);

  // Fetch user premium status
  useEffect(() => {
    const fetchPremiumStatus = async () => {
      if (!authToken) return;
      try {
        const response = await apiService.request('/snipers/user/profile', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        setIsPremium(response.is_premium || false);
        setCustomRpc({
          https: response.custom_rpc_https || '',
          wss: response.custom_rpc_wss || '',
        });
      } catch (error) {
        console.error('Error fetching user profile:', error);
      }
    };
    if (authToken) fetchPremiumStatus();
  }, [authToken]);

  // Remove the auto-update from form changes
  const handleBuyFormChange = (field: keyof BuyFormData, value: string) => {
    setBuyForm((prev) => {
      const newForm = { ...prev, [field]: value };
      setPendingSettings(prev => ({ ...prev, buy: newForm }));
      setSettingsChanged(true);
      return newForm;
    });
  };

  const handleSellFormChange = (field: keyof SellFormData, value: string | boolean) => {
    setSellForm((prev) => {
      const newForm = { ...prev, [field]: value };
      setPendingSettings(prev => ({ ...prev, sell: newForm }));
      setSettingsChanged(true);
      return newForm;
    });
  };

  const handleSafetyFormChange = (field: keyof typeof safetyForm, value: string | boolean) => {
    setSafetyForm((prev) => {
      const newForm = { ...prev, [field]: value };
      setPendingSettings(prev => ({ ...prev, safety: newForm }));
      setSettingsChanged(true);
      return newForm;
    });
  };

  const formatPercentageOnFocus = (value: string): string => {
    return value.replace('%', '').trim();
  };

  const formatPercentageOnBlur = (value: string): string => {
    if (!value.trim()) return '0%';
    const cleanValue = value.replace('%', '').trim();
    return cleanValue ? `${cleanValue}%` : '0%';
  };

  const formatSolOnFocus = (value: string): string => {
    return value.replace(' SOL', '').trim();
  };

  const formatSolOnBlur = (value: string): string => {
    if (!value.trim()) return '0.0000 SOL';
    const cleanValue = value.replace(' SOL', '').trim();
    return cleanValue ? `${cleanValue} SOL` : '0.0000 SOL';
  };

  // Fetch sniped count
  useEffect(() => {
    const fetchSnipedCount = async () => {
      if (!authToken) return;
      try {
        const response = await apiService.request('/trade/sniped-count', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        console.log('Sniped count API response:', response); // Debug
        setSnipedCount(response.sniped_count || response.count || 0);
      } catch (error) {
        console.error('Error fetching sniped token count:', error);
        setSnipedCount(0); // Set default
      }
    };
    
    fetchSnipedCount();
    // Refresh when new transactions occur
    if (transactions.length > 0) {
      fetchSnipedCount();
    }
  }, [authToken, transactions]);

  // Fetch total profit
  useEffect(() => {
    const fetchTotalProfit = async () => {
      if (!authToken) return;
      try {
        const response = await apiService.request('/trade/lifetime-profit', {
          headers: { Authorization: `Bearer ${authToken}` },
        });
        console.log('Total profit API response:', response); // Debug
        
        // Try multiple possible field names
        const profit = response.total_profit || 
                      response.profit || 
                      response.total_profit_sol || 
                      0;
        
        setTotalProfit(parseFloat(profit) || 0);
      } catch (error) {
        console.error('Error fetching total profit:', error);
        setTotalProfit(0); // Set default
      }
    };
    
    fetchTotalProfit();
    // Refresh when new transactions occur (especially sells)
    if (transactions.some(tx => tx.type === 'sell')) {
      fetchTotalProfit();
    }
  }, [authToken, transactions]);

  const fetchBalance = useCallback(
    async (publicKey: PublicKey): Promise<void> => {
      try {
        const connection = new Connection(config.solana.rpcUrl, 'confirmed');
        const lamports: number = await connection.getBalance(publicKey);
        const solBalance: number = lamports / 1_000_000_000;
        setBalance(solBalance);
      } catch (error) {
        console.error('Error fetching balance:', error);
      }
    },
    []
  );

  useEffect(() => {
    const hasInitialized = { current: false };

    const initializeWallet = async () => {
      if (hasInitialized.current) return;
      hasInitialized.current = true;

      const keypair = getOrCreateWallet();
      setWalletKeypair(keypair);
      const address = keypair.publicKey.toBase58();
      setWalletAddress(address);
      localStorage.setItem('walletAddress', address);

      // Store private key in localStorage (base64-encoded for persistence)
      const privateKeyBytes = keypair.secretKey;
      const privateKeyBase64 = btoa(JSON.stringify(Array.from(privateKeyBytes)));
      localStorage.setItem('solana_bot_pk_base64', privateKeyBase64);

      // Set private key in base58 for display and copying
      const privateKeyBase58 = bs58.encode(privateKeyBytes);
      setPrivateKeyString(privateKeyBase58);

      if (!authToken) {
        try {
          const nonce = await getNonce();
          await verifyWallet(address, keypair.secretKey, nonce);
          await registerWallet(address, keypair.secretKey);
          setIsRegistered(true);
          setAuthToken(localStorage.getItem('authToken'));
        } catch (error) {
          console.error('Wallet registration/verification failed:', error);
        }
      }

      fetchBalance(keypair.publicKey);
      setHasCheckedBalance(true);
    };

    initializeWallet();
  }, [authToken, fetchBalance]);

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(walletAddress);
      setShowCopyMessage('address');
      setTimeout(() => setShowCopyMessage(null), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  const handleCopyPrivateKey = async () => {
    try {
      await navigator.clipboard.writeText(privateKeyString);
      setShowCopyMessage('privateKey');
      setTimeout(() => setShowCopyMessage(null), 2000);
      
      // Only show warning if user hasn't acknowledged it yet
      const hasAcknowledged = localStorage.getItem('privateKeyAcknowledged');
      if (!hasAcknowledged) {
        setShowPrivateKeyWarning(true);
      }
    } catch (err) {
      console.error('Failed to copy private key:', err);
    }
  };

  const handleAcknowledgePrivateKey = () => {
    localStorage.setItem('privateKeyAcknowledged', 'true');
    setShowPrivateKeyWarning(false);
  };

  const handleCheckSolDeposit = () => {
    if (walletKeypair) {
      fetchBalance(walletKeypair.publicKey);
      setHasCheckedBalance(true);
    }
  };

  const handleFundWallet = () => {
    alert(`Please send SOL to: ${walletAddress}`);
    navigator.clipboard.writeText(walletAddress);
  };

  const handleUpgradeClick = () => {
    setShowLoginPopup(true);
  };

  const handleSubscribePremium = async () => {
    try {
      const response = await apiService.request('/subscribe/premium', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({ email: 'user@example.com' }),
      });
      window.location.href = response.payment_intent.client_secret;
    } catch (error) {
      console.error('Subscription error:', error);
    }
  };

  useEffect(() => {
    if (walletKeypair && hasCheckedBalance) {
      setMinimumBalanceMet(balance >= 0.3);
    }
  }, [balance, hasCheckedBalance]);

  // Add this useEffect to send settings when forms change
  useEffect(() => {
    if (isBotRunning) {
      updateBotSettings();
    }
  }, [buyForm, sellForm, safetyForm, isBotRunning, updateBotSettings]);


  const LogsTab = () => (
    <div className="bg-secondary h-[400px] md:h-[600px] flex flex-col">
      {/* Logs content - scrollable */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-3">
          {logs.map((log) => (
            <LogEntryComponent key={log.id} log={log} />
          ))}
          {logs.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              No logs yet. Start the bot to see trading activity.
            </div>
          )}
        </div>
      </div>
      
      {/* Clear Logs Button - positioned at bottom right */}
      <div className="flex justify-end p-3 border-t border-[#333]">
        <button
          onClick={handleClearLogs}
          className="text-xs text-gray-400 hover:text-white transition-colors duration-200 flex items-center gap-1 px-3 py-1 rounded border border-gray-600 hover:border-gray-400 bg-dark-2 hover:bg-dark-1"
          title="Clear all logs"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Clear Logs
        </button>
      </div>
    </div>
  );

  // Update your TransactionsTab to pass the onOpenChart prop
  const TransactionsTab = () => (
    <div className="bg-secondary h-[400px] md:h-[600px] overflow-y-auto">
      {transactions.map((tx) => (
        <TransactionItemComponent 
          key={tx.id} 
          transaction={tx} 
          onOpenChart={(mintAddress) => {
            const trade = activeTrades.find(t => t.mintAddress === mintAddress);
            if (trade) {
              openTradeChart(trade);
            }
          }}
        />
      ))}
      {transactions.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          No transactions yet. Trades will appear here.
        </div>
      )}
    </div>
  );

  const ActiveTradesPanel = () => {
    // Only show when there are active trades
    if (activeTrades.length === 0) return null;

    return (
      <div className="bg-dark-2 border-b border-[#ffffff1e] p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <h3 className="text-white text-sm font-semibold">Active Positions</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 bg-dark-1 px-2 py-1 rounded-full">
              {activeTrades.length} open
            </span>
          </div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-60 overflow-y-auto">
          {activeTrades.map((trade, index) => {
            let timeAgo = 0;
            let timeText = 'Just now';
            
            try {
              const buyDate = new Date(trade.buyTimestamp);
              if (!isNaN(buyDate.getTime())) {
                const diffMinutes = Math.floor((Date.now() - buyDate.getTime()) / 60000);
                const diffHours = Math.floor(diffMinutes / 60);
                
                if (diffHours > 0) {
                  timeText = `${diffHours}h ${diffMinutes % 60}m ago`;
                } else if (diffMinutes > 0) {
                  timeText = `${diffMinutes}m ago`;
                }
              }
            } catch (error) {
              console.error('Error calculating time ago:', error);
            }

            return (
              <div 
                key={`${trade.mintAddress}-${index}`}
                className="bg-dark-1 rounded-xl p-4 border border-[#2a2d45] hover:border-[#3a3f5d] transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/10"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                      <span className="text-white text-xs font-bold">
                        {trade.tokenSymbol?.substring(0, 2) || '??'}
                      </span>
                    </div>
                    <div>
                      <div className="text-white font-medium text-sm">{trade.tokenSymbol || 'Unknown'}</div>
                      <div className="text-gray-400 text-xs">{timeText}</div>
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="space-y-2 mb-3">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-gray-400">Entry Price</span>
                    <span className="text-white font-medium">
                      ${trade.entryPrice?.toFixed(6) || '0.000000'}
                    </span>
                  </div>
                  
                  {trade.takeProfit && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-400">Take Profit</span>
                      <span className="text-green-400 font-medium">
                        ${trade.takeProfit.toFixed(6)}
                      </span>
                    </div>
                  )}
                  
                  {trade.stopLoss && (
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-gray-400">Stop Loss</span>
                      <span className="text-red-400 font-medium">
                        ${trade.stopLoss.toFixed(6)}
                      </span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button
                    onClick={() => openTradeChart(trade)}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                    Chart
                  </button>
                  
                  <button
                    onClick={() => handleManualSell(trade)}
                    className="flex-1 bg-red-600 hover:bg-red-700 text-white text-xs font-medium py-2 px-3 rounded-lg transition-colors flex items-center justify-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                    Sell
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const [showWarningBanner, setShowWarningBanner] = useState(() => {
    // Check localStorage for user preference
    const bannerDismissed = localStorage.getItem('warningBannerDismissed');
    return bannerDismissed !== 'true';
  });
  
  // Add this function to handle closing the banner
  const handleCloseWarningBanner = () => {
    setShowWarningBanner(false);
    localStorage.setItem('warningBannerDismissed', 'true');
  };

  // Add this function to reset/reshow the banner (optional)
  const handleResetWarningBanner = () => {
    setShowWarningBanner(true);
    localStorage.removeItem('warningBannerDismissed');
  };



  if (!walletKeypair) return <div className="text-white text-center py-8">Loading wallet...</div>;

  return (
    <div className="min-h-screen w-full bg-gradient-to-b from-[#10b98166] to-secondary relative">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-20"
        style={{ backgroundImage: 'url(/images/img_grid_layers_v2.png)' }}
      />
      <div className="relative z-10">

        {/* Trading Meme Coins Warning Banner Message at the very Top and Closable */}
        {showWarningBanner && (
          <div className="bg-gradient-to-r from-red-800/20 to-red-900/20 border-b border-red-700/30">
            <div className="container mx-auto px-4 py-2 relative">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-1 justify-center">
                  <svg className="w-4 h-4 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <p className="text-red-200 text-xs text-center font-medium">
                    <span className="font-bold">HIGH RISK:</span> Meme coin trading is speculative. Only invest money you can afford to lose completely.
                  </p>
                </div>
                <button
                  onClick={handleCloseWarningBanner}
                  className="text-red-300 hover:text-white hover:bg-red-700/30 transition-all duration-200 p-1.5 rounded-full flex-shrink-0"
                  aria-label="Dismiss warning message"
                  title="Dismiss"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-50 bg-primary border-b border-[#ffffff21] h-16 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-4">
            {/* Make the entire logo area clickable */}
            <button 
              onClick={() => navigate('/')}
              className="flex items-center gap-4 hover:opacity-80 transition-opacity"
            >
              <img src="/images/img_frame_1171277880.svg" alt="Logo" className="w-3 h-3" />
              <div className="text-white text-sm font-black font-inter">
                <span className="text-white">FLASH </span>
                <span className="text-success">SNIPER</span>
              </div>
            </button>
          </div>
          <button
            className="md:hidden text-white p-2"
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="hidden md:flex items-center gap-8">
            <button 
              onClick={() => navigate('/documentation')}
              className="text-white text-sm font-medium hover:opacity-80 transition-opacity"
            >
              Documentation
            </button>
            <button 
              onClick={() => {
                // Navigate to home page and scroll to FAQ section
                navigate('/');
                // Use setTimeout to ensure navigation completes before scrolling
                setTimeout(() => {
                  const faqSection = document.getElementById('faq');
                  if (faqSection) {
                    const offset = 80; // Account for fixed header
                    const elementPosition = faqSection.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - offset;
                    
                    window.scrollTo({
                      top: offsetPosition,
                      behavior: 'smooth'
                    });
                  }
                }, 100);
              }}
              className="text-white text-sm font-medium hover:opacity-80 transition-opacity"
            >
              Frequently Asked Questions
            </button>
          </div>
          {isMobileMenuOpen && (
            <div className="absolute top-16 left-0 right-0 bg-primary border-b border-[#ffffff21] md:hidden">
              <div className="flex flex-col p-4 space-y-4">
                <button 
                  onClick={() => {
                    navigate('/documentation');
                    setIsMobileMenuOpen(false);
                  }}
                  className="text-white text-sm font-medium hover:opacity-80 transition-opacity text-left"
                >
                  Documentation
                </button>
                <button 
                  onClick={() => {
                    // Navigate to home page and scroll to FAQ section
                    navigate('/');
                    setIsMobileMenuOpen(false);
                    // Use setTimeout to ensure navigation completes before scrolling
                    setTimeout(() => {
                      const faqSection = document.getElementById('faq');
                      if (faqSection) {
                        const offset = 80; // Account for fixed header
                        const elementPosition = faqSection.getBoundingClientRect().top;
                        const offsetPosition = elementPosition + window.pageYOffset - offset;
                        
                        window.scrollTo({
                          top: offsetPosition,
                          behavior: 'smooth'
                        });
                      }
                    }, 100);
                  }}
                  className="text-white text-sm font-medium hover:opacity-80 transition-opacity text-left"
                >
                  Frequently Asked Questions
                </button>
              </div>
            </div>
          )}
        </header>
        
        <div className="flex flex-col items-center justify-center py-8 md:py-16 px-4 md:px-8">
          <h1 className="text-white text-lg font-black text-center mb-4 md:mb-6">Welcome to</h1>
          <div className="flex items-center gap-4 mb-6 md:mb-8">
            <img src="/images/img_frame_1171277880.svg" alt="Logo" className="w-6 h-6 md:w-8 md:h-8" />
            <div className="text-white text-2xl md:text-4xl font-black font-inter">
              <span className="text-white">FLASH </span>
              <span className="text-success">SNIPER</span>
            </div>
          </div>
          <p className="text-white text-sm font-medium text-center max-w-2xl mb-6 md:mb-8 leading-relaxed px-4">
            Velocity. Security. Accuracy. Take control of the Solana market with the quickest and most reliable sniper tool available.
          </p>
          <div className="text-center">
            <p className="text-white text-sm font-medium mb-2">Scroll down to snipe</p>
            <div className="w-px h-4 bg-white mx-auto"></div>
          </div>
        </div>



        <div className="flex flex-col lg:flex-row">
          <div className="lg:order-2 lg:flex-1 bg-overlay">
            <div className="bg-primary border-t border-b border-[#ffffff1e] h-12 flex">
              <button
                onClick={() => setActiveWalletTab('wallet')}
                className={`flex items-center gap-3 px-4 md:px-6 h-full border-b-2 ${
                  activeWalletTab === 'wallet' ? 'text-success border-success' : 'text-white border-transparent'
                }`}
              >
                <img src="/images/img_wallet01_white_a700.svg" alt="Wallet" className="w-4 h-4" />
                <span className="text-sm font-medium">Wallet</span>
              </button>
              <button
                onClick={() => setActiveWalletTab('buySell')}
                className={`flex items-center gap-3 px-4 md:px-6 h-full border-b-2 ${
                  activeWalletTab === 'buySell' ? 'text-success border-success' : 'text-white border-transparent'
                }`}
              >
                <img src="/images/img_exchange01_teal_400.svg" alt="Buy/Sell" className="w-4 h-4" />
                <span className="text-sm font-medium">Buy/Sell</span>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {activeWalletTab === 'wallet' ? (
                <div className="p-4 space-y-4">
                  {showPrivateKeyWarning && (
                    <div className="bg-warning-light border border-[#e7a13a4c] rounded-lg px-4 py-3 shadow-sm">
                      <span className="text-warning font-satoshi font-medium text-[13px] leading-[18px]">
                        Warning: Save your private key securely. Do not share it. It will not be stored by us.
                      </span>
                      <button
                        onClick={handleAcknowledgePrivateKey}
                        className="mt-2 bg-success text-white px-4 py-2 rounded-lg text-sm"
                      >
                        Acknowledge
                      </button>
                    </div>
                  )}
                  <div className="bg-dark-2 rounded-lg border border-[#262944] shadow-lg">

                    <div className="flex items-center justify-between p-4 border-b border-[#000010] shadow-sm">
                      <div className="flex items-center gap-3">
                        <img src="/images/img_wallet01_white_a700.svg" alt="Wallet" className="w-[18px] h-[18px]" />
                        <span className="text-light font-satoshi font-medium text-[13px] leading-[18px]">Your Wallet</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleCheckSolDeposit}
                          className="p-1 hover:bg-white/10 rounded transition-colors"
                          title="Refresh Balance"
                        >
                          <svg className="w-3 h-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                        <div className={`w-2 h-2 rounded-full ${balance >= 0.3 ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`}></div>
                        <span className="text-sm text-gray-400">
                          {balance.toFixed(4)} SOL
                        </span>
                      </div>
                    </div>

                    <div className="p-3 space-y-3">
                      <div className="relative">
                        <input
                          type="text"
                          value={walletAddress}
                          readOnly
                          className="w-full bg-primary border border-[#20233a] rounded-lg px-3 py-3 text-white font-satoshi font-medium text-[13px] leading-[18px] shadow-sm"
                        />
                        {showCopyMessage === 'address' && (
                          <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-success text-white px-2 py-1 rounded text-xs">Copied!</div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={handleCopyAddress}
                          className="flex-1 bg-accent border-t border-[#22253e] rounded-lg px-3 py-3 text-success font-satoshi font-medium text-[13px] leading-[18px] hover:bg-opacity-80 transition-colors shadow-sm"
                        >
                          Copy address
                        </button>
                        <button
                          onClick={handleCopyPrivateKey}
                          className="flex-1 bg-accent border-t border-[#22253e] rounded-lg px-3 py-3 text-success font-satoshi font-medium text-[13px] leading-[18px] hover:bg-opacity-80 transition-colors shadow-sm relative"
                        >
                          Copy private key
                          {showCopyMessage === 'privateKey' && (
                            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 bg-success text-white px-2 py-1 rounded text-xs">Copied!</div>
                          )}
                        </button>
                      </div>
                      {(balance < 0.3 || !hasCheckedBalance) && (
                        <div className="flex items-center justify-center pt-2">
                          <button
                            onClick={() => {
                              handleCheckSolDeposit();
                              setHasCheckedBalance(true);
                            }}
                            className="flex items-center justify-center w-12 h-12 bg-success rounded-full shadow-lg hover:bg-opacity-90 transition-colors"
                            title="Check SOL Balance"
                          >
                            <span className="text-2xl">👍</span>
                          </button>
                          <span className="ml-3 text-white-transparent font-satoshi font-medium text-[11px] leading-[10px]">
                            Click to check your SOL balance (Minimum 0.3 SOL required)
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  {balance < 0.3 && hasCheckedBalance && (
                    <div className="bg-warning-light border border-[#e7a13a4c] rounded-lg px-4 py-3 shadow-sm">
                      <span className="text-warning font-satoshi font-medium text-[13px] leading-[18px]">
                        Please send at least 0.3 SOL to this wallet to enable bot operations.
                      </span>
                    </div>
                  )}
                  <button
                    onClick={isBotRunning ? handleStopBot : handleRunBot}
                    className={`w-full rounded-lg px-4 py-3 font-satoshi font-medium text-[13px] leading-[18px] border transition-all duration-200 shadow-sm ${
                      isBotRunning
                        ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                        : 'bg-success border-white text-white hover:bg-opacity-90'
                    }`}
                    disabled={balance < 0.3 || !hasCheckedBalance}
                  >
                    {isBotRunning ? 'Stop Bot' : 'Run Bot'}
                  </button>
                  <p className="text-white-transparent font-satoshi font-medium text-[11px] leading-[15px] text-center">
                    Start or stop anytime. 1% fee per trade. Starting means you accept our disclaimer
                  </p>
                </div>
              ) : (
                <>
                  <div className="bg-dark-1 rounded-lg shadow-lg">
                    <div className="flex items-center gap-3 p-4 border-b border-[#000010]">
                      <img src="/images/img_bitcoinshopping.svg" alt="Buy" className="w-5 h-5" />
                      <span className="text-light text-base font-medium">Buy</span>
                    </div>
                    <div className="p-4 space-y-4">
                      {balance <= 0 && (
                        <button
                          onClick={handleFundWallet}
                          className="w-full p-3 bg-warning-light border border-[#e7a13a4c] rounded-lg text-warning text-sm font-medium"
                        >
                          Fund your wallet to use the bot
                        </button>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={buyForm.amount}
                            onChange={(value) => handleBuyFormChange('amount', value)}
                            placeholder="Enter amount"
                            suffix="SOL"
                            formatOnFocus={formatSolOnFocus}
                            formatOnBlur={formatSolOnBlur}
                            label="Amount"
                          />
                        </div>
                        <div>
                          <ProfessionalInput
                            value={buyForm.slippage}
                            onChange={(value) => handleBuyFormChange('slippage', value)}
                            placeholder="Enter slippage"
                            suffix="%"
                            formatOnFocus={formatPercentageOnFocus}
                            formatOnBlur={formatPercentageOnBlur}
                            label="Slippage"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="bg-dark-2 rounded-lg shadow-lg">
                    <div className="flex items-center gap-3 p-4 border-b border-[#000010]">
                      <img src="/images/img_bitcoin03.svg" alt="Sell" className="w-5 h-5" />
                      <span className="text-light text-base font-medium">Sell</span>
                    </div>
                    <div className="p-4 space-y-4 border-b border-[#000010]">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={sellForm.takeProfit}
                            onChange={(value) => handleSellFormChange('takeProfit', value)}
                            placeholder="Enter take profit"
                            suffix="%"
                            formatOnFocus={formatPercentageOnFocus}
                            formatOnBlur={formatPercentageOnBlur}
                            label="Take profit"
                          />
                        </div>
                        <div>
                          <ProfessionalInput
                            value={sellForm.stopLoss}
                            onChange={(value) => handleSellFormChange('stopLoss', value)}
                            placeholder="Enter stop loss"
                            suffix="%"
                            formatOnFocus={formatPercentageOnFocus}
                            formatOnBlur={formatPercentageOnBlur}
                            label="Stop loss"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={sellForm.timeout}
                            onChange={(value) => handleSellFormChange('timeout', value)}
                            placeholder="Enter timeout"
                            suffix=" seconds"
                            label="Timeout"
                          />
                        </div>
                        <div>
                          <ProfessionalInput
                            value={sellForm.slippage}
                            onChange={(value) => handleSellFormChange('slippage', value)}
                            placeholder="Enter slippage"
                            suffix="%"
                            formatOnFocus={formatPercentageOnFocus}
                            formatOnBlur={formatPercentageOnBlur}
                            label="Slippage"
                          />
                        </div>
                      </div>
                      {/* <div className="bg-accent border-t border-[#22253e] rounded-lg p-3 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={sellForm.useOwnRPC}
                          onChange={(e) => handleSellFormChange('useOwnRPC', e.target.checked)}
                          className="w-6 h-6"
                        />
                        <span className="text-muted text-sm font-medium">Use your own RPC</span>
                      </div> */}
                      {sellForm.useOwnRPC && (
                        <>
                          {isPremium ? (
                            <div className="space-y-4">
                              <div>
                                <label className="block text-muted text-sm font-medium mb-2">RPC HTTPS Endpoint</label>
                                <input
                                  type="text"
                                  value={customRpc.https}
                                  onChange={(e) => setCustomRpc({ ...customRpc, https: e.target.value })}
                                  placeholder="Enter HTTPS RPC endpoint"
                                  className="w-full bg-accent border-t border-[#22253e] rounded-lg p-3 text-white text-sm font-medium"
                                />
                              </div>
                              <div>
                                <label className="block text-muted text-sm font-medium mb-2">RPC WSS Endpoint</label>
                                <input
                                  type="text"
                                  value={customRpc.wss}
                                  onChange={(e) => setCustomRpc({ ...customRpc, wss: e.target.value })}
                                  placeholder="Enter WSS RPC endpoint"
                                  className="w-full bg-accent border-t border-[#22253e] rounded-lg p-3 text-white text-sm font-medium"
                                />
                              </div>
                              <button
                                onClick={async () => {
                                  try {
                                    const response = await fetch('/api/snipers/user/update-rpc', {
                                      method: 'POST',
                                      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
                                      body: JSON.stringify(customRpc),
                                    });
                                    if (!response.ok) {
                                      throw new Error(`HTTP error! Status: ${response.status}`);
                                    }
                                  } catch (error) {
                                    console.error('Error saving RPC settings:', error);
                                  }
                                }}
                                className="w-full bg-success text-white text-sm font-medium py-3 rounded-lg"
                              >
                                Save RPC Settings
                              </button>
                            </div>
                          ) : (
                            <div className="bg-warning-light border border-[#e7a13a4c] rounded-lg p-3 text-warning text-sm font-medium">
                              Custom RPC endpoints are available with a Premium subscription.{' '}
                              <button onClick={handleUpgradeClick} className="underline text-success">
                                Upgrade now
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* <JitoTipSection /> */}

                  {/* Safety Section */}
                  {/* <div className="bg-dark-2 rounded-lg shadow-lg relative">
                    <div className="flex items-center gap-3 p-4 border-b border-[#000010]">
                      <img src="/images/img_flash.svg" alt="Safety" className="w-5 h-5" />
                      <span className="text-light text-base font-medium">Safety</span>
                    </div>
                    <div className={`p-4 space-y-4 ${!isPremium ? 'blur-[0.5px] pointer-events-none' : ''}`}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={safetyForm.top10HoldersMax}
                            onChange={(value) => handleSafetyFormChange('top10HoldersMax', value)}
                            placeholder="Enter max %"
                            suffix="%"
                            formatOnFocus={formatPercentageOnFocus}
                            formatOnBlur={formatPercentageOnBlur}
                            label="Top 10 Holders Max"
                          />
                        </div>
                        <div>
                          <ProfessionalInput
                            value={safetyForm.bundledMax}
                            onChange={(value) => handleSafetyFormChange('bundledMax', value)}
                            placeholder="Enter max bundled"
                            label="Bundled Max"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={safetyForm.maxSameBlockBuys}
                            onChange={(value) => handleSafetyFormChange('maxSameBlockBuys', value)}
                            placeholder="Enter max buys"
                            label="Max Same Block Buys"
                          />
                        </div>
                        <div>
                          <ProfessionalInput
                            value={safetyForm.safetyCheckPeriod}
                            onChange={(value) => handleSafetyFormChange('safetyCheckPeriod', value)}
                            placeholder="Enter period"
                            suffix=" seconds"
                            label="Safety Check Period"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="block text-muted text-sm font-medium mb-2">Choose DEXes</label>
                        <select
                          value={safetyForm.selectedDex}
                          onChange={(e) => handleSafetyFormChange('selectedDex', e.target.value)}
                          className="w-full bg-accent border-t border-[#22253e] rounded-lg p-3 text-white text-sm font-medium"
                        >
                          <option value="Raydium">Raydium</option>
                          <option value="Jupiter">Jupiter</option>
                          <option value="OKX">OKX</option>
                          <option value="Orca">Orca</option>
                          <option value="Meteora">Meteora</option>
                        </select>
                      </div>
                      <div className="bg-accent border-t border-[#22253e] rounded-lg p-3 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={safetyForm.immutableMetadata}
                          onChange={(e) => handleSafetyFormChange('immutableMetadata', e.target.checked)}
                          className="w-6 h-6"
                        />
                        <span className="text-muted text-sm font-medium">Immutable Metadata</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <ProfessionalInput
                            value={safetyForm.webacyRiskMax}
                            onChange={(value) => handleSafetyFormChange('webacyRiskMax', value)}
                            placeholder="Enter max risk"
                            label="Webacy Risk Max"
                          />
                        </div>
                      </div>
                      <div className="bg-accent border-t border-[#22253e] rounded-lg p-3 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={safetyForm.mintAuthorityRenounced}
                          onChange={(e) => handleSafetyFormChange('mintAuthorityRenounced', e.target.checked)}
                          className="w-6 h-6"
                        />
                        <span className="text-muted text-sm font-medium">Mint Authority Renounced</span>
                      </div>
                      <div className="bg-accent border-t border-[#22253e] rounded-lg p-3 flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={safetyForm.freezeAuthorityRenounced}
                          onChange={(e) => handleSafetyFormChange('freezeAuthorityRenounced', e.target.checked)}
                          className="w-6 h-6"
                        />
                        <span className="text-muted text-sm font-medium">Freeze Authority Renounced</span>
                      </div>
                    </div>

                    {!isPremium && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-30 rounded-lg">
                        <div className="text-center p-6 bg-dark-2 rounded-lg border border-[#22253e] shadow-lg">
                          <h3 className="text-white text-lg font-medium mb-4">Unlock Advanced Filters with Premium</h3>
                          <p className="text-white-transparent text-sm mb-6 leading-relaxed">
                            Limited 20% OFF Deal ends soon! Get access to advanced filters like{' '}
                            <strong>Top Holders Max, Bundled Max, Max Same Block Buys, and custom DEXes</strong> to optimize
                            your trades and avoid scams.
                          </p>
                          <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <button
                              onClick={handleUpgradeClick}
                              className="bg-success text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center gap-2 hover:bg-opacity-90 transition-colors"
                            >
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
                                />
                              </svg>
                              Upgrade and Profit
                            </button>
                            <button
                              onClick={() => navigate('/#pricing')}
                              className="bg-accent text-white text-sm font-medium py-2 px-4 rounded-lg flex items-center gap-2 hover:bg-opacity-90 transition-colors"
                            >
                              Pricing
                              <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                                xmlns="http://www.w3.org/2000/svg"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                                />
                              </svg>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div> */}

                  {showLoginPopup && (
                    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
                      <div className="bg-dark-2 rounded-lg p-6 sm:p-8 w-full max-w-[90vw] sm:max-w-[400px] border border-[#22253e] shadow-xl">
                        <div className="flex justify-between items-center mb-6">
                          <h3 className="text-white text-xl font-medium">Sign In to Upgrade</h3>
                          <button
                            onClick={() => setShowLoginPopup(false)}
                            className="text-white-transparent hover:text-white transition-colors"
                            aria-label="Close modal"
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                        <div className="space-y-4">
                          <button
                            className="w-full bg-accent border-t border-[#22253e] text-white text-sm font-medium py-3 rounded-lg hover:bg-opacity-90 transition-colors flex items-center justify-center gap-2"
                            onClick={() => setShowLoginPopup(false)}
                          >
                            <svg
                              className="w-5 h-5"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 8l9-6 9 6v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
                              />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l9 6 9-6" />
                            </svg>
                            Sign in with Email
                          </button>
                          <div className="flex items-center justify-center gap-4">
                            <div className="flex-1 h-px bg-[#22253e]"></div>
                            <span className="text-white-transparent text-sm font-medium">OR</span>
                            <div className="flex-1 h-px bg-[#22253e]"></div>
                          </div>
                          <button
                            className="w-full bg-accent border-t border-[#22253e] text-white text-sm font-medium py-3 rounded-lg hover:bg-opacity-90 transition-colors flex items-center justify-center gap-2"
                            onClick={() => setShowLoginPopup(false)}
                          >
                            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                              <path d="M12.24 10.667H7.936v2.666h4.304c-.186 1.114-.746 2.054-1.614 2.667-.866.613-1.986.946-3.206.946-2.48 0-4.574-1.68-5.34-3.946-.133-.373-.2-.76-.2-1.16 0-.4.067-.787.2-1.16.766-2.267 2.86-3.947 5.34-3.947 1.24 0 2.36.333 3.226.946l1.92-1.92C10.776 3.48 8.876 2.667 6.976 2.667c-3.24 0-6.094 1.613-7.814 4.08-.533.773-.986 1.64-1.306 2.587-.32.947-.48 1.947-.48 3 0 1.053.16 2.053.48 3 .32.947.773 1.814 1.306 2.587 1.72 2.467 4.574 4.08 7.814 4.08 1.92 0 3.64-.507 5.094-1.467 1.454-.96 2.587-2.32 3.334-3.986.746-1.667.986-3.494.706-5.294-.08-.533-.24-1.04-.426-1.507l-4.96.007z" />
                            </svg>
                            Sign in with Google
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {!isBotRunning ? (
                    <button
                      onClick={handleRunBot}
                      className="w-full bg-success text-white text-sm font-medium py-3 rounded-lg border border-white shadow-sm hover:bg-opacity-90 transition-colors"
                      disabled={balance <= 0}
                    >
                      Run Bot
                    </button>
                  ) : (
                    <button
                      onClick={handleStopBot}
                      className="w-full bg-error text-white text-sm font-medium py-3 rounded-lg border border-white shadow-sm hover:bg-opacity-90 transition-colors"
                    >
                      Stop Bot
                    </button>
                  )}
                  <p className="text-white-transparent text-xs font-medium text-center leading-relaxed">
                    Start or stop anytime. 1% fee per trade. Starting means you accept our disclaimer
                  </p>
                </>
              )}
            </div>
          </div>

          <div className="lg:order-1 lg:w-[823px] bg-secondary border-r border-[#ffffff21]">
            {/* Active Trades Panel - Only show when there are active trades */}
            {/* {activeTrades.length > 0 && <ActiveTradesPanel />} */}
            
            {/* Tabs Header */}
            <div className="bg-primary border-t border-b border-[#ffffff1e] h-12 flex">
              <button
                onClick={() => setActiveTab('logs')}
                className={`flex items-center gap-3 px-4 md:px-6 h-full border-b-2 ${
                  activeTab === 'logs' ? 'text-success border-success' : 'text-white border-transparent'
                }`}
              >
                <img src="/images/img_license_white_a700.svg" alt="Logs" className={`w-4 h-4 ${activeTab === 'logs' ? '' : 'opacity-70'}`} />
                <span className="text-sm font-medium">Logs</span>
              </button>
              <button
                onClick={() => setActiveTab('transactions')}
                className={`flex items-center gap-3 px-4 md:px-6 h-full border-b-2 ${
                  activeTab === 'transactions' ? 'text-success border-success' : 'text-white border-transparent'
                }`}
              >
                <img
                  src="/images/img_transactionhistory_teal_400.svg"
                  alt="Transactions"
                  className={`w-4 h-4 ${activeTab === 'transactions' ? '' : 'opacity-70'}`}
                />
                <span className="text-sm font-medium">Transactions</span>
              </button>
            </div>
            
            {/* Stats Bar */}
            <div className="bg-secondary border-b border-[#ffffff1e] h-11 flex items-center justify-between px-4">
              <span className="text-white text-sm font-medium">
                Tokens sniped: {snipedCount}
                {isBotRunning && (
                  <span className="ml-2 text-green-400 text-xs">● Live</span>
                )}
              </span>
              <span className={totalProfit >= 0 ? "text-teal-400 font-medium" : "text-red-500 font-medium"}>
                {totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(4)} SOL
              </span>
            </div>
            
            {/* Tab Content */}
            {activeTab === 'logs' ? <LogsTab /> : <TransactionsTab />}
          </div>

        </div>
        <footer className="bg-secondary border-t border-[#ffffff21] h-12 flex items-center justify-between px-4 md:px-8">
          <span className="text-white text-sm font-medium">© 2025 | FlashSniper.com | Disclaimer</span>
          <div className="flex items-center gap-6 md:gap-10">
            <a href="https://twitter.com/flashsniper" target="_blank" rel="noopener noreferrer">
              <img src="/images/img_newtwitter.svg" alt="Twitter" className="w-4 h-4" />
            </a>
            <a href="https://t.me/flashsniper" target="_blank" rel="noopener noreferrer">
              <img src="/images/img_telegram.svg" alt="Telegram" className="w-4 h-4" />
            </a>
            <a href="https://discord.gg/flashsniper" target="_blank" rel="noopener noreferrer">
              <img src="/images/img_discord.svg" alt="Discord" className="w-4 h-4" />
            </a>
          </div>
        </footer>
        {/* {showChart && selectedTrade && (
          <EnhancedTradingChart
            mintAddress={selectedTrade.mintAddress}
            pairAddress={selectedTrade.pairAddress}
            tokenSymbol={selectedTrade.tokenSymbol}
            entryPrice={selectedTrade.entryPrice}
            takeProfit={selectedTrade.takeProfit}
            stopLoss={selectedTrade.stopLoss}
            isActive={showChart}
            onChartClose={closeChart}
            onSellClick={handleManualSell}
          />
        )} */}

      </div>
    </div>
  );
};

export default FlashSniperTradingInterface;


