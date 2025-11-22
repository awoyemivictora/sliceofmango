import React, { useEffect, useState } from 'react';

interface EnhancedTradingChartProps {
  mintAddress: string;
  pairAddress?: string;
  tokenSymbol: string;
  entryPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  isActive: boolean;
  onChartClose: () => void;
  onSellClick?: () => void;
}

const EnhancedTradingChart: React.FC<EnhancedTradingChartProps> = ({
  mintAddress,
  pairAddress,
  tokenSymbol,
  entryPrice,
  takeProfit,
  stopLoss,
  isActive,
  onChartClose,
  onSellClick
}) => {
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);
  const [priceChange, setPriceChange] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch current price data
  useEffect(() => {
    if (!isActive || !pairAddress) return;

    const fetchPriceData = async () => {
      try {
        const response = await fetch(`https://api.dexscreener.com/latest/dex/pairs/solana/${pairAddress}`);
        const data = await response.json();
        
        if (data.pair) {
          setCurrentPrice(parseFloat(data.pair.priceUsd));
          setPriceChange(parseFloat(data.pair.priceChange.h24));
          setIsLoading(false);
        }
      } catch (error) {
        console.error('Error fetching price data:', error);
      }
    };

    fetchPriceData();
    const interval = setInterval(fetchPriceData, 3000); // Update every 3 seconds

    return () => clearInterval(interval);
  }, [isActive, pairAddress]);

  if (!isActive) return null;

  const getProfitLoss = () => {
    if (!currentPrice || !entryPrice) return 0;
    return ((currentPrice - entryPrice) / entryPrice) * 100;
  };

  const profitLoss = getProfitLoss();
  const isInProfit = profitLoss >= 0;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-95 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-2 rounded-xl w-full max-w-7xl h-[90vh] flex flex-col border border-[#22253e] shadow-2xl">
        {/* Enhanced Header */}
        <div className="flex items-center justify-between p-6 border-b border-[#22253e] bg-gradient-to-r from-dark-1 to-dark-2">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <span className="text-white font-bold text-sm">
                  {tokenSymbol?.substring(0, 3)}
                </span>
              </div>
              <div>
                <h2 className="text-white text-xl font-bold">
                  {tokenSymbol}
                </h2>
                <p className="text-gray-400 text-sm">
                  {mintAddress?.substring(0, 8)}...{mintAddress?.substring(mintAddress.length - 8)}
                </p>
              </div>
            </div>
            
            {/* Price Indicators */}
            <div className="flex items-center gap-6 ml-4">
              {currentPrice && (
                <div className="text-center">
                  <div className="text-white text-2xl font-bold">
                    ${currentPrice.toFixed(6)}
                  </div>
                  <div className={`text-sm ${priceChange >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}% (24h)
                  </div>
                </div>
              )}
              
              {entryPrice && (
                <div className="text-center">
                  <div className="text-blue-400 text-sm">Entry Price</div>
                  <div className="text-white font-semibold">${entryPrice.toFixed(6)}</div>
                </div>
              )}
              
              {profitLoss !== 0 && (
                <div className="text-center">
                  <div className="text-gray-400 text-sm">P&L</div>
                  <div className={`font-bold ${isInProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {isInProfit ? '+' : ''}{profitLoss.toFixed(2)}%
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onSellClick}
              className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 transition-colors shadow-lg"
            >
              Sell Now
            </button>
            <button
              onClick={onChartClose}
              className="p-3 text-gray-400 hover:text-white transition-colors rounded-lg hover:bg-dark-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Chart Area */}
        <div className="flex-1 flex">
          {/* TradingView/DexScreener Chart */}
          <div className="flex-1 relative">
            {pairAddress ? (
              <iframe
                src={`https://dexscreener.com/solana/${pairAddress}?embed=1&info=0&theme=dark&trades=0`}
                className="w-full h-full border-0"
                title={`${tokenSymbol} Live Chart`}
                onLoad={() => setIsLoading(false)}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-dark-1">
                <div className="text-center">
                  <div className="text-gray-400 text-lg">Chart loading...</div>
                  <div className="text-gray-500 text-sm mt-2">Pair address not available</div>
                </div>
              </div>
            )}
            
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-dark-1 bg-opacity-80">
                <div className="text-white text-lg">Loading chart...</div>
              </div>
            )}
          </div>

          {/* Side Panel with Trade Info */}
          <div className="w-80 border-l border-[#22253e] bg-dark-1 p-6">
            <h3 className="text-white text-lg font-semibold mb-6">Trade Information</h3>
            
            <div className="space-y-4">
              {/* Entry Point */}
              {entryPrice && (
                <div className="bg-blue-500 bg-opacity-10 border border-blue-500 border-opacity-30 rounded-lg p-4">
                  <div className="text-blue-400 text-sm font-medium">Entry Price</div>
                  <div className="text-white text-xl font-bold">${entryPrice.toFixed(6)}</div>
                </div>
              )}

              {/* Take Profit */}
              {takeProfit && (
                <div className="bg-green-500 bg-opacity-10 border border-green-500 border-opacity-30 rounded-lg p-4">
                  <div className="text-green-400 text-sm font-medium">Take Profit</div>
                  <div className="text-white text-xl font-bold">${takeProfit.toFixed(6)}</div>
                  {entryPrice && (
                    <div className="text-green-400 text-sm mt-1">
                      +{(((takeProfit - entryPrice) / entryPrice) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}

              {/* Stop Loss */}
              {stopLoss && (
                <div className="bg-red-500 bg-opacity-10 border border-red-500 border-opacity-30 rounded-lg p-4">
                  <div className="text-red-400 text-sm font-medium">Stop Loss</div>
                  <div className="text-white text-xl font-bold">${stopLoss.toFixed(6)}</div>
                  {entryPrice && (
                    <div className="text-red-400 text-sm mt-1">
                      -{(((entryPrice - stopLoss) / entryPrice) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}

              {/* Current Status */}
              {currentPrice && entryPrice && (
                <div className={`rounded-lg p-4 ${
                  isInProfit 
                    ? 'bg-green-500 bg-opacity-10 border border-green-500 border-opacity-30'
                    : 'bg-red-500 bg-opacity-10 border border-red-500 border-opacity-30'
                }`}>
                  <div className="text-white text-sm font-medium">Current P&L</div>
                  <div className={`text-xl font-bold ${isInProfit ? 'text-green-400' : 'text-red-400'}`}>
                    {isInProfit ? '+' : ''}{profitLoss.toFixed(2)}%
                  </div>
                  <div className="text-white text-sm mt-1">
                    ${Math.abs(currentPrice - entryPrice).toFixed(6)}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="space-y-2 mt-6">
                <button 
                  onClick={onSellClick}
                  className="w-full bg-red-600 text-white py-3 rounded-lg font-semibold hover:bg-red-700 transition-colors"
                >
                  Sell Position
                </button>
                <button className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                  Adjust Settings
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Status Bar */}
        <div className="border-t border-[#22253e] bg-dark-1 p-4">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                <span className="text-green-400">Live Monitoring Active</span>
              </div>
              <div className="text-gray-400">
                Auto-closes when position is sold
              </div>
            </div>
            <div className="text-gray-400">
              Last update: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EnhancedTradingChart;

