"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Dialog as ContactDialog } from "@/features/contact/dialog";
import { Dialog as SupplyDialog } from "@/features/supply/dialog";
import type { ContactValues } from "@/features/contact/schema";
import type { House } from "@/features/houses/types";
import { canSupply } from "@/features/houses/state";

interface Dialogs {
  contact: (reason?: ContactValues["reason"]) => void;
  supply: (house: House) => void;
}

const Context = createContext<Dialogs | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [contactOpen, setContactOpen] = useState(false);
  const [reason, setReason] = useState<ContactValues["reason"]>();
  const [house, setHouse] = useState<House | null>(null);
  return (
    <Context.Provider
      value={{
        contact: (reason) => {
          setReason(reason);
          setContactOpen(true);
        },
        supply: (house) => {
          if (canSupply(house)) setHouse(house);
        },
      }}
    >
      {children}
      <ContactDialog open={contactOpen} reason={reason} onClose={() => setContactOpen(false)} />
      <SupplyDialog house={house} onClose={() => setHouse(null)} />
    </Context.Provider>
  );
}

export function useDialogs(): Dialogs {
  const value = useContext(Context);
  if (!value) throw new Error("Dialog provider is missing");
  return value;
}
