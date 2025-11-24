import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

interface DocumentationSection {
  id: string;
  title: string;
  subtitle?: string;
  content: React.ReactNode;
}

const DocumentationPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState('welcome');
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const sectionRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});

  // Scroll to section function
  const scrollToSection = (sectionId: string) => {
    const element = sectionRefs.current[sectionId];
    if (element) {
      const offset = 80;
      const elementPosition = element.offsetTop - offset;
      window.scrollTo({
        top: elementPosition,
        behavior: 'smooth'
      });
      setActiveSection(sectionId);
      setIsMobileMenuOpen(false);
    }
  };

  // Update active section on scroll
  useEffect(() => {
    const handleScroll = () => {
      const sections = Object.keys(sectionRefs.current);
      const scrollPosition = window.scrollY + 100;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sectionRefs.current[sections[i]];
        if (section && section.offsetTop <= scrollPosition) {
          setActiveSection(sections[i]);
          break;
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const documentationSections: DocumentationSection[] = [
    {
      id: 'welcome',
      title: 'Welcome to FlashSniper Docs 🚀',
      content: (
        <div className="space-y-6">
          <p className="text-lg text-gray-300 leading-relaxed">
            The ultimate professional trading bot for Solana blockchain. Whether you're a seasoned degen or just getting started, 
            our powerful platform equips you with real-time data, lightning-fast execution, and cutting-edge analytics to help 
            you stay ahead of the market.
          </p>
          <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-400/20 rounded-xl p-6">
            <h3 className="text-emerald-400 font-bold text-lg mb-3">🎯 What Makes FlashSniper Special</h3>
            <ul className="grid md:grid-cols-2 gap-3 text-gray-300">
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                Sub-second trade execution
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                Advanced safety filters
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                Real-time chart integration
              </li>
              <li className="flex items-center gap-2">
                <div className="w-2 h-2 bg-emerald-400 rounded-full"></div>
                Professional trading interface
              </li>
            </ul>
          </div>
        </div>
      )
    },
    {
      id: 'getting-started',
      title: 'Getting Started',
      content: (
        <div className="space-y-8">
          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h3 className="text-xl font-bold text-white mb-4">Quick Setup Guide</h3>
            <div className="space-y-4">
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-white font-bold text-sm">1</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-2">Wallet Setup</h4>
                  <p className="text-gray-300">A wallet is automatically generated and securely stored in your browser's local storage.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-white font-bold text-sm">2</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-2">Fund Your Wallet</h4>
                  <p className="text-gray-300">Deposit at least 0.3 SOL to cover transaction fees and trading capital.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-white font-bold text-sm">3</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-2">Configure Settings</h4>
                  <p className="text-gray-300">Set your buy amounts, take profit, stop loss, and safety filters (for premium users).</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <span className="text-white font-bold text-sm">4</span>
                </div>
                <div>
                  <h4 className="text-white font-semibold mb-2">Start Trading</h4>
                  <p className="text-gray-300">Click "Run Bot" and monitor your trades in real-time.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'wallet-setup',
      title: 'Step 1: Wallet Setup',
      content: (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-emerald-400 font-bold mb-3">🔐 Automatic Wallet Generation</h4>
              <p className="text-gray-300 text-sm">
                FlashSniper automatically creates a secure Solana wallet for you. Your private key is encrypted and stored locally in your browser - we never have access to your funds.
              </p>
            </div>
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-emerald-400 font-bold mb-3">💰 Minimum Balance</h4>
              <p className="text-gray-300 text-sm">
                You need at least 0.3 SOL to start trading. This covers transaction fees and provides trading capital. The balance indicator shows real-time updates.
              </p>
            </div>
          </div>
          
          <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-4">
            <h4 className="text-amber-400 font-bold mb-2">⚠️ Security Notice</h4>
            <p className="text-amber-300 text-sm">
              Always save your private key securely. While your key is stored locally, browser data can be cleared. Export and backup your private key immediately after generation.
            </p>
          </div>
        </div>
      )
    },
    {
      id: 'trading-setup',
      title: 'Step 2: Trading Configuration',
      content: (
        <div className="space-y-8">
          <div className="grid lg:grid-cols-2 gap-8">
            {/* Buy Settings */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-xl font-bold text-emerald-400 mb-4">🛒 Buy Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <h4 className="text-white font-semibold mb-2">Amount per Trade</h4>
                  <p className="text-gray-300 text-sm mb-3">
                    Set the SOL amount for each buy transaction. Start small to test strategies.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                    <code className="text-emerald-400 text-sm">Default: 0.12 SOL</code>
                  </div>
                </div>
                
                <div>
                  <h4 className="text-white font-semibold mb-2">Slippage Tolerance</h4>
                  <p className="text-gray-300 text-sm mb-3">
                    Maximum price movement allowed during transaction execution.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                    <code className="text-emerald-400 text-sm">Default: 30%</code>
                  </div>
                </div>
              </div>
            </div>

            {/* Sell Settings */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-xl font-bold text-rose-400 mb-4">💰 Sell Settings</h3>
              
              <div className="space-y-4">
                <div>
                  <h4 className="text-white font-semibold mb-2">Take Profit</h4>
                  <p className="text-gray-300 text-sm mb-3">
                    Automatic sell when price reaches target profit percentage.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                    <code className="text-emerald-400 text-sm">Default: 40%</code>
                  </div>
                </div>
                
                <div>
                  <h4 className="text-white font-semibold mb-2">Stop Loss</h4>
                  <p className="text-gray-300 text-sm mb-3">
                    Automatic sell to limit losses if price drops below threshold.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                    <code className="text-rose-400 text-sm">Default: 20%</code>
                  </div>
                </div>

                <div>
                  <h4 className="text-white font-semibold mb-2">Timeout</h4>
                  <p className="text-gray-300 text-sm mb-3">
                    Force sell after specified time regardless of price.
                  </p>
                  <div className="bg-black/30 rounded-lg p-3 border border-white/10">
                    <code className="text-amber-400 text-sm">Default: 60 seconds</code>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'safety-filters',
      title: 'Step 3: Safety & Security Filters',
      content: (
        <div className="space-y-8">
          <div className="bg-gradient-to-r from-emerald-500/10 to-blue-500/10 border border-emerald-400/20 rounded-xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">🛡️ Advanced Protection System (Available to Our Premium Users)</h3>
            <p className="text-gray-300">
              FlashSniper includes comprehensive safety filters to protect against scams and rug pulls. 
              These filters analyze tokens before execution to ensure maximum security.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Basic Filters */}
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-emerald-400 font-bold text-lg mb-4">Basic Filters (Free)</h4>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Social Media Verification</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Liquidity Burn Check</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Immutable Metadata</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Mint Authority Renounced</span>
                </li>
              </ul>
            </div>

            {/* Premium Filters */}
            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-xl p-6 border border-amber-400/30">
              <div className="flex items-center gap-2 mb-4">
                <h4 className="text-amber-400 font-bold text-lg">Premium Filters</h4>
                <span className="bg-amber-500 text-black text-xs font-bold px-2 py-1 rounded">PRO</span>
              </div>
              <ul className="space-y-3 text-sm">
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Top 10 Holders Analysis</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Bundled Transaction Detection</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Same Block Buy Monitoring</span>
                </li>
                <li className="flex items-start gap-3">
                  <div className="w-5 h-5 bg-amber-500 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <span className="text-gray-300">Extended Safety Check Period</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'advanced-features',
      title: 'Advanced Features',
      content: (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-blue-400 font-bold mb-3">📊 Real-time Chart Integration</h4>
              <p className="text-gray-300 text-sm">
                Open live trading charts directly from your active trades. Monitor price movements, set manual sells, and analyze token performance in real-time.
              </p>
            </div>
            
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-purple-400 font-bold mb-3">🔧 Custom RPC Endpoints</h4>
              <p className="text-gray-300 text-sm">
                Premium users can configure custom RPC endpoints for faster execution and reduced rate limiting during high network congestion.
              </p>
            </div>
          </div>

          <div className="bg-white/5 rounded-xl p-6 border border-white/10">
            <h4 className="text-cyan-400 font-bold mb-3">📈 Live Trading Dashboard</h4>
            <div className="grid sm:grid-cols-3 gap-4 text-center">
              <div className="bg-black/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-emerald-400 mb-1">Live</div>
                <div className="text-gray-400 text-sm">Bot Status</div>
              </div>
              <div className="bg-black/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-white mb-1">0.2s</div>
                <div className="text-gray-400 text-sm">Avg Execution</div>
              </div>
              <div className="bg-black/30 rounded-lg p-4">
                <div className="text-2xl font-bold text-amber-400 mb-1">1%</div>
                <div className="text-gray-400 text-sm">Success Fee</div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'fees-pricing',
      title: 'Fees & Pricing',
      content: (
        <div className="space-y-6">
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h3 className="text-xl font-bold text-emerald-400 mb-4">Free Tier</h3>
              <div className="text-3xl font-bold text-white mb-2">$0</div>
              <p className="text-gray-300 text-sm mb-4">No monthly subscription</p>
              <ul className="space-y-2 text-sm text-gray-300 mb-6">
                <li>• All basic safety filters</li>
                <li>• Real-time token monitoring</li>
                <li>• Basic sniping capabilities</li>
                <li>• 1% success fee per trade</li>
              </ul>
              <button className="w-full bg-emerald-500 hover:bg-emerald-600 text-white py-2 px-4 rounded-lg transition-colors">
                Start Free
              </button>
            </div>

            <div className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 rounded-xl p-6 border border-amber-400/30">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-xl font-bold text-amber-400">Premium</h3>
                <span className="bg-amber-500 text-black text-xs font-bold px-2 py-1 rounded">RECOMMENDED</span>
              </div>
              <div className="text-3xl font-bold text-white mb-2">$99<span className="text-lg text-gray-400">/month</span></div>
              <p className="text-gray-300 text-sm mb-4">Advanced trading features</p>
              <ul className="space-y-2 text-sm text-gray-300 mb-6">
                <li>• All free features included</li>
                <li>• Premium safety filters</li>
                <li>• Custom RPC endpoints</li>
                <li>• Priority support</li>
                <li>• 1% success fee per trade</li>
              </ul>
              <button className="w-full bg-amber-500 hover:bg-amber-600 text-white py-2 px-4 rounded-lg transition-colors">
                Upgrade Now
              </button>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'best-practices',
      title: 'Best Practices & Tips',
      content: (
        <div className="space-y-6">
          <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-500/10 border border-emerald-400/20 rounded-xl p-6">
            <h3 className="text-xl font-bold text-white mb-4">🚀 Maximize Your Success</h3>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Start Small</h4>
                <p className="text-gray-300 text-sm">
                  Begin with smaller trade amounts to test strategies before scaling up.
                </p>
              </div>
              
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Monitor Logs</h4>
                <p className="text-gray-300 text-sm">
                  Regularly check transaction logs and bot activity for insights.
                </p>
              </div>
              
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Use Safety Filters</h4>
                <p className="text-gray-300 text-sm">
                  Enable appropriate filters to protect against scams and rug pulls.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Stable Connection</h4>
                <p className="text-gray-300 text-sm">
                  Use reliable internet or VPS for uninterrupted bot operation.
                </p>
              </div>
              
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Test Settings</h4>
                <p className="text-gray-300 text-sm">
                  Validate configurations with small test trades before full deployment.
                </p>
              </div>
              
              <div className="bg-white/5 rounded-lg p-4 border border-white/10">
                <h4 className="text-emerald-400 font-semibold mb-2">Stay Updated</h4>
                <p className="text-gray-300 text-sm">
                  Keep up with platform updates and new feature releases.
                </p>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      content: (
        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-amber-400 font-bold mb-4">🤖 Bot Issues</h4>
              <div className="space-y-4 text-sm">
                <div>
                  <h5 className="text-white font-semibold mb-1">Bot not starting</h5>
                  <p className="text-gray-300">Check wallet balance (min 0.3 SOL) and internet connection</p>
                </div>
                <div>
                  <h5 className="text-white font-semibold mb-1">No trades executing</h5>
                  <p className="text-gray-300">Review safety filters - they might be too strict for current market</p>
                </div>
                <div>
                  <h5 className="text-white font-semibold mb-1">Failed transactions</h5>
                  <p className="text-gray-300">Increase slippage tolerance or check network congestion</p>
                </div>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-6 border border-white/10">
              <h4 className="text-blue-400 font-bold mb-4">🔧 Technical Issues</h4>
              <div className="space-y-4 text-sm">
                <div>
                  <h5 className="text-white font-semibold mb-1">Connection problems</h5>
                  <p className="text-gray-300">Try refreshing the page or using different RPC endpoint</p>
                </div>
                <div>
                  <h5 className="text-white font-semibold mb-1">Balance not updating</h5>
                  <p className="text-gray-300">Use the refresh balance button or wait for automatic update</p>
                </div>
                <div>
                  <h5 className="text-white font-semibold mb-1">Chart not loading</h5>
                  <p className="text-gray-300">Ensure pop-ups are enabled and check browser console for errors</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-amber-500/10 border border-amber-400/20 rounded-xl p-4">
            <h4 className="text-amber-400 font-bold mb-2">💡 Need More Help?</h4>
            <p className="text-amber-300 text-sm">
              Join our Discord community for real-time support and to connect with other traders.
            </p>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-[#021C14] to-emerald-900">
      {/* Header */}
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

      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <div className="lg:w-80 flex-shrink-0">
            <div className="sticky top-24 bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
              <div className="flex items-center gap-3 mb-6">
                <h2 className="text-white font-bold text-lg">Documentation</h2>
                <span className="bg-emerald-500 text-white text-xs font-bold px-2 py-1 rounded">v1.0.0</span>
              </div>

              {/* Mobile Menu Button */}
              <button
                className="lg:hidden w-full bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg p-3 text-white font-semibold transition-colors mb-4 flex items-center justify-between"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              >
                <span>Menu</span>
                <svg className={`w-5 h-5 transition-transform ${isMobileMenuOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Navigation Menu */}
              <nav className={`${isMobileMenuOpen ? 'block' : 'hidden'} lg:block space-y-2`}>
                {documentationSections.map((section) => (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all duration-200 ${
                      activeSection === section.id
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-400/30'
                        : 'text-gray-300 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <div className="font-medium text-sm">{section.title}</div>
                  </button>
                ))}
              </nav>

              {/* Quick Links */}
            <div className="mt-8 pt-6 border-t border-white/10">
                <h3 className="text-white font-semibold text-sm mb-3">Quick Links</h3>
                <div className="space-y-2">
                    <button 
                        onClick={() => navigate('/trading-interface')}
                        className="flex items-center gap-2 text-gray-300 hover:text-white text-sm transition-colors w-full text-left"
                        >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        Trading Interface
                    </button>
                    <button 
                        onClick={() => {
                            // Navigate to home page and scroll to FAQ section
                            navigate('/');
                            // Use setTimeout to ensure navigation completes before scrolling
                            setTimeout(() => {
                            const faqSection = document.getElementById('features');
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
                        className="flex items-center gap-2 text-gray-300 hover:text-white text-sm transition-colors w-full text-left"
                        >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192L5.636 18.364M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Features
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
                        className="flex items-center gap-2 text-gray-300 hover:text-white text-sm transition-colors w-full text-left"
                        >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        FAQ
                    </button>
                </div>
                </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1">
            <div className="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-8">
              {documentationSections.map((section) => (
                <section
                  key={section.id}
                  id={section.id}
                  ref={(el: HTMLDivElement | null) => (sectionRefs.current[section.id] = el)}
                  className="scroll-mt-24 mb-16 last:mb-0"
                >
                  <h2 className="text-3xl font-black bg-gradient-to-b from-white to-emerald-400 bg-clip-text text-transparent mb-6">
                    {section.title}
                  </h2>
                  {section.content}
                </section>
              ))}
            </div>

            {/* CTA Section */}
            <div className="mt-8 text-center">
              <div className="bg-gradient-to-r from-emerald-500/10 to-cyan-600/10 backdrop-blur-sm rounded-2xl border border-emerald-400/30 p-8">
                <h3 className="text-2xl font-bold text-white mb-4">Ready to Start Trading?</h3>
                <p className="text-gray-300 mb-6 max-w-2xl mx-auto">
                  Join thousands of traders using FlashSniper to maximize their profits on Solana. 
                  Start with our free tier and upgrade to premium when you're ready for advanced features.
                </p>
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={() => navigate('/trading-interface')}
                    className="bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/25"
                  >
                    Launch Trading Bot
                  </button>
                  <button className="bg-white/10 hover:bg-white/20 border border-white/20 text-white px-8 py-3 rounded-lg font-semibold transition-all duration-300 backdrop-blur-sm">
                    Join Community
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
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
    </div>
  );
};

export default DocumentationPage;

