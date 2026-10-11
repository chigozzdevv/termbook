import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "border-accent bg-accent text-white hover:bg-[#6666ff]",
  supply: "border-[#544773] bg-[#302640] text-[#e5dcff]",
  secondary: "border-line bg-transparent text-[#b8bdc0] hover:border-[#687074]",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
}

export function Button({ variant = "primary", className = "", type = "button", ...props }: Props) {
  return (
    <button
      type={type}
      className={`touch-target inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border px-[13px] py-2 text-[13px] leading-[1.4] disabled:opacity-60 ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
