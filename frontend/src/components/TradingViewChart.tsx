import React, { useEffect, useRef, useState } from 'react';

interface TradingViewChartProps {
  pairAddress: string;
  mintAddress: string;
  tokenSymbol: string;
  entryPrice?: number;
  takeProfit?: number;
  stopLoss?: number;
  isActive: boolean;
  onChartClose?: () => void;
}

const TradingViewChart: React.FC<TradingViewChartProps> = ({
  pairAddress,
  mintAddress,
  tokenSymbol,
  entryPrice,
  takeProfit,
  stopLoss,
  isActive,
  onChartClose
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [chartLoaded, setChartLoaded] = useState(false);

  useEffect(() => {
    if (!isActive || !containerRef.current || chartLoaded) return;

    // Load TradingView widget script
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol: `BINANCE:${tokenSymbol}USDT`, // Fallback - we'll use DexScreener data
      interval: '1',
      timezone: 'Etc/UTC',
      theme: 'dark',
      style: '1',
      locale: 'en',
      enable_publishing: false,
      allow_symbol_change: false,
      container_id: 'tradingview_chart',
      studies: [
        "RSI@tv-basicstudies",
        "MACD@tv-basicstudies",
        "Volume@tv-basicstudies"
      ],
      support_host: "https://www.tradingview.com"
    });

    containerRef.current.appendChild(script);
    setChartLoaded(true);

    return () => {
      if (containerRef.current && script.parentNode === containerRef.current) {
        containerRef.current.removeChild(script);
      }
    };
  }, [isActive, tokenSymbol, chartLoaded]);

  if (!isActive) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
      <div className="bg-dark-2 rounded-lg w-full max-w-6xl h-[80vh] flex flex-col">
        {/* Chart Header */}
        <div className="flex items-center justify-between p-4 border-b border-[#22253e]">
          <div className="flex items-center gap-3">
            <h2 className="text-white text-lg font-bold">
              {tokenSymbol} - Live Chart
            </h2>
            {entryPrice && (
              <div className="flex items-center gap-4 text-sm">
                <span className="text-blue-400">Entry: ${entryPrice.toFixed(6)}</span>
                {takeProfit && (
                  <span className="text-green-400">TP: ${takeProfit.toFixed(6)}</span>
                )}
                {stopLoss && (
                  <span className="text-red-400">SL: ${stopLoss.toFixed(6)}</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onChartClose}
            className="text-white hover:text-gray-300 transition-colors p-2"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* TradingView Chart */}
        <div className="flex-1 relative">
          <div 
            ref={containerRef} 
            className="tradingview-widget-container w-full h-full"
            id="tradingview_chart"
          >
            <div className="tradingview-widget-container__widget w-full h-full"></div>
          </div>
          
          {/* Fallback DexScreener Embed */}
          {pairAddress && (
            <div className="absolute inset-0">
              <iframe
                src={`https://dexscreener.com/solana/${pairAddress}?embed=1&info=0&theme=dark`}
                className="w-full h-full border-0"
                title={`${tokenSymbol} Chart`}
              />
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="flex items-center justify-between p-4 border-t border-[#22253e] bg-dark-1">
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <span>Real-time monitoring active</span>
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
          </div>
          <div className="flex gap-2">
            <button className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors">
              Adjust TP/SL
            </button>
            <button className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors">
              Emergency Sell
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TradingViewChart;

