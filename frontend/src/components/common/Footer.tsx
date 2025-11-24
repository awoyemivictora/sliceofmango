// import React from "react";
// import { Link } from "react-router-dom";

// export const Footer = (): JSX.Element => {
//   const currentYear = new Date().getFullYear();

//   const footerLinks = {
//     product: [
//       { name: "Features", href: "#features" },
//       { name: "Pricing", href: "#pricing" },
//       { name: "FAQ", href: "#faq" },
//       { name: "Documentation", href: "#" },
//     ],
//     company: [
//       { name: "About", href: "#" },
//       { name: "Blog", href: "#" },
//       { name: "Careers", href: "#" },
//       { name: "Contact", href: "#" },
//     ],
//     legal: [
//       { name: "Privacy Policy", href: "#" },
//       { name: "Terms of Service", href: "#" },
//       { name: "Cookie Policy", href: "#" },
//     ],
//     community: [
//       { name: "Discord", href: "#" },
//       { name: "Twitter", href: "#" },
//       { name: "Telegram", href: "#" },
//       { name: "GitHub", href: "#" },
//     ],
//   };

//   const scrollToSection = (sectionId: string) => {
//     const element = document.getElementById(sectionId);
//     if (element) {
//       const offset = 80; // Account for fixed navbar
//       const elementPosition = element.getBoundingClientRect().top;
//       const offsetPosition = elementPosition + window.pageYOffset - offset;

//       window.scrollTo({
//         top: offsetPosition,
//         behavior: "smooth"
//       });
//     }
//   };

//   return (
//     <footer className="relative bg-gradient-to-b from-[#021C14] to-gray-900 border-t border-white/10">
//       {/* Background Elements */}
//       <div className="absolute inset-0 overflow-hidden">
//         <div className="absolute -top-20 left-1/4 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl"></div>
//         <div className="absolute -bottom-20 right-1/4 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl"></div>
//       </div>

//       <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
//         {/* Main Footer Content */}
//         <div className="py-12 lg:py-16">
//           <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8 lg:gap-12">
//             {/* Brand Section */}
//             <div className="lg:col-span-2">
//               <div className="flex items-center gap-3 mb-6">
//                 <div className="w-8 h-8 relative">
//                   <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]">
//                     <div className="absolute inset-1 rounded-full border border-emerald-300/50"></div>
//                   </div>
//                   <div
//                     className="absolute inset-1 rounded-full bg-gradient-to-br from-emerald-200 to-emerald-500 opacity-70 animate-spin"
//                     style={{ animationDuration: "3s" }}
//                   ></div>
//                 </div>
//                 <span className="font-bold text-lg tracking-wider">
//                   <span className="text-white">FLASH</span>
//                   <span className="text-emerald-400">SNIPPER</span>
//                 </span>
//               </div>
//               <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-md">
//                 The fastest automated sniper bot for Solana. Execute trades on newly launched tokens instantly 
//                 with advanced safety features and real-time monitoring.
//               </p>
//               <div className="flex space-x-4">
//                 {footerLinks.community.map((social, index) => (
//                   <a
//                     key={index}
//                     href={social.href}
//                     className="w-10 h-10 bg-white/5 hover:bg-emerald-500/20 border border-white/10 rounded-lg flex items-center justify-center transition-all duration-300 hover:border-emerald-400/30 hover:scale-110"
//                   >
//                     <span className="text-white/60 hover:text-emerald-400 text-sm font-semibold">
//                       {social.name.charAt(0)}
//                     </span>
//                   </a>
//                 ))}
//               </div>
//             </div>

//             {/* Product Links */}
//             <div>
//               <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
//                 Product
//               </h3>
//               <ul className="space-y-3">
//                 {footerLinks.product.map((link, index) => (
//                   <li key={index}>
//                     <button
//                       onClick={() => scrollToSection(link.href.substring(1))}
//                       className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
//                     >
//                       {link.name}
//                     </button>
//                   </li>
//                 ))}
//               </ul>
//             </div>

//             {/* Company Links */}
//             <div>
//               <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
//                 Company
//               </h3>
//               <ul className="space-y-3">
//                 {footerLinks.company.map((link, index) => (
//                   <li key={index}>
//                     <a
//                       href={link.href}
//                       className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
//                     >
//                       {link.name}
//                     </a>
//                   </li>
//                 ))}
//               </ul>
//             </div>

//             {/* Legal Links */}
//             <div>
//               <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
//                 Legal
//               </h3>
//               <ul className="space-y-3">
//                 {footerLinks.legal.map((link, index) => (
//                   <li key={index}>
//                     <a
//                       href={link.href}
//                       className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
//                     >
//                       {link.name}
//                     </a>
//                   </li>
//                 ))}
//               </ul>
//             </div>

//             {/* Newsletter Signup */}
//             <div>
//               <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
//                 Stay Updated
//               </h3>
//               <p className="text-white/60 text-sm mb-4">
//                 Get the latest updates and trading insights.
//               </p>
//               <div className="flex flex-col space-y-3">
//                 <input
//                   type="email"
//                   placeholder="Enter your email"
//                   className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:border-emerald-400/50 transition-colors duration-300"
//                 />
//                 <button className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-600 hover:to-cyan-700 rounded-lg text-white text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/25">
//                   Subscribe
//                 </button>
//               </div>
//             </div>
//           </div>
//         </div>

//         {/* Bottom Bar */}
//         <div className="border-t border-white/10 py-6">
//           <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
//             <div className="text-white/40 text-sm">
//               © {currentYear} FlashSnipper. All rights reserved.
//             </div>
//             <div className="flex items-center space-x-6 text-sm">
//               <span className="text-white/60">Made with ❤️ for the Solana community</span>
//             </div>
//           </div>
//         </div>
//       </div>
//     </footer>
//   );
// };




import React from "react";
import { Link } from "react-router-dom";

export const Footer = (): JSX.Element => {
  const currentYear = new Date().getFullYear();

  const footerLinks = {
    product: [
      { name: "Features", href: "#features" },
      { name: "Pricing", href: "#pricing" },
      { name: "FAQ", href: "#faq" },
      { name: "Documentation", href: "/documentation" }, // Updated to use route
    ],
    company: [
      { name: "About", href: "#" },
      { name: "Blog", href: "#" },
      { name: "Careers", href: "#" },
      { name: "Contact", href: "#" },
    ],
    legal: [
      { name: "Privacy Policy", href: "#" },
      { name: "Terms of Service", href: "#" },
      { name: "Cookie Policy", href: "#" },
    ],
    community: [
      { name: "Discord", href: "#" },
      { name: "Twitter", href: "#" },
      { name: "Telegram", href: "#" },
      { name: "GitHub", href: "#" },
    ],
  };

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

  return (
    <footer className="relative bg-gradient-to-b from-[#021C14] to-gray-900 border-t border-white/10">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 left-1/4 w-40 h-40 bg-emerald-500/5 rounded-full blur-3xl"></div>
        <div className="absolute -bottom-20 right-1/4 w-40 h-40 bg-cyan-500/5 rounded-full blur-3xl"></div>
      </div>

      <div className="relative container mx-auto px-4 sm:px-6 lg:px-8 max-w-7xl">
        {/* Main Footer Content */}
        <div className="py-12 lg:py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-8 lg:gap-12">
            {/* Brand Section */}
            <div className="lg:col-span-2">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-8 h-8 relative">
                  <div className="absolute inset-0 rounded-full bg-gradient-to-br from-emerald-400 to-green-600 animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.5)]">
                    <div className="absolute inset-1 rounded-full border border-emerald-300/50"></div>
                  </div>
                  <div
                    className="absolute inset-1 rounded-full bg-gradient-to-br from-emerald-200 to-emerald-500 opacity-70 animate-spin"
                    style={{ animationDuration: "3s" }}
                  ></div>
                </div>
                <span className="font-bold text-lg tracking-wider">
                  <span className="text-white">FLASH</span>
                  <span className="text-emerald-400">SNIPER</span>
                </span>
              </div>
              <p className="text-white/60 text-sm leading-relaxed mb-6 max-w-md">
                The fastest automated sniper bot for Solana. Execute trades on newly launched tokens instantly 
                with advanced safety features and real-time monitoring.
              </p>
              <div className="flex space-x-4">
                {footerLinks.community.map((social, index) => (
                  <a
                    key={index}
                    href={social.href}
                    className="w-10 h-10 bg-white/5 hover:bg-emerald-500/20 border border-white/10 rounded-lg flex items-center justify-center transition-all duration-300 hover:border-emerald-400/30 hover:scale-110"
                  >
                    <span className="text-white/60 hover:text-emerald-400 text-sm font-semibold">
                      {social.name.charAt(0)}
                    </span>
                  </a>
                ))}
              </div>
            </div>

            {/* Product Links */}
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Product
              </h3>
              <ul className="space-y-3">
                {footerLinks.product.map((link, index) => {
                  // For documentation, use React Router Link
                  if (link.name === "Documentation") {
                    return (
                      <li key={index}>
                        <Link
                          to={link.href}
                          className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
                        >
                          {link.name}
                        </Link>
                      </li>
                    );
                  }
                  
                  // For anchor links, use scroll function
                  return (
                    <li key={index}>
                      <button
                        onClick={() => scrollToSection(link.href.substring(1))}
                        className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
                      >
                        {link.name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Company Links */}
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Company
              </h3>
              <ul className="space-y-3">
                {footerLinks.company.map((link, index) => (
                  <li key={index}>
                    <a
                      href={link.href}
                      className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal Links */}
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Legal
              </h3>
              <ul className="space-y-3">
                {footerLinks.legal.map((link, index) => (
                  <li key={index}>
                    <a
                      href={link.href}
                      className="text-white/60 hover:text-emerald-400 text-sm transition-colors duration-300 hover:translate-x-1 transform inline-flex items-center gap-1"
                    >
                      {link.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>

            {/* Newsletter Signup */}
            <div>
              <h3 className="text-white font-semibold mb-4 text-sm uppercase tracking-wider">
                Stay Updated
              </h3>
              <p className="text-white/60 text-sm mb-4">
                Get the latest updates and trading insights.
              </p>
              <div className="flex flex-col space-y-3">
                <input
                  type="email"
                  placeholder="Enter your email"
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder-white/40 focus:outline-none focus:border-emerald-400/50 transition-colors duration-300"
                />
                <button className="px-4 py-2 bg-gradient-to-r from-emerald-500 to-cyan-600 hover:from-emerald-600 hover:to-cyan-700 rounded-lg text-white text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-emerald-500/25">
                  Subscribe
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="border-t border-white/10 py-6">
          <div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
            <div className="text-white/40 text-sm">
              © {currentYear} FlashSniper. All rights reserved.
            </div>
            <div className="flex items-center space-x-6 text-sm">
              <span className="text-white/60">Made with ❤️ for the Solana community</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};