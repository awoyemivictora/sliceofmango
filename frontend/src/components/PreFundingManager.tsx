import React, { useState, useEffect } from 'react';
import { tokenLaunchService } from '@/services/tokenLaunch';
import { LaunchConfig } from '@/services/tokenLaunch';

interface PreFundingManagerProps {
  botCount: number;
  onPreFundComplete: (result: any) => void;
  onUsePreFunded: () => void;
  launchConfig: LaunchConfig;
}

const PreFundingManager: React.FC<PreFundingManagerProps> = ({
  botCount,
  onPreFundComplete,
  onUsePreFunded,
  launchConfig
}) => {
  const [isPreFunding, setIsPreFunding] = useState(false);
  const [preFundStatus, setPreFundStatus] = useState<'idle' | 'preparing' | 'funding' | 'complete' | 'failed'>('idle');
  const [preFundResult, setPreFundResult] = useState<any>(null);
  const [preFundedBots, setPreFundedBots] = useState<any[]>([]);
  const [usePreFunded, setUsePreFunded] = useState(false);
  const [preFundAmount, setPreFundAmount] = useState(launchConfig.botWalletBuyAmount * 2);
  const [showPreFundOptions, setShowPreFundOptions] = useState(false);

  useEffect(() => {
    checkPreFundedBots();
  }, []);

  const checkPreFundedBots = async () => {
    try {
      const bots = await tokenLaunchService.getPreFundedBots();
      setPreFundedBots(bots);
      
      if (bots.length >= botCount) {
        setUsePreFunded(true);
      }
    } catch (error) {
      console.error('Failed to check pre-funded bots:', error);
    }
  };

  const handlePreFundBots = async () => {
    if (isPreFunding) return;

    setIsPreFunding(true);
    setPreFundStatus('preparing');

    try {
      // Calculate pre-fund amount (buy amount * 2 for fees)
      const calculatedPreFundAmount = launchConfig.botWalletBuyAmount * 2;
      setPreFundAmount(calculatedPreFundAmount);

      const request = {
        bot_count: botCount,
        pre_fund_amount: calculatedPreFundAmount,
        buy_amount: launchConfig.botWalletBuyAmount
      };

      setPreFundStatus('funding');
      const result = await tokenLaunchService.preFundBotWallets(request);

      if (result.success) {
        setPreFundStatus('complete');
        setPreFundResult(result);
        onPreFundComplete(result);
        
        // Update pre-funded bots list
        await checkPreFundedBots();
        
        // Auto-select use pre-funded for next launch
        setUsePreFunded(true);
      } else {
        setPreFundStatus('failed');
      }
    } catch (error: any) {
      console.error('Pre-funding failed:', error);
      setPreFundStatus('failed');
      alert(`Pre-funding failed: ${error.message || 'Unknown error'}`);
    } finally {
      setIsPreFunding(false);
    }
  };

  const handleResetPreFunding = async (botId: number) => {
    try {
      await tokenLaunchService.resetBotPreFunding(botId);
      await checkPreFundedBots();
      alert('Bot pre-funding reset successfully');
    } catch (error) {
      console.error('Failed to reset pre-funding:', error);
      alert('Failed to reset pre-funding');
    }
  };

  const handleStartWithPreFunded = () => {
    setUsePreFunded(true);
    onUsePreFunded();
  };

  // Calculate costs
  const totalPreFundCost = botCount * preFundAmount;
  const regularCost = botCount * launchConfig.botWalletBuyAmount;
  const costSavings = regularCost - (preFundedBots.length * launchConfig.botWalletBuyAmount);

  return (
    <div className="bg-gradient-to-br from-gray-900/50 to-dark-2/50 backdrop-blur-sm rounded-2xl p-6 border border-gray-800/50 mb-6 shadow-lg">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-xl flex items-center justify-center shadow-lg">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h3 className="text-white font-bold text-lg">Bot Pre-Funding</h3>
            <p className="text-sm text-gray-400">Speed up launches with pre-funded bots</p>
          </div>
        </div>
        
        <button
          onClick={() => setShowPreFundOptions(!showPreFundOptions)}
          className="px-4 py-2 bg-gray-800/50 hover:bg-gray-700/50 text-gray-300 hover:text-white rounded-lg border border-gray-700/50 transition-all flex items-center gap-2"
        >
          <span>{showPreFundOptions ? 'Hide' : 'Show'} Options</span>
          <svg className={`w-4 h-4 transition-transform ${showPreFundOptions ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Pre-funded Status Summary */}
      <div className="mb-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50">
            <div className="text-2xl font-bold text-emerald-400">{preFundedBots.length}</div>
            <div className="text-xs text-gray-400 mt-1">Pre-Funded Bots</div>
            <div className="text-xs text-gray-500 mt-2">
              Available for atomic launches
            </div>
          </div>
          
          <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50">
            <div className="text-2xl font-bold text-blue-400">
              {preFundedBots.reduce((sum, bot) => sum + (bot.pre_funded_amount || 0), 0).toFixed(4)}
            </div>
            <div className="text-xs text-gray-400 mt-1">Total Pre-Funded</div>
            <div className="text-xs text-gray-500 mt-2">
              Ready for immediate use
            </div>
          </div>
          
          <div className="bg-gray-900/30 rounded-xl p-4 border border-gray-800/50">
            <div className="text-2xl font-bold text-amber-400">
              {costSavings > 0 ? `-${costSavings.toFixed(4)}` : '0.0000'}
            </div>
            <div className="text-xs text-gray-400 mt-1">Cost Savings</div>
            <div className="text-xs text-gray-500 mt-2">
              vs regular funding per launch
            </div>
          </div>
        </div>
      </div>

      {showPreFundOptions && (
        <div className="space-y-6">
          {/* Pre-Fund New Bots Section */}
          <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800/50">
            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Pre-Fund New Bot Wallets
            </h4>
            
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Bots to Pre-Fund</label>
                  <div className="text-white font-medium text-lg">{botCount} bots</div>
                </div>
                
                <div>
                  <label className="block text-gray-400 text-sm mb-2">Pre-Fund Amount Each</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.0001"
                      min={launchConfig.botWalletBuyAmount}
                      value={preFundAmount}
                      onChange={(e) => setPreFundAmount(parseFloat(e.target.value))}
                      className="flex-1 bg-gray-900/50 border border-gray-700/50 rounded-lg p-3 text-white focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/30 transition-all"
                    />
                    <span className="text-gray-400 text-sm">SOL</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    Recommended: {launchConfig.botWalletBuyAmount * 2} SOL (buy amount × 2)
                  </p>
                </div>
              </div>
              
              <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm text-gray-300">Total Pre-Fund Cost:</span>
                  <span className="text-xl font-bold text-blue-400">
                    {totalPreFundCost.toFixed(4)} SOL
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  {botCount} bots × {preFundAmount.toFixed(4)} SOL each
                </div>
              </div>
              
              <button
                onClick={handlePreFundBots}
                disabled={isPreFunding}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                  isPreFunding
                    ? 'bg-gray-700 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-500 to-cyan-500 hover:from-blue-600 hover:to-cyan-600 text-white shadow-lg hover:shadow-blue-500/25'
                }`}
              >
                {isPreFunding ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    <span>Pre-Funding Bots...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>Pre-Fund {botCount} Bot Wallets</span>
                  </>
                )}
              </button>
            </div>
            
            {preFundStatus === 'complete' && preFundResult && (
              <div className="mt-4 p-4 bg-emerald-900/20 border border-emerald-500/30 rounded-lg">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-emerald-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div>
                    <h5 className="text-emerald-400 font-medium mb-1">Pre-Funding Complete!</h5>
                    <p className="text-sm text-emerald-300/80">
                      Successfully pre-funded {preFundResult.pre_funded_count} bots with {preFundResult.total_pre_funded.toFixed(4)} SOL
                    </p>
                    {preFundResult.bundle_id && (
                      <p className="text-xs text-emerald-300/60 mt-1">
                        Bundle ID: {preFundResult.bundle_id.slice(0, 8)}...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
          
          {/* Use Pre-Funded Bots Section */}
          <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800/50">
            <h4 className="text-white font-bold mb-4 flex items-center gap-2">
              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Use Pre-Funded Bots for Launch
            </h4>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-white font-medium">
                    {preFundedBots.length} / {botCount} bots available
                  </div>
                  <div className="text-sm text-gray-400">
                    Ready for atomic launches
                  </div>
                </div>
                
                <div className="flex items-center gap-2">
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={usePreFunded}
                      onChange={(e) => setUsePreFunded(e.target.checked)}
                      className="sr-only peer"
                      disabled={preFundedBots.length < botCount}
                    />
                    <div className={`w-11 h-6 rounded-full peer peer-focus:outline-none ${
                      preFundedBots.length < botCount
                        ? 'bg-gray-700 cursor-not-allowed'
                        : 'bg-gray-700 peer-checked:bg-emerald-500'
                    }`}>
                      <div className={`absolute top-[2px] left-[2px] bg-white rounded-full h-5 w-5 transition-transform ${
                        usePreFunded ? 'transform translate-x-full' : ''
                      }`}></div>
                    </div>
                  </label>
                  <span className={`text-sm ${
                    preFundedBots.length < botCount ? 'text-gray-500' : 'text-gray-300'
                  }`}>
                    Use Pre-Funded
                  </span>
                </div>
              </div>
              
              {preFundedBots.length < botCount && (
                <div className="bg-amber-900/20 border border-amber-500/30 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-amber-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.998-.833-2.732 0L4.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="text-sm text-amber-300">
                      Need {botCount - preFundedBots.length} more pre-funded bots. 
                      {preFundedBots.length > 0 ? ' You can still launch with available bots.' : ' Pre-fund bots first.'}
                    </div>
                  </div>
                </div>
              )}
              
              <button
                onClick={handleStartWithPreFunded}
                disabled={!usePreFunded || preFundedBots.length === 0}
                className={`w-full py-3 px-4 rounded-lg font-medium transition-all flex items-center justify-center gap-2 ${
                  !usePreFunded || preFundedBots.length === 0
                    ? 'bg-gray-700 cursor-not-allowed text-gray-400'
                    : 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white shadow-lg hover:shadow-emerald-500/25'
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                <span>Start Atomic Launch with Pre-Funded Bots</span>
              </button>
              
              <p className="text-xs text-gray-500 text-center">
                Atomic launches with pre-funded bots are 3-5x faster
              </p>
            </div>
          </div>
          
          {/* Pre-Funded Bots List */}
          {preFundedBots.length > 0 && (
            <div className="bg-gray-900/30 rounded-xl p-5 border border-gray-800/50">
              <h4 className="text-white font-bold mb-4">Pre-Funded Bot Wallets</h4>
              
              <div className="space-y-3 max-h-60 overflow-y-auto">
                {preFundedBots.map((bot) => (
                  <div key={bot.id} className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-800/50">
                    <div>
                      <div className="text-white font-mono text-sm">
                        {bot.public_key.slice(0, 8)}...{bot.public_key.slice(-4)}
                      </div>
                      <div className="text-xs text-gray-500">
                        Pre-funded: {bot.pre_funded_amount?.toFixed(4) || '0.0000'} SOL
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <div className={`px-2 py-1 rounded-full text-xs ${
                        bot.status === 'funded'
                          ? 'bg-emerald-900/30 text-emerald-400 border border-emerald-500/50'
                          : 'bg-gray-800/30 text-gray-400 border border-gray-700/50'
                      }`}>
                        {bot.status}
                      </div>
                      
                      <button
                        onClick={() => handleResetPreFunding(bot.id)}
                        className="px-3 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 hover:text-red-300 text-xs rounded-lg border border-red-700/30 transition-colors"
                        title="Reset pre-funding"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              
              <div className="mt-4 pt-4 border-t border-gray-800/50">
                <div className="text-xs text-gray-500">
                  {preFundedBots.length} pre-funded bots available. 
                  Resetting will make them available for regular funding.
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PreFundingManager;



