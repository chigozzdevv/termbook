import { Logo } from "@/components/brand/logo";
import Link from "next/link";

const links = [
  ["Docs", "/docs"],
  ["GitHub", "https://github.com/chigozzdevv/termbook"],
  ["Feedback", "https://github.com/chigozzdevv/termbook/issues"],
];

export function Footer() {
  return (
    <footer className="gutter flex flex-wrap items-center justify-between gap-x-8 gap-y-5 border-t border-[#25282a] pt-6 pb-7 max-[430px]:pt-5 max-[430px]:pb-6">
      <Logo footer />
      <nav aria-label="Resources" className="flex flex-wrap items-center gap-7 max-[740px]:gap-6">
        {links.map(([label, href]) => (
          <Link
            key={label}
            href={href}
            target={href.startsWith("https:") ? "_blank" : undefined}
            rel={href.startsWith("https:") ? "noopener noreferrer" : undefined}
            className="touch-target inline-flex min-h-8 items-center text-[13px] leading-[1.4] text-[#a4aaad] no-underline hover:text-[#f4f4ef]"
          >
            {label}
          </Link>
        ))}
      </nav>
    </footer>
  );
}
