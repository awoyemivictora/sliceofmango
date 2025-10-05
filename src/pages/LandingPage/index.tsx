import { Button } from "@/components/ui/Button";
import {
  ComponentNodeSection,
  FeaturesListSection,
  FeaturesSection,
  ImageGallerySection,
  LayoutSection,
  MainContentSection,
  OverlapGroupSection,
  OverlapSection,
} from "@/sections";
import React from "react";

const LandingPage = (): JSX.Element => {
  const navigationItems = [
    { label: "Home", active: true },
    { label: "Features", active: false },
    { label: "Pricing", active: false },
    { label: "FAQs", active: false },
  ];

  return (
    <div className="bg-transparent flex flex-col items-center w-full overflow-x-hidden">
      {/* Hero Section */}
      <section className="w-full max-w-[1280px] px-4">
        <img
          className="w-full h-auto"
          alt="Hero section"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/hero-section.png"
        />
      </section>

      {/* Features + Overlap Sections */}
      <section className="w-full max-w-[1280px] px-4">
        <FeaturesSection />
        <OverlapSection />
        <OverlapGroupSection />
        <FeaturesListSection />
      </section>

      {/* Main Content Section */}
      <section className="w-full max-w-[1280px] px-4">
        <MainContentSection />
        <ComponentNodeSection />
        <LayoutSection />
        <ImageGallerySection />
      </section>

      {/* Fixed Navigation (optional) */}
      {/* Uncomment and customize if you want floating nav */}
      {/*
      <div className="fixed top-8 left-1/2 transform -translate-x-1/2 bg-white/10 rounded-full border border-emerald-400/20 backdrop-blur-md px-6 py-2 flex gap-4">
        {navigationItems.map((item, i) => (
          <span
            key={i}
            className={`cursor-pointer text-white ${
              item.active ? "font-bold" : "opacity-70"
            }`}
          >
            {item.label}
          </span>
        ))}
        <Button className="bg-emerald-500 text-white rounded-full hover:bg-emerald-600 px-6 py-2">
          Launch Sniper
        </Button>
      </div>
      */}
    </div>
  );
};

export default LandingPage;


























// import { Button } from "@/components/ui/Button";
// import { ComponentNodeSection, FeaturesListSection, FeaturesSection, ImageGallerySection, LayoutSection, MainContentSection, OverlapGroupSection, OverlapSection } from "@/sections";
// import React from "react";

// const LandingPage = (): JSX.Element => {
//   const navigationItems = [
//     { label: "Home", active: true },
//     { label: "Features", active: false },
//     { label: "Pricing", active: false },
//     { label: "FAQs", active: false },
//   ];

//   return (
//     <div className="relative w-full min-h-screen overflow-x-hidden">
//       {/* Hero Section */}
//       <div className="relative w-full">
//         <img
//           className="w-full h-auto object-cover md:h-[720px]"
//           alt="Hero section"
//           src="https://c.animaapp.com/mcs1777vCoVcpz/img/hero-section.png"
//         />
//       </div>

//       {/* Main Content */}
//       <div className="w-full">
//         <FeaturesSection />
//         <OverlapSection />
//         <OverlapGroupSection />
//         <FeaturesListSection />
//         <MainContentSection />
//         <ComponentNodeSection />
//         <LayoutSection />
//         <ImageGallerySection />
//       </div>

//       {/* Navigation Bar */}
//       <nav className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full px-4">
//         <div className="flex items-center justify-between gap-4 p-2 mx-auto max-w-6xl bg-[#ffffff1a] rounded-[48px] border border-solid border-[#10b98133] backdrop-blur-[3.5px] backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(3.5px)_brightness(100%)]">
//           {/* Logo */}
//           <div className="flex items-center justify-center gap-2.5 px-2.5 py-0">
//             <div className="flex items-center gap-[2.5px]">
//               <div className="w-[14.57px] h-[14.57px] relative bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2342.svg)] bg-[100%_100%]">
//                 <div className="relative w-2.5 h-2.5 top-0.5 left-0.5 bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2343.svg)] bg-[100%_100%]">
//                   <img
//                     className="absolute w-[5px] h-[5px] top-[3px] left-[3px]"
//                     alt="Ellipse"
//                     src="https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2343.svg"
//                   />
//                 </div>
//               </div>
//             </div>
//           </div>

//           {/* Navigation Items - Hidden on mobile, shown on tablet and up */}
//           <div className="hidden md:flex items-center gap-2">
//             {navigationItems.map((item, index) => (
//               <div
//                 key={`nav-item-${index}`}
//                 className="flex items-center justify-center gap-2.5 px-4 py-2 rounded-[50px] overflow-hidden hover:bg-white/10 cursor-pointer transition-colors"
//               >
//                 <div className="font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
//                   {item.label}
//                 </div>
//               </div>
//             ))}
//           </div>

//           {/* Mobile Menu Button - Shown only on mobile */}
//           <button className="md:hidden text-white p-2">
//             <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//               <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
//             </svg>
//           </button>

//           {/* Launch Button - Hidden on mobile, shown on tablet and up */}
//           <Button className="hidden md:flex items-center justify-center gap-2.5 px-4 py-2 bg-emerald-500 rounded-[50px] overflow-hidden hover:bg-emerald-600 transition-colors">
//             <span className="font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
//               Launch Sniper
//             </span>
//           </Button>
//         </div>
//       </nav>
//     </div>
//   );
// };

// export default LandingPage;