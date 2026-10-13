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
  onSupply: (house: House) => void;
  unavailable?: boolean;
  empty?: string;
}

export function Table({ houses, sort, onSort, onSupply, unavailable, empty }: Props) {
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
                href={`/houses/${house.house}`}
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
                {house.assetSymbol}
              </span>
            </td>
            <td className="number">{money(house.availableCash, house.decimals)}</td>
            <td className="number">{money(house.committedCash, house.decimals)}</td>
            <td className="number">{money(house.drawnPrincipal, house.decimals)}</td>
            <td className="number">{money(house.totalAssets, house.decimals)}</td>
            <td className="number">{sharePrice(house)}</td>
            <td className="text-muted">{depositState(house)}</td>
            <td>
              <Status value={!house.active ? "inactive" : house.paused ? "paused" : "active"} />
            </td>
            <td className="action-cell">
              <button
                type="button"
                onClick={() => onSupply(house)}
                aria-label={`Supply to house ${house.house}`}
                disabled={unavailable || !canSupply(house)}
                className="touch-target inline-flex min-h-7 items-center justify-center gap-1 rounded border border-line bg-transparent px-[10px] py-1 text-xs leading-[18px] whitespace-nowrap text-[#a6a6ff] hover:border-accent hover:text-white disabled:opacity-35"
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
              {empty ?? "No matching houses."}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
}
