import React from "react";

export const ComponentNodeSection = (): JSX.Element => {
  const sniperBotGuideContent = [
    {
      title: "What Is a Sniper Bot, Really?",
      content:
        "A sniper bot on the Solana network is an automated tool that continuously scans decentralized exchanges for new token listings. As soon as a token is launched, the bot tries to purchase it on your behalf, targeting lower entry prices before others jump in. This speed and automation can provide an edge over manual traders.",
    },
    {
      title: "Main Advantages of Automated Sniping",
      content:
        "Instant Entry: Bots execute orders the moment liquidity is detected, potentially securing a more favorable price.\nAutomated Trading: Once set up, the bot operates around the clock without the need for constant human supervision.\nSafety Mechanisms: Sophisticated filters can identify suspicious tokens or scam strategies, minimizing risk.\nProfit Monitoring: Many sniper services offer dashboards to track profits, fees, and trading history.",
    },
    {
      title: "Top Tips for Utilizing a Sniping Tool",
      content: [
        "Even with an automated sniper for Solana tokens, you'll want to keep these tips in mind:",
        "Token Research: While automation is beneficial, conduct your own research to steer clear of dubious projects.\nAdjust Settings: Set up buy limits, stop-losses, and filters to align with your trading strategy.\nCheck RPC Speed: Utilize faster, reliable RPC endpoints to ensure quick transaction confirmations.\nStay Updated: Even automated tools require oversight. Keep an eye on the wider Solana market.",
      ],
    },
  ];

  return (
    <div className="h-[808px] top-[371px] bg-[linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="relative w-[1510px] h-[1133px] top-[-450px]">
        <div className="absolute w-[444px] h-[445px] top-[617px] left-[1066px] opacity-50">
          <div className="relative w-[214px] h-[445px] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/sphere-1.png)] bg-cover bg-[50%_50%]">
            <img
              className="w-[214px] h-[445px] absolute top-0 left-0"
              alt="Mask group"
              src="https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group-4.png"
            />
          </div>
        </div>

        <img
          className="absolute w-[1288px] h-[971px] top-0 left-0"
          alt="Glow"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/glow.svg"
        />

        <div className="flex flex-col w-[728px] items-start gap-8 absolute top-[576px] left-[93px]">
          <div className="flex flex-col items-center gap-4 relative self-stretch w-full flex-[0_0_auto]">
            <div className="relative self-stretch mt-[-1.00px] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)] [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent] [font-family:'Satoshi-Black',Helvetica] font-black text-transparent text-[32px] tracking-[0] leading-[38.4px]">
              📚 A Quick Guide to Sniper Bots on Solana
            </div>

            <div className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
              In the Solana ecosystem, speed is crucial. A sniper bot designed
              for Solana tokens can enable you to acquire newly launched assets
              in mere seconds—often outpacing the competition. Here, we&apos;ll
              delve into the functions of these automated tools, their
              operational mechanics, and their significance for traders seeking
              a competitive advantage. We introduce you to a revamped approach
              to automated Solana token sniping.
            </div>
          </div>

          {sniperBotGuideContent.map((section, index) => (
            <div
              key={`section-${index}`}
              className="flex flex-col items-center gap-4 relative self-stretch w-full flex-[0_0_auto]"
            >
              <div className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-2xl tracking-[0] leading-[28.8px]">
                {section.title}
              </div>

              {Array.isArray(section.content) ? (
                section.content.map((paragraph, pIndex) => (
                  <div
                    key={`paragraph-${index}-${pIndex}`}
                    className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]"
                  >
                    {paragraph}
                  </div>
                ))
              ) : (
                <div className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                  {section.content}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
