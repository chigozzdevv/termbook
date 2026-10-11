import Link from "next/link";
import { CopyButton } from "@/components/ui/copy-button";
import { short } from "@/lib/format";

interface Props {
  value: string;
  label: string;
  href?: string;
  onClick?: () => void;
  square?: boolean;
  external?: boolean;
}

export function Identifier({ value, label, href, onClick, square, external }: Props) {
  const content = (
    <>
      {square && (
        <span
          aria-hidden="true"
          className="inline-block size-[13px] shrink-0 rounded-[3px] bg-linear-to-br from-[#596270] to-[#b0a1c7]"
        />
      )}
      <span className="underline decoration-[#7a8082] underline-offset-4">{short(value)}</span>
    </>
  );
  const className =
    "touch-target inline-flex items-center gap-2 border-0 bg-transparent p-0 text-left font-mono text-xs leading-[1.4] whitespace-nowrap text-[#d7dcde] hover:text-[#f4f4ef]";
  return (
    <span className="identifier inline-flex items-center gap-[6px] whitespace-nowrap">
      {href ? (
        <Link
          href={href}
          title={value}
          aria-label={`${external ? "View" : "Open"} ${label} ${value}`}
          className={className}
          target={external ? "_blank" : undefined}
          rel={external ? "noopener noreferrer" : undefined}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          onClick={onClick}
          title={value}
          aria-label={`Open ${label} ${value}`}
          className={className}
        >
          {content}
        </button>
      )}
      <CopyButton value={value} label={label === "order" ? "order ID" : `${label} address`} />
    </span>
  );
}
