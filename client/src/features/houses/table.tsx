import { Plus } from "lucide-react";
import { Identifier } from "@/components/table/identifier";
import { Sort, type SortState } from "@/components/table/sort";
import { Status } from "@/components/table/status";
import { money } from "@/lib/format";
import { canSupply, depositState, sharePrice } from "./state";
import type { House } from "./types";

interface Props {
  houses: House[];
  sort: SortState;
  onSort: (key: string) => void;
  onHouse: (address: string) => void;
  onSupply: (house: House) => void;
}

export function Table({ houses, sort, onSort, onHouse, onSupply }: Props) {
  return (
    <table className="data-table" aria-label="Houses">
      <thead>
        <tr>
          <Sort label="House" name="house" sort={sort} onSort={onSort} />
          <Sort label="Lend asset" name="assetSymbol" sort={sort} onSort={onSort} />
          <Sort label="Liquidity" name="availableCash" sort={sort} onSort={onSort} />
          <Sort label="Reserved" name="committedCash" sort={sort} onSort={onSort} />
          <Sort label="Deployed" name="drawnPrincipal" sort={sort} onSort={onSort} />
          <Sort label="Assets" name="totalAssets" sort={sort} onSort={onSort} />
          <Sort label="Share price" name="sharePrice" sort={sort} onSort={onSort} />
          <th>Deposits</th>
          <th>Status</th>
          <th className="action-cell">Actions</th>
        </tr>
      </thead>
      <tbody>
        {houses.map((house) => (
          <tr key={house.house}>
            <td>
              <Identifier
                value={house.house}
                label="house"
                square
                onClick={() => onHouse(house.house)}
              />
            </td>
            <td>
              <span className="inline-flex items-center gap-[6px] font-mono text-xs">
                <span
                  aria-hidden="true"
                  className="grid size-4 place-items-center rounded-full bg-[#205087] font-serif text-[11px] text-[#a8d1ed]"
                >
                  $
                </span>
                USDC
              </span>
            </td>
            <td className="number">{money(house.availableCash)}</td>
            <td className="number">{money(house.committedCash)}</td>
            <td className="number">{money(house.drawnPrincipal)}</td>
            <td className="number">{money(house.totalAssets)}</td>
            <td className="number">{sharePrice(house)}</td>
            <td className="text-muted">{depositState(house)}</td>
            <td>
              <Status value={house.paused ? "paused" : "active"} />
            </td>
            <td className="action-cell">
              <button
                type="button"
                onClick={() => onSupply(house)}
                aria-label={`Supply to house ${house.house}`}
                disabled={!canSupply(house)}
                className="touch-target inline-flex h-6 items-center gap-[5px] rounded-md border border-[#46404f] bg-[#231f2c] px-2 py-[2px] text-xs leading-[18px] whitespace-nowrap text-[#d8ceee] disabled:opacity-35"
              >
                <Plus aria-hidden="true" size={13} />
                Supply
              </button>
            </td>
          </tr>
        ))}
        {!houses.length && (
          <tr>
            <td colSpan={10} className="!p-10 !text-center text-muted">
              No matching houses.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
