"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useWallet } from "@/features/wallet/use-wallet";
import { Picker } from "@/features/wallet/picker";

export function CreateButton() {
  const wallet = useWallet();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Link
        href="/houses/create"
        onNavigate={(event) => {
          if (wallet.busy || wallet.connection?.chain !== 10143) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        className="touch-target inline-flex min-h-[38px] shrink-0 items-center gap-2 rounded-lg border border-line bg-transparent px-3 py-2 text-[13px] text-[#d7dcde] hover:border-[#53585b] hover:bg-[#222527] hover:text-[#f4f4ef] max-[430px]:text-xs"
      >
        <Plus size={15} aria-hidden="true" />
        Create House
      </Link>
      <Picker
        id="create-house-wallet"
        open={open}
        onClose={() => setOpen(false)}
        onConnected={() => router.push("/houses/create")}
      />
    </>
  );
}
