"use client";

import { useState } from "react";
import { useDialogs } from "@/components/layout/providers";
import { Card } from "./card";
import { Integration } from "./integration";
import { Kuru } from "./kuru";

export function Grid() {
  const { contact } = useDialogs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="grid max-w-[744px] grid-cols-2 gap-6 max-[740px]:max-w-[360px] max-[740px]:grid-cols-1">
        <Card onOpen={() => setOpen(true)} />
        <Integration onOpen={() => contact("App integration")} />
      </div>
      <Kuru open={open} onClose={() => setOpen(false)} />
    </>
  );
}
