import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { Link } from "react-router-dom";

export const HeroSection = (): JSX.Element => {
  const [typedText, setTypedText] = useState("");
  const [currentMessage, setCurrentMessage] = useState(0);
  const [isTyping, setIsTyping] = useState(true);

  const tradingData = [
    { token: "BONK", profit: "+2.4 SOL" },
    { token: "WIF", profit: "+1.8 SOL" },
    { token: "POPCAT", profit: "+5.2 SOL" },
  ];

  const snipeMessages = [
    "SCANNING RAYDIUM FOR NEW POOLS...",
    "ANALYZING DETECTED TOKEN FOR MOON POTENTIAL...",
    "EXECUTING INSTANT SNIPE...",
    "MONITORING FOR POTENTIAL PROFIT/STOP-LOSS...",
    "TRADE COMPLETED!",
  ];

  // Typing animation effect
  useEffect(() => {
    const message = snipeMessages[currentMessage];
    let currentIndex = 0;

    const typeInterval = setInterval(() => {
      if (currentIndex <= message.length) {
        setTypedText(message.slice(0, currentIndex));
        currentIndex++;
      } else {
        clearInterval(typeInterval);
        setTimeout(() => {
          setIsTyping(false);
          setTimeout(() => {
            setCurrentMessage((prev) => (prev + 1) % snipeMessages.length);
            setIsTyping(true);
          }, 500);
        }, 1000);
      }
    }, 80);

    return () => clearInterval(typeInterval);
  }, [currentMessage]);

  return (
    <section className="relative w-full h-screen overflow-hidden bg-gradient-to-br from-gray-900 via-[#021C14] to-emerald-900">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-0 left-0 w-60 h-60 bg-emerald-500/10 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-0 right-0 w-60 h-60 bg-cyan-500/10 rounded-full blur-3xl animate-float delay-2000" />
      </div>

      {/* Main Content */}
      <div className="relative w-full h-full flex items-center justify-center px-4 my-10 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center text-center gap-6 w-full max-w-6xl">
          
          {/* Header Section - Compressed */}
          <div className="space-y-2">
            <h1 className="font-black text-white text-3xl sm:text-4xl lg:text-5xl xl:text-6xl">
              <span className="bg-gradient-to-r from-white to-emerald-100 bg-clip-text text-transparent">
                <a 
                  href="https://solscan.io/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent hover:from-emerald-300 hover:to-cyan-300 transition-all duration-300 group hover:scale-105"
                >
                  <span>Solana</span>
                  <svg className="w-5 h-5 text-emerald-400 group-hover:text-cyan-400 transition-colors duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a> Sniper Bot
              </span>
            </h1>
            <p className="text-lg sm:text-xl text-white/80 font-medium">
              Start snipping profitable tokens within seconds
            </p>
          </div>

          {/* Live Trading Terminal - Wider & Compressed */}
          <div className="w-full max-w-5xl mx-auto">
            <div className="relative bg-gradient-to-br from-black/90 to-gray-900/95 backdrop-blur-lg rounded-2xl border border-emerald-500/30 shadow-2xl">
              
              {/* Terminal Header - Compressed */}
              <div className="flex items-center gap-3 p-3 border-b border-white/10">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 bg-red-500 rounded-full"></div>
                  <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full"></div>
                  <div className="w-2.5 h-2.5 bg-green-500 rounded-full"></div>
                </div>
                <div className="text-emerald-400 font-mono text-sm truncate">
                  flash_sniper.exe
                </div>
                <div className="flex-1"></div>
                <div className="text-green-400 text-xs font-mono flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                  LIVE
                </div>
              </div>

              {/* Terminal Content - Compressed */}
              <div className="p-4 space-y-3">
                {/* Command & Status Combined */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-emerald-400 font-mono text-sm">
                    <span>⤑</span>
                    <span className="text-white">auto_snipe</span>
                  </div>
                  <div className="text-cyan-400 font-mono text-sm">
                    {typedText}
                    <span className={`${isTyping ? 'animate-pulse' : ''} text-cyan-400`}>█</span>
                  </div>
                </div>

                {/* Recent Trades - Horizontal Layout */}
                <div className="border-t border-white/10 pt-3">
                  <div className="text-white/60 font-mono text-xs mb-2">LIVE TRADES:</div>
                  <div className="grid grid-cols-3 gap-2">
                    {tradingData.map((trade, index) => (
                      <div 
                        key={index} 
                        className="flex flex-col items-center p-2 bg-white/5 rounded-lg hover:bg-white/10 transition-colors duration-200"
                      >
                        <div className="flex items-center gap-1.5 mb-1">
                          <div className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse"></div>
                          <span className="text-white font-bold text-sm">
                            {trade.token}
                          </span>
                        </div>
                        <div className="text-green-400 font-mono text-sm font-bold">
                          {trade.profit}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Next Snipe Countdown - Compact */}
                <div className="bg-gradient-to-r from-emerald-500/15 to-cyan-500/15 rounded-lg p-2 border border-emerald-500/30">
                  <div className="flex justify-between items-center">
                    <div className="text-emerald-400 font-mono text-xs font-bold">
                      NEXT_SNIPE:
                    </div>
                    <div className="text-white font-mono text-base font-bold animate-pulse">
                      0.3s
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CTA Button - Prominent & Responsive */}
          <div className="flex flex-col items-center gap-8">
            {/* Main CTA */}
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-cyan-600 rounded-2xl blur opacity-75 group-hover:opacity-100 transition duration-1000 group-hover:duration-200"></div>
              <Link to="/trading-interface">
                <Button className="relative w-full flex items-center justify-center gap-4 px-12 py-8 bg-gray-900 rounded-2xl border border-white/10 hover:border-emerald-400/30 transition-all duration-300 min-w-[300px]">
                  <span className="text-2xl animate-pulse">🚀</span>
                  <div className="text-left">
                    <div className="text-white text-2xl font-bold">Launch Sniper Bot</div>
                  </div>
                </Button>
              </Link>
            </div>

            {/* Stats in Cards */}
            {/* <div className="grid grid-cols-3 gap-4 max-w-md">
              {[
                { value: "0.2s", label: "Speed", desc: "Avg execution" },
                { value: "97%", label: "Win Rate", desc: "Success rate" },
                { value: "24/7", label: "Active", desc: "Monitoring" }
              ].map((stat, index) => (
                <div key={index} className="bg-white/5 backdrop-blur-sm rounded-xl p-4 text-center border border-white/10 hover:border-emerald-400/20 transition-colors duration-300">
                  <div className="text-2xl font-bold text-emerald-400 mb-1 font-mono">
                    {stat.value}
                  </div>
                  <div className="text-white font-semibold text-sm mb-1">
                    {stat.label}
                  </div>
                  <div className="text-white/40 text-xs">
                    {stat.desc}
                  </div>
                </div>
              ))}
            </div> */}
          </div>
        </div>
      </div>
    </section>
  );
};