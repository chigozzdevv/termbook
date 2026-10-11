import type { TextareaHTMLAttributes } from "react";

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`field h-auto min-h-[108px] resize-y py-[10px] leading-[1.5] placeholder:text-[#737b80] ${className}`}
      {...props}
    />
  );
}
