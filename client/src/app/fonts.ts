import localFont from "next/font/local";

export const inter = localFont({
  src: "../../public/fonts/inter.woff2",
  variable: "--font-inter",
  display: "swap",
  weight: "100 900",
});

export const redaction = localFont({
  src: "../../public/fonts/redaction-italic.woff2",
  variable: "--font-redaction",
  display: "swap",
  weight: "400",
});
