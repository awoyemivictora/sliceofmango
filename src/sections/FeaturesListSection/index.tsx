import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";



export const FeaturesListSection = (): JSX.Element => {
  const faqItems = [
    {
      question:
        "1. What is SOL Sniper, and in what ways can it improve my trading experience?",
      answer:
        "SOL Sniper is the quickest automated sniper bot for Solana, designed to execute trades on newly launched tokens instantly. By utilizing real-time monitoring of liquidity pools and integrating smoothly with your Solana wallet, it enhances the buying and selling experience—allowing you to seize optimal entry points and maximize your profit potential.",
    },
    {
      question: "2. What is the functionality of SOL Sniper?",
      answer:
        "The tool constantly scans the Solana blockchain, keeping an eye on liquidity pools for new token listings. Once a token that meets your criteria is found, SOL Sniper promptly activates orders to purchase tokens and carry out selling orders via your connected Solana wallet, ensuring you never overlook a lucrative opportunity.",
    },
    {
      question: "Top Tips for Effectively Utilizing a Sniping Tool",
      answer:
        "Using SOL Sniper is free—only a 1% fee applies to each successful trade as a post-trade charge, meaning you only pay when you profit. This clear fee structure keeps transaction costs low and predictable.",
    },
  ];

  return (
    <div className="h-[729px] top-[3053px] bg-[linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="absolute w-[1288px] h-[1205px] top-[-465px] left-0">
        <img
          className="absolute w-[904px] h-[731px] top-[475px] left-[13px]"
          alt="Vector"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/vector-456.svg"
        />

        <img
          className="absolute w-[1288px] h-[971px] top-0 left-0"
          alt="Glow"
          src="https://c.animaapp.com/mcs1777vCoVcpz/img/glow.svg"
        />

        <div className="flex flex-col w-[1192px] items-start gap-16 absolute top-[639px] left-11">
          <div className="relative self-stretch mt-[-1.00px] bg-[linear-gradient(180deg,rgba(255,255,255,1)_0%,rgba(16,185,129,1)_100%)] [-webkit-background-clip:text] bg-clip-text [-webkit-text-fill-color:transparent] [text-fill-color:transparent] [font-family:'Satoshi-Black',Helvetica] font-black text-transparent text-[32px] tracking-[0] leading-[38.4px]">
            ❓ FAQ: Sniping on Solana
          </div>

          <Accordion type="single" collapsible className="w-full">
            {faqItems.map((item, index) => (
              <AccordionItem
                key={`faq-${index}`}
                value={`item-${index}`}
                className="border-b border-white/10"
              >
                <AccordionTrigger className="relative self-stretch mt-[-1.00px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-2xl tracking-[0] leading-[28.8px] py-4">
                  {item.question}
                </AccordionTrigger>
                <AccordionContent className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)] pt-2 pb-4">
                  {item.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>

      <div className="top-[850px] absolute w-[1280px] h-[165px] left-0 backdrop-blur-sm backdrop-brightness-[100%] [-webkit-backdrop-filter:blur(4px)_brightness(100%)] bg-[linear-gradient(180deg,rgba(2,28,20,0)_0%,rgba(2,28,20,1)_100%)]" />
    </div>
  );
};
