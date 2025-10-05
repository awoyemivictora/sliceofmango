import React from "react";
import { Button } from "@/components/ui/Button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";

export const OverlapSection = (): JSX.Element => {
  const planFeatures = {
    free: [
      "Basic filters (socials, LP, revoked authorities)",
      "Custom RPC endpoints",
    ],
    premium: [
      "Basic filters (socials, LP, revoked authorities)",
      "Custom RPC endpoints",
      "Check Top 10 Holder Percentage",
      "Check Token Bundled Percentage",
      "Check Token Same Block Buys",
    ],
  };

  return (
    <div className="h-[808px] top-[1438px] bg-[linear-gradient(0deg,rgba(2,28,20,0.2)_0%,rgba(14,164,115,0.2)_100%),linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="relative w-[2236px] h-[972px] left-[-492px]">
        <div className="absolute w-[310px] h-[310px] top-0 left-[505px] blur-[7px] opacity-[0.77] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/icosahedron-1-1.png)] bg-cover bg-[50%_50%]">
          <img
            className="w-[310px] h-[310px] absolute top-0 left-0"
            alt="Mask group"
            src="https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group-1.png"
          />
        </div>

        <img
          className="absolute w-[2182px] h-[561px] top-[319px] left-0"
          alt="Vector"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-6.svg"
        />

        <img
          className="absolute w-[1930px] h-[634px] top-[338px] left-[306px]"
          alt="Vector"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-7.svg"
        />

        <div className="absolute w-[1280px] h-[165px] top-[643px] left-[492px] backdrop-blur-sm backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(4px)_brightness(100%)] bg-[linear-gradient(180deg,rgba(2,28,20,0)_0%,rgba(2,28,20,1)_100%)]" />

        <div className="flex flex-col w-[898px] items-center gap-12 absolute top-[54px] left-[683px]">
          <div className="flex flex-col w-[539.88px] items-center gap-4 relative flex-[0_0_auto]">
            <div className="relative self-stretch mt-[-1.00px] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)] [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent] [font-family:'Satoshi-Black',Helvetica] font-black text-transparent text-[32px] text-center tracking-[0] leading-[38.4px]">
              Straightforward Pricing
            </div>

            <div className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] text-center tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
              Select the plan that suits your requirements. Begin for free, or
              access premium features for enhanced sniping capabilities! 🚀
            </div>
          </div>

          <div className="flex items-center gap-6 relative self-stretch w-full flex-[0_0_auto]">
            {/* Free Plan Card */}
            <Card className="flex flex-col w-[437px] h-[481px] items-start gap-7 p-6 relative bg-[#011710] rounded-3xl">
              <CardHeader className="flex flex-col items-start gap-4 pt-0 pb-4 px-0 relative self-stretch w-full flex-[0_0_auto] border-b [border-bottom-style:solid] border-[#ffffff1a] p-0">
                <div className="flex flex-col items-start gap-3 relative self-stretch w-full flex-[0_0_auto]">
                  <div className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-base tracking-[0] leading-[19.2px]">
                    Free Plan
                  </div>

                  <div className="relative self-stretch rotate-[0.27deg] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                    Includes all features except premium Safety filters. Good
                    for trying out the bot and risky snipes.
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0 gap-4 self-stretch w-full flex-[0_0_auto] flex flex-col items-start relative">
                <div className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-[32px] tracking-[0] leading-[38.4px]">
                  $0
                </div>

                <div className="relative self-stretch rotate-[0.27deg] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-[#ffffff4c] text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                  Monthly Subscription
                </div>
              </CardContent>

              <Button className="flex h-[41px] items-center justify-center gap-2 px-2 py-1.5 relative self-stretch w-full bg-emerald-500 rounded-[60px] overflow-hidden border-[none] shadow-[0px_1px_4px_#0000001a,0px_0px_0px_1px_#0c9668,0px_1px_2px_#0b835b7a]">
                <span className="relative w-fit font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
                  Get Started
                </span>
              </Button>

              <CardFooter className="p-0 gap-4 self-stretch w-full flex-[0_0_auto] flex flex-col items-start relative">
                <div className="relative self-stretch mt-[-0.07px] rotate-[0.27deg] font-small-text-bold font-[number:var(--small-text-bold-font-weight)] text-white text-[length:var(--small-text-bold-font-size)] tracking-[var(--small-text-bold-letter-spacing)] leading-[var(--small-text-bold-line-height)] [font-style:var(--small-text-bold-font-style)]">
                  Includes:
                </div>

                <div className="inline-flex flex-col items-start gap-2 relative flex-[0_0_auto]">
                  {planFeatures.free.map((feature, index) => (
                    <div
                      key={`free-feature-${index}`}
                      className="inline-flex items-center gap-2 relative flex-[0_0_auto]"
                    >
                      <img
                        className="relative w-4 h-4"
                        alt="Checkmark circle"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/checkmark-circle-02.svg"
                      />
                      <div className="relative w-fit mt-[-0.41px] rotate-[0.27deg] font-small-text font-[number:var(--small-text-font-weight)] text-white text-[length:var(--small-text-font-size)] tracking-[var(--small-text-letter-spacing)] leading-[var(--small-text-line-height)] whitespace-nowrap [font-style:var(--small-text-font-style)]">
                        {feature}
                      </div>
                    </div>
                  ))}
                </div>
              </CardFooter>
            </Card>

            {/* Premium Plan Card */}
            <Card className="flex flex-col w-[437px] items-start gap-7 p-6 relative bg-[#011710] rounded-3xl">
              <CardHeader className="flex flex-col items-start gap-4 pt-0 pb-4 px-0 relative self-stretch w-full flex-[0_0_auto] border-b [border-bottom-style:solid] border-[#ffffff1a] p-0">
                <div className="flex flex-col items-start gap-3 relative self-stretch w-full flex-[0_0_auto]">
                  <div className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-base tracking-[0] leading-[19.2px]">
                    Premium Plan
                  </div>

                  <div className="relative self-stretch rotate-[0.27deg] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                    Includes all features for serious traders and gives you
                    maximum protection against rug pulls.
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0 gap-4 self-stretch w-full flex-[0_0_auto] flex flex-col items-start relative">
                <div className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-[32px] tracking-[0] leading-[38.4px]">
                  $99
                </div>

                <div className="relative self-stretch rotate-[0.27deg] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-[#ffffff4c] text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
                  Monthly Subscription
                </div>
              </CardContent>

              <Button className="flex h-[41px] items-center justify-center gap-2 px-2 py-1.5 relative self-stretch w-full bg-emerald-500 rounded-[60px] overflow-hidden border-[none] shadow-[0px_1px_4px_#0000001a,0px_0px_0px_1px_#0c9668,0px_1px_2px_#0b835b7a]">
                <span className="relative w-fit font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
                  Get Started
                </span>
              </Button>

              <CardFooter className="p-0 gap-4 self-stretch w-full flex-[0_0_auto] flex flex-col items-start relative">
                <div className="relative self-stretch mt-[-0.07px] rotate-[0.27deg] font-small-text-bold font-[number:var(--small-text-bold-font-weight)] text-white text-[length:var(--small-text-bold-font-size)] tracking-[var(--small-text-bold-letter-spacing)] leading-[var(--small-text-bold-line-height)] [font-style:var(--small-text-bold-font-style)]">
                  Includes:
                </div>

                <div className="gap-2 self-stretch w-full flex-[0_0_auto] flex flex-col items-start relative">
                  {planFeatures.premium.map((feature, index) => (
                    <div
                      key={`premium-feature-${index}`}
                      className="inline-flex items-center gap-2 relative flex-[0_0_auto]"
                    >
                      <img
                        className="relative w-4 h-4"
                        alt="Checkmark circle"
                        src="https://c.animaapp.com/mcs1777vCoVcpz/img/checkmark-circle-02.svg"
                      />
                      <div className="relative w-fit mt-[-0.41px] rotate-[0.27deg] font-small-text font-[number:var(--small-text-font-weight)] text-white text-[length:var(--small-text-font-size)] tracking-[var(--small-text-letter-spacing)] leading-[var(--small-text-line-height)] whitespace-nowrap [font-style:var(--small-text-font-style)]">
                        {feature}
                      </div>
                    </div>
                  ))}
                </div>
              </CardFooter>
            </Card>
          </div>

          <div className="inline-flex items-center justify-center gap-2 px-4 py-2.5 relative flex-[0_0_auto] bg-[#07593f] rounded-[32px] overflow-hidden">
            <div className="relative w-fit mt-[-1.00px] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] text-center tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] whitespace-nowrap [font-style:var(--small-text-medium-font-style)]">
              Once the offer expires, the price will go up and availability may
              be limited. Act fast to lock in your savings today!
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
