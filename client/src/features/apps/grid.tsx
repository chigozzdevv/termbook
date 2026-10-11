"use client";

import { useDialogs } from "@/components/layout/providers";
import { Card } from "./card";
import { Integration } from "./integration";

export function Grid() {
  const { contact } = useDialogs();
  return (
    <div className="grid max-w-[744px] grid-cols-2 gap-6 max-[740px]:max-w-[360px] max-[740px]:grid-cols-1">
      <Card />
      <Integration onOpen={() => contact("App integration")} />
    </div>
  );
}
