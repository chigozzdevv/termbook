"use client";

import Image from "next/image";
import { useState } from "react";
import { Wallet } from "lucide-react";
import { imageSource } from "./branding";

export function WalletIcon({ src }: { src?: string }) {
  const [failed, setFailed] = useState<string>();
  const safe = imageSource(src);
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#24272a]">
      {safe && failed !== safe ? (
        <Image
          src={safe}
          alt=""
          width={32}
          height={32}
          unoptimized
          className="size-8 object-contain"
          onError={() => setFailed(safe)}
        />
      ) : (
        <Wallet aria-hidden="true" size={23} className="text-muted" />
      )}
    </span>
  );
}
