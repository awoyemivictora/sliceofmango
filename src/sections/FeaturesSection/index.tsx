import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export const FeaturesSection = (): JSX.Element => {
  const features = [
    {
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/group.png",
      iconAlt: "Group",
      title: "Instant Sniping",
      description:
        "Quickly seize newly launched tokens to maximize your profit opportunities.",
    },
    {
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/safety-tube-1.svg",
      iconAlt: "Safety tube",
      title: "Safety Filters and Controls",
      description:
        "Steer clear of scams and rug pulls with sophisticated token filters and security measures.",
    },
    {
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/data-visualization-1.svg",
      iconAlt: "Data visualization",
      title: "Intuitive User Dashboard",
      description:
        "Control settings, oversee trades, and monitor performance all in one user-friendly interface.",
    },
    {
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/schedule-1.svg",
      iconAlt: "Schedule",
      title: "Personalized RPC Integration",
      description:
        "Enhance speed and reliability by utilizing your favorite custom RPC endpoints.",
    },
    {
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/earnings-1.svg",
      iconAlt: "Earnings",
      title: "Earnings Monitoring",
      description:
        "Keep track of your earnings with comprehensive trade history analysis.",
    },
    {
      icon: null,
      iconAlt: "Wallet",
      title: "Secure Funding Wallet",
      description:
        "Protect your assets with a uniquely generated, standalone funding wallet.",
      walletIcon: true,
    },
  ];

  return (
    <section className="absolute w-[1280px] h-[720px] top-[719px] left-0 overflow-hidden bg-[linear-gradient(180deg,rgba(2,28,20,0.2)_0%,rgba(14,164,115,0.2)_100%),linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)]">
      <div className="relative w-[2236px] h-[700px] top-7 left-[-413px]">
        <div className="absolute w-[317px] h-[316px] top-96 left-[1535px] blur-[13.5px] opacity-[0.74]">
          <div className="relative w-[158px] h-[308px] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/icosahedron-1-1.png)] bg-cover bg-[50%_50%]">
            <img
              className="absolute w-[158px] h-[308px] top-0 left-0"
              alt="Mask group"
              src="https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group.png"
            />
          </div>
        </div>

        <img
          className="absolute w-[2182px] h-[561px] top-0 left-[54px]"
          alt="Vector"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-4-1.svg"
        />

        <img
          className="absolute w-[1930px] h-[634px] top-[19px] left-0"
          alt="Vector"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-5.svg"
        />

        <h2 className="absolute w-[272px] top-[87px] left-[445px] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)] [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent] [font-family:'Satoshi-Black',Helvetica] font-black text-transparent text-[32px] tracking-[0] leading-[38.4px]">
          Trade Smarter, Not Harder
        </h2>

        <p className="absolute w-[540px] top-[124px] left-[1118px] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] text-right tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
          Run your strategy on autopilot with powerful, round-the-clock
          automation. Just set your rules our bot handles the execution with
          speed, precision, and constant market awareness.
        </p>

        <div className="flex flex-wrap w-[1215px] items-start gap-[10px_12px] absolute top-[232px] left-[445px]">
          {features.map((feature, index) => (
            <Card
              key={index}
              className="w-[397px] h-[173px] bg-[#1d4437] rounded-[11px] border-none"
            >
              <CardContent className="flex flex-col items-start gap-6 px-[25px] py-6 h-full">
                {feature.walletIcon ? (
                  <div className="relative w-[39px] h-[39px] overflow-hidden">
                    <div className="relative w-[38px] h-[39px]">
                      <img
                        className="absolute w-5 h-[30px] top-px left-2.5"
                        alt="Vector"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-1.svg"
                      />
                      <img
                        className="absolute w-3.5 h-[30px] top-px left-4"
                        alt="Vector"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-3.svg"
                      />
                      <img
                        className="absolute w-2.5 h-[3px] top-[7px] left-[15px]"
                        alt="Vector"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-4.svg"
                      />
                      <img
                        className="absolute w-0.5 h-[3px] top-[7px] left-[22px]"
                        alt="Vector"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-2.svg"
                      />
                      <img
                        className="absolute w-[37px] h-4 top-[23px] left-px"
                        alt="Group"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/group-1.png"
                      />
                      <img
                        className="absolute w-[38px] h-[39px] top-0 left-0"
                        alt="Vector"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector.svg"
                      />
                    </div>
                  </div>
                ) : feature.icon ===
                  "https://c.animaapp.com/mcs1777vCoVcpz/img/group.png" ? (
                  <div className="relative w-[39.13px] h-[39.13px]">
                    <img
                      className="absolute w-[34px] h-[34px] top-0.5 left-0.5"
                      alt={feature.iconAlt}
                      src={feature.icon}
                    />
                  </div>
                ) : (
                  <img
                    className="relative w-[39px] h-[39px]"
                    alt={feature.iconAlt}
                    src={feature.icon ?? undefined}
                  />
                )}

                <div className="gap-2 self-stretch w-full flex-[0_0_auto] flex flex-col items-start">
                  <h3 className="relative self-stretch mt-[-1.00px] font-body-bold font-[number:var(--body-bold-font-weight)] text-white text-[length:var(--body-bold-font-size)] tracking-[var(--body-bold-letter-spacing)] leading-[var(--body-bold-line-height)] [font-style:var(--body-bold-font-style)]">
                    {feature.title}
                  </h3>
                  <p className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                    {feature.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  );
};
































// import React from "react";
// import { Card, CardContent } from "@/components/ui/card";

// export const FeaturesSection = (): JSX.Element => {
//   const features = [
//     {
//       icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/group.png",
//       iconAlt: "Group",
//       title: "Instant Sniping",
//       description:
//         "Quickly seize newly launched tokens to maximize your profit opportunities.",
//     },
//     {
//       icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/safety-tube-1.svg",
//       iconAlt: "Safety tube",
//       title: "Safety Filters and Controls",
//       description:
//         "Steer clear of scams and rug pulls with sophisticated token filters and security measures.",
//     },
//     {
//       icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/data-visualization-1.svg",
//       iconAlt: "Data visualization",
//       title: "Intuitive User Dashboard",
//       description:
//         "Control settings, oversee trades, and monitor performance all in one user-friendly interface.",
//     },
//     {
//       icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/schedule-1.svg",
//       iconAlt: "Schedule",
//       title: "Personalized RPC Integration",
//       description:
//         "Enhance speed and reliability by utilizing your favorite custom RPC endpoints.",
//     },
//     {
//       icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/earnings-1.svg",
//       iconAlt: "Earnings",
//       title: "Earnings Monitoring",
//       description:
//         "Keep track of your earnings with comprehensive trade history analysis.",
//     },
//     {
//       icon: null,
//       iconAlt: "Wallet",
//       title: "Secure Funding Wallet",
//       description:
//         "Protect your assets with a uniquely generated, standalone funding wallet.",
//       walletIcon: true,
//     },
//   ];

//   return (
//     <section
//       className="relative w-full min-h-screen py-16 md:py-24 lg:py-32
//                  bg-[linear-gradient(180deg,rgba(2,28,20,0.2)_0%,rgba(14,164,115,0.2)_100%),linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)]
//                  overflow-hidden flex flex-col items-center justify-center text-center"
//     >
//       {/* Background elements - positioned absolutely within the section */}
//       {/* Icosahedron blur: Hidden on smaller screens, positioned to the right on larger screens */}
//       <div className="absolute hidden lg:block w-[317px] h-[316px] top-1/2 -translate-y-1/2 right-0 md:right-[-100px] lg:right-[-50px] xl:right-0 blur-[13.5px] opacity-[0.74] z-0">
//         <div className="relative w-[158px] h-[308px] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/icosahedron-1-1.png)] bg-cover bg-[50%_50%]">
//           <img
//             className="absolute w-[158px] h-[308px] top-0 left-0"
//             alt="Mask group"
//             src="https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group.png"
//           />
//         </div>
//       </div>

//       {/* Vector images: Scaled and positioned to fill background, hidden on small screens to avoid clutter */}
//       <img
//         className="absolute inset-0 w-full h-full object-cover opacity-50 z-0 hidden md:block" // Hidden on small screens, adjust opacity
//         alt="Vector background 1"
//         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-4-1.svg"
//       />
//       <img
//         className="absolute inset-0 w-full h-full object-cover opacity-50 z-0 hidden md:block" // Hidden on small screens, adjust opacity
//         alt="Vector background 2"
//         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-5.svg"
//       />

//       {/* Content Wrapper: Ensures content is centered and has appropriate max-width */}
//       <div className="relative z-10 w-full max-w-screen-xl mx-auto px-4 md:px-8 flex flex-col items-center">
//         {/* Heading and Paragraph: Centered and responsive text sizing */}
//         <div className="mb-12 md:mb-16 lg:mb-20 flex flex-col items-center text-center">
//           <h2 className="text-3xl md:text-4xl lg:text-5xl font-black
//                          bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)]
//                          [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent]
//                          font-satoshi-black tracking-tight leading-tight mb-4">
//             Trade Smarter, Not Harder
//           </h2>

//           <p className="text-base md:text-lg text-white max-w-xl font-small-text-medium leading-relaxed">
//             Run your strategy on autopilot with powerful, round-the-clock
//             automation. Just set your rules our bot handles the execution with
//             speed, precision, and constant market awareness.
//           </p>
//         </div>

//         {/* Feature Cards Grid: Responsive grid layout for cards */}
//         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6 w-full max-w-screen-lg">
//           {features.map((feature, index) => (
//             <Card
//               key={index}
//               className="bg-[#1d4437] rounded-xl border-none p-4 flex flex-col items-start text-left"
//             >
//               <CardContent className="flex flex-col items-start gap-4 md:gap-6 p-0 h-full">
//                 {feature.walletIcon ? (
//                   <div className="relative w-[39px] h-[39px] overflow-hidden flex-shrink-0">
//                     <div className="relative w-[38px] h-[39px]">
//                       <img
//                         className="absolute w-5 h-[30px] top-px left-2.5"
//                         alt="Vector"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-1.svg"
//                       />
//                       <img
//                         className="absolute w-3.5 h-[30px] top-px left-4"
//                         alt="Vector"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-3.svg"
//                       />
//                       <img
//                         className="absolute w-2.5 h-[3px] top-[7px] left-[15px]"
//                         alt="Vector"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-4.svg"
//                       />
//                       <img
//                         className="absolute w-0.5 h-[3px] top-[7px] left-[22px]"
//                         alt="Vector"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-2.svg"
//                       />
//                       <img
//                         className="absolute w-[37px] h-4 top-[23px] left-px"
//                         alt="Group"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/group-1.png"
//                       />
//                       <img
//                         className="absolute w-[38px] h-[39px] top-0 left-0"
//                         alt="Vector"
//                         src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector.svg"
//                       />
//                     </div>
//                   </div>
//                 ) : feature.icon ===
//                   "https://c.animaapp.com/mcs1777vCoVcpz/img/group.png" ? (
//                   <div className="relative w-[39.13px] h-[39.13px] flex-shrink-0">
//                     <img
//                       className="absolute w-[34px] h-[34px] top-0.5 left-0.5"
//                       alt={feature.iconAlt}
//                       src={feature.icon}
//                     />
//                   </div>
//                 ) : (
//                   <img
//                     className="relative w-[39px] h-[39px] flex-shrink-0"
//                     alt={feature.iconAlt}
//                     src={feature.icon ?? undefined}
//                   />
//                 )}

//                 <div className="flex flex-col items-start gap-2 self-stretch">
//                   <h3 className="text-lg md:text-xl font-body-bold text-white leading-tight">
//                     {feature.title}
//                   </h3>
//                   <p className="text-sm md:text-base font-small-text-medium text-white leading-relaxed">
//                     {feature.description}
//                   </p>
//                 </div>
//               </CardContent>
//             </Card>
//           ))}
//         </div>
//       </div>
//     </section>
//   );
// };