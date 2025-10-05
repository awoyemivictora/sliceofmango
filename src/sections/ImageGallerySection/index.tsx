import React from "react";

export const ImageGallerySection = (): JSX.Element => {
  const socialLinks = [
    {
      name: "Twitter",
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/new-twitter.svg",
    },
    {
      name: "Telegram",
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/telegram.svg",
    },
    {
      name: "Discord",
      icon: "https://c.animaapp.com/mcs1777vCoVcpz/img/discord.svg",
    },
  ];

  const navLinks = [{ text: "Pricing" }, { text: "Documentation" }];

  return (
    <footer className="flex flex-col w-[1280px] h-[249px] items-center justify-between p-8 absolute top-[1537px] left-0 bg-[#021c14]">
      <div className="flex flex-col w-[539.88px] items-center gap-4 relative flex-[0_0_auto]">
        <div className="inline-flex items-center gap-[4.29px] relative flex-[0_0_auto]">
          <div className="w-[24.95px] h-[24.95px] relative bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2342.svg)] bg-[100%_100%]">
            <div className="relative w-[17px] h-[17px] top-1 left-1 bg-[url(https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2343.svg)] bg-[100%_100%]">
              <img
                className="absolute w-[9px] h-[9px] top-1 left-1"
                alt="Ellipse"
                src="https://c.animaapp.com/mcs1777vCoVcpz/img/ellipse-2343.svg"
              />
            </div>
          </div>
        </div>

        <p className="relative self-stretch font-small-text-medium font-[number:var(--small-text-medium-font-weight)] text-white text-[length:var(--small-text-medium-font-size)] text-center tracking-[var(--small-text-medium-letter-spacing)] leading-[var(--small-text-medium-line-height)] [font-style:var(--small-text-medium-font-style)]">
          Find quick answers to questions concerning our TurboSniper application
        </p>
      </div>

      <div className="flex items-center justify-between relative self-stretch w-full flex-[0_0_auto]">
        <div className="relative w-fit mt-[-1.00px] [font-family:'Satoshi-Medium',Helvetica] font-medium text-white text-sm tracking-[0] leading-[16.8px] whitespace-nowrap">
          © 2025 | TurboSniper.com | Disclaimer
        </div>

        <nav className="inline-flex items-center gap-4 relative flex-[0_0_auto]">
          {navLinks.map((link, index) => (
            <a
              key={index}
              href="#"
              className="relative w-fit mt-[-1.00px] [font-family:'Satoshi-Medium',Helvetica] font-medium text-white text-sm tracking-[0] leading-[16.8px] whitespace-nowrap hover:underline"
            >
              {link.text}
            </a>
          ))}
        </nav>

        <div className="flex w-[247px] items-center justify-end gap-6 relative">
          {socialLinks.map((social, index) => (
            <a key={index} href="#" aria-label={social.name}>
              <img
                className="relative w-4 h-4 hover:opacity-80 transition-opacity"
                alt={social.name}
                src={social.icon}
              />
            </a>
          ))}
        </div>
      </div>

      <div className="absolute w-[419px] h-[407px] top-[-207px] left-[413px] rotate-180 opacity-[0.21]">
        <div className="relative w-[470px] h-[403px] -top-11">
          <div className="absolute w-[359px] h-[359px] top-11 left-0 rounded-[179.36px] blur-[50.43px] bg-[linear-gradient(143deg,rgba(76,175,80,1)_0%,rgba(76,175,80,0)_100%)]" />

          <img
            className="absolute w-[464px] h-[390px] top-0 left-1.5 -rotate-180"
            alt="Polygon"
            src="https://c.animaapp.com/mcs1777vCoVcpz/img/polygon-2-2.svg"
          />
        </div>
      </div>
    </footer>
  );
};
