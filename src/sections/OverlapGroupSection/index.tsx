import React from "react";
import { Card, CardContent } from "@/components/ui/card";

export const OverlapGroupSection = (): JSX.Element => {
  const featureCards = [
    {
      id: "instant-launch",
      title: "Instant Launch Domination",
      description:
        "Strike first, snipe fast, and stay ahead of the competition.",
      width: "w-[964px]",
      top: "top-[398px]",
      left: "left-[246px]",
      contentLeft: "left-[65px]",
      hasImage: true,
      imageUrl: "https://c.animaapp.com/mcs1777vCoVcpz/img/rocket-1.png",
      imagePosition: "top-[54px] left-[702px]",
    },
    {
      id: "price-monitoring",
      title: "Real-Time Price Monitoring",
      description:
        "Track token prices live on chart and execute trades at the perfect moment.",
      width: "w-[474px]",
      top: "top-[717px]",
      left: "left-[246px]",
      contentLeft: "left-[45px]",
      hasImage: false,
    },
    {
      id: "rug-protection",
      title: "Rug Pull Protection",
      description:
        "Detect and avoid high-risk tokens with smart safety filters.",
      width: "w-[474px]",
      top: "top-[717px]",
      left: "left-[736px]",
      contentLeft: "left-[45px]",
      hasImage: false,
      titleWidth: "w-[246.1px]",
      alignItems: "items-start",
    },
  ];

  return (
    <section className="h-[808px] top-[2246px] bg-[linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="relative w-[1376px] h-[1620px] top-[-305px] left-[-88px]">
        <div className="absolute w-[840px] h-[840px] top-[305px] left-[88px] blur-[14px] opacity-[0.74]">
          <div className="relative h-[808px] bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/thorus-02-1.png)] bg-cover bg-[50%_50%]">
            <img
              className="w-[840px] h-[808px] absolute top-0 left-0"
              alt="Mask group"
              src="https://c.animaapp.com/mcs1777vCoVcpz/img/mask-group-3.png"
            />
          </div>
        </div>

        <img
          className="absolute w-[1288px] h-[971px] top-[649px] left-[88px]"
          alt="Glow"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/glow.svg"
        />

        <img
          className="absolute w-[917px] h-[1000px] top-0 left-0"
          alt="Ellipse"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-1.svg"
        />

        {featureCards.map((card) => (
          <Card
            key={card.id}
            className={`absolute ${card.width} h-[303px] ${card.top} ${card.left} bg-[#021811] rounded-2xl overflow-hidden border-[none]`}
          >
            <CardContent className="p-0">
              <div
                className={`flex flex-col w-96 ${card.alignItems || "items-center"} gap-6 absolute top-[78px] ${card.contentLeft}`}
              >
                <div
                  className={`relative ${card.titleWidth || "self-stretch"} mt-[-1.00px] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)] [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent] [font-family:'Satoshi-Black',Helvetica] font-black text-transparent text-[32px] tracking-[0] leading-[38.4px]`}
                >
                  {card.title}
                </div>

                <div className="relative self-stretch font-header-medium-06 font-[number:var(--header-medium-06-font-weight)] text-white text-[length:var(--header-medium-06-font-size)] tracking-[var(--header-medium-06-letter-spacing)] leading-[var(--header-medium-06-line-height)] [font-style:var(--header-medium-06-font-style)]">
                  {card.description}
                </div>
              </div>

              {card.hasImage && (
                <img
                  className={`absolute w-[195px] h-[195px] ${card.imagePosition} object-cover`}
                  alt="Rocket"
                  src={card.imageUrl}
                />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
};
