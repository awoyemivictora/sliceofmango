// src/pages/LandingPage/index.tsx
import { Button } from "@/components/ui/Button";
import { FeaturesSection, PricingSection, FAQSection } from "@/sections";
import { HeroSection } from "@/sections";
import { Footer } from "@/components/common/Footer";
import React, { useEffect } from "react";
import { Link, useLocation } from "react-router-dom";

const LandingPage = (): JSX.Element => {
  const location = useLocation(); // Add useLocation to get URL hash

  const navigationItems = [
    { label: "Home", active: true, href: "#home" },
    { label: "Features", active: false, href: "#features" },
    { label: "Pricing", active: false, href: "#pricing" },
    { label: "FAQs", active: false, href: "#faq" },
  ];

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      const offset = 80; // Account for fixed navbar
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;

      window.scrollTo({
        top: offsetPosition,
        behavior: "smooth"
      });
    }
  };

  // Handle initial scroll based on URL hash
  useEffect(() => {
    if (location.hash) {
      const sectionId = location.hash.substring(1); // Remove the # symbol
      setTimeout(() => scrollToSection(sectionId), 0); // Delay to ensure DOM is ready
    }
  }, [location.hash]);

  const handleNavClick = (href: string, event: React.MouseEvent) => {
    event.preventDefault();
    const sectionId = href.substring(1); // Remove the # symbol
    scrollToSection(sectionId);
  };

  return (
    <div className="relative w-full min-h-screen overflow-x-hidden">
      {/* Navigation Bar */}
      <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 px-4 py-5">
        <div className="flex items-center justify-between gap-6 p-2 bg-[#ffffff1a] rounded-[48px] border border-solid border-[#10b98133] backdrop-blur-[3.5px] backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(3.5px)_brightness(100%)] shadow-lg">
          {/* Logo with FLASH SNIPER text */}
          <div className="flex items-center justify-center gap-3 px-2 py-1">
            <div className="flex items-center gap-2">
              {/* Spiral green spring logo */}
              <div className="w-6 h-6 relative">
                <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]">
                  <div className="absolute inset-1 rounded-full border border-emerald-300/50"></div>
                </div>
                <div
                  className="absolute inset-1 rounded-full bg-gradient-to-br from-emerald-200 to-emerald-500 opacity-70 animate-spin"
                  style={{ animationDuration: "3s" }}
                ></div>
              </div>
              {/* Two-tone FLASH SNIPER text */}
              <span className="font-bold text-sm tracking-wider">
                <span className="text-white">FLASH</span>
                <span className="text-[#10B981]">SNIPER</span>
              </span>
            </div>
          </div>

          {/* Navigation Items - Hidden on mobile, shown on tablet and up */}
          <div className="hidden md:flex items-center gap-1">
            {navigationItems.map((item, index) => (
              <button
                key={`nav-item-${index}`}
                onClick={(e) => handleNavClick(item.href, e)}
                className="flex items-center justify-center gap-2.5 px-4 py-2 rounded-[50px] overflow-hidden hover:bg-white/10 cursor-pointer transition-colors"
              >
                <div className="text-sm font-medium text-white tracking-wide whitespace-nowrap">
                  {item.label}
                </div>
              </button>
            ))}
          </div>

          {/* Mobile Menu Button - Shown only on mobile */}
          <Link to="/trading-interface" aria-label="Open trading interface">
            <button className="md:hidden text-white p-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </Link>

          {/* Launch Button - Hidden on mobile, shown on tablet and up */}
          <Link to="/trading-interface">
            <Button className="hidden md:flex items-center justify-center gap-2.5 px-6 py-2.5 bg-emerald-500 rounded-[50px] overflow-hidden hover:bg-emerald-600 transition-colors shadow-lg">
              <span className="font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
                Launch Sniper
              </span>
            </Button>
          </Link>

          {/* <Link 
  to="/sol-reclaimer" 
  className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-700 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200"
>
  SOL Reclaimer
</Link> */}
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home">
        <HeroSection />
      </section>

      {/* Additional sections */}
      <div className="w-full">
        <section id="features">
          <FeaturesSection />
        </section>
        <section id="pricing">
          <PricingSection />
        </section>
        <section id="faq">
          <FAQSection />
        </section>
      </div>

      {/* Footer */}
      <Footer />
    </div>
  );
};

export default LandingPage;