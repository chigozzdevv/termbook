import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  wrapperClassName?: string;
}

export function Select({ className = "", wrapperClassName = "", children, ...props }: Props) {
  return (
    <span className={`relative block min-w-0 ${wrapperClassName}`}>
      <select className={`field appearance-none pr-[38px] ${className}`} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-[14px] -translate-y-1/2 text-[#a4aaad]"
      />
    </span>
  );
}
