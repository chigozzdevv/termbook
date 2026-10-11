import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

export interface SortState {
  key: string;
  direction: 1 | -1;
}

export function Sort({
  label,
  name,
  sort,
  onSort,
}: {
  label: string;
  name: string;
  sort: SortState;
  onSort: (key: string) => void;
}) {
  const active = name === sort.key;
  const Icon = active ? (sort.direction === 1 ? ArrowUp : ArrowDown) : ChevronsUpDown;
  return (
    <th aria-sort={active ? (sort.direction === 1 ? "ascending" : "descending") : "none"}>
      <button
        type="button"
        onClick={() => onSort(name)}
        className="inline-flex items-center gap-[6px] border-0 bg-transparent p-0 text-[13px] leading-[1.4] font-medium text-muted"
      >
        {label}
        <Icon aria-hidden="true" size={13} className="opacity-70" />
      </button>
    </th>
  );
}
