import React from "react";
import { Button } from "@/components/ui/Button";

export const MainContentSection = (): JSX.Element => {
  // Define data for the dot grid pattern
  const dotOpacityPatterns = [
    [10, 10, 20, 20, 45, 45, 80, 80, 45, 45, 20, 20, 10, 10],
    [10, 10, 20, 20, 45, 45, 80, 80, 45, 45, 20, 20, 10, 10],
  ];

  return (
    <section className="h-[372px] top-0 bg-[linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="relative h-[554px] top-[34px]">
        {/* Green gradient effect */}
        <div className="top-[147px] left-[421px] absolute w-[419px] h-[407px] rotate-180 opacity-[0.21]">
          <div className="relative w-[470px] h-[359px]">
            <div className="absolute w-[359px] h-[359px] top-0 left-0 rounded-[179.36px] blur-[50.43px] bg-[linear-gradient(143deg,rgba(76,175,80,1)_0%,rgba(76,175,80,0)_100%)]" />
            <img
              className="h-[130px] top-[216px] absolute w-[464px] left-1.5 -rotate-180"
              alt="Polygon"
              src="https://c.animaapp.com/mcs1777vCoVcpz/img/polygon-2-1.svg"
            />
          </div>
        </div>

        {/* Dot grid pattern */}
        <div className="flex flex-col w-[821px] items-start gap-[10.48px] absolute top-[246px] left-[230px] opacity-10">
          {dotOpacityPatterns.map((row, rowIndex) => (
            <div
              key={`row-${rowIndex}`}
              className="flex items-center gap-[10.48px] relative self-stretch w-full flex-[0_0_auto]"
            >
              {row.map((opacity, dotIndex) => (
                <div
                  key={`dot-${rowIndex}-${dotIndex}`}
                  className={`relative w-[48.88px] h-[48.88px] bg-white rounded-[24.44px] shadow-[0px_0px_3.81px_0.95px_#00000040] opacity-${opacity}`}
                />
              ))}
            </div>
          ))}
        </div>

        {/* Image container */}
        <div className="absolute w-[482px] h-[370px] top-0 left-[701px]">
          <div className="h-[370px]">
            <div className="w-[482px] h-[338px] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/rectangle.png)] bg-[100%_100%]">
              <div className="relative w-[461px] h-[260px] top-2.5 left-2.5 bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group-2.png)] bg-[100%_100%]" />
            </div>
          </div>
        </div>

        {/* Gradient overlay */}
        <div className="top-[173px] absolute w-[1280px] h-[165px] left-0 backdrop-blur-sm backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(4px)_brightness(100%)] bg-[linear-gradient(180deg,rgba(2,28,20,0)_0%,rgba(2,28,20,1)_100%)]" />

        {/* Content section */}
        <div className="flex flex-col w-[540px] items-start gap-4 absolute top-[61px] left-[54px]">
          <h1 className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-[32px] tracking-[0] leading-[38.4px]">
            Solana Sniper easy 🤑secure 💶automated 🤖
          </h1>

          <p className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
            Snipe Solana tokens instantly with precision and speed. Automate
            your trades and maximize profits before anyone else! 🚀🎯💰
          </p>

          <Button className="flex w-[161px] h-[41px] items-center justify-center gap-2 px-2 py-1.5 relative bg-[#ffffff1a] rounded-[60px] overflow-hidden border-[none] shadow-[0px_1px_4px_#0000001a]">
            <span className="relative w-fit font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
              Launch Sniper
            </span>
          </Button>
        </div>
      </div>
    </section>
  );
};
