import type { ReactNode } from "react";

export function Fact({
  label,
  children,
  wide,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-full" : undefined}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
