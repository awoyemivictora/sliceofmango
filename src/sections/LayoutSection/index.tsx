import React from "react";

export const LayoutSection = (): JSX.Element => {
  const partnerLogos = [
    {
      width: "w-[331.51px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-2.png",
      alt: "Partner logo 1",
    },
    {
      width: "w-[200px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-5.png",
      alt: "Partner logo 2",
    },
    {
      width: "w-[200px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-6.png",
      alt: "Partner logo 3",
    },
    {
      width: "w-[253.85px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-1.png",
      alt: "Partner logo 4",
    },
    {
      width: "w-[184.65px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-3.png",
      alt: "Partner logo 5",
    },
    {
      width: "w-[237.86px]",
      src: "https://c.animaapp.com/mcs1777vCoVcpz/img/image-4.png",
      alt: "Partner logo 6",
    },
  ];

  return (
    <section className="h-[360px] top-[1178px] bg-[linear-gradient(0deg,rgba(2,28,20,1)_0%,rgba(2,28,20,1)_100%)] absolute w-[1280px] left-0 overflow-hidden">
      <div className="absolute w-[1280px] h-[409px] top-[153px] left-0">
        {/* Decorative background element */}
        <div className="top-px left-[413px] absolute w-[419px] h-[407px] rotate-180 opacity-[0.21]">
          <div className="relative w-[470px] h-[359px]">
            <div className="absolute w-[359px] h-[359px] top-0 left-0 rounded-[179.36px] blur-[50.43px] bg-[linear-gradient(143deg,rgba(76,175,80,1)_0%,rgba(76,175,80,0)_100%)]" />
            <img
              className="h-[145px] top-[202px] absolute w-[464px] left-1.5 -rotate-180"
              alt="Polygon"
              src="https://c.animaapp.com/mcs1777vCoVcpz/img/polygon-2.svg"
            />
          </div>
        </div>

        {/* Partner logos section */}
        <div className="absolute w-[1280px] h-[50px] top-0 left-0">
          <div className="flex w-[1780px] items-center justify-between relative left-[640px]">
            {partnerLogos.map((logo, index) => (
              <img
                key={`partner-logo-${index}`}
                className={`${logo.width} relative h-[50px] object-cover ${index > 1 ? "mt-[-9678.00px] ml-[-6672.00px]" : ""}`}
                alt={logo.alt}
                src={logo.src}
              />
            ))}
          </div>
        </div>

        {/* Description text */}
        <div className="absolute w-[728px] top-[94px] left-[276px] font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] text-center tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
          With the right approach, a Solana sniper tool can help you capitalize
          on new token opportunities faster than ever. Remember to combine
          automation with smart research and risk management for the best
          results.
        </div>
      </div>

      {/* Section heading */}
      <h2 className="absolute top-[78px] left-[350px] [font-family:'Satoshi-Black',Helvetica] font-black text-white text-2xl text-center tracking-[0] leading-[28.8px] whitespace-nowrap">
        Integrated with Best Web3 Products &amp; Community
      </h2>
    </section>
  );
};
