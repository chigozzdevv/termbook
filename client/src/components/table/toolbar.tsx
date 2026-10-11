import { Funnel } from "lucide-react";
import { Select } from "@/components/ui/select";
import { statusLabel } from "@/lib/format";
import { Pagination } from "./pagination";

interface Props {
  label: string;
  query: string;
  onQuery: (value: string) => void;
  count: number;
  status: string;
  statuses: string[];
  onStatus: (value: string) => void;
  page: number;
  pages: number;
  onPage: (value: number) => void;
}

export function Toolbar({
  label,
  query,
  onQuery,
  count,
  status,
  statuses,
  onStatus,
  page,
  pages,
  onPage,
}: Props) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-4 max-[430px]:gap-[10px]">
      <label className="m-0 flex h-[38px] min-w-[220px] max-w-[450px] flex-1 items-center gap-[10px] rounded-[10px] border border-[#35383b] bg-[#1c1e20] px-3 py-1 focus-within:border-[#7070ff] focus-within:ring-2 focus-within:ring-accent/12 max-[740px]:max-w-none max-[430px]:min-w-0 max-[430px]:basis-full">
        <Funnel aria-hidden="true" size={17} className="shrink-0 text-muted" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          aria-label={`Filter ${label}`}
          placeholder={`Filter ${label.toLowerCase()}`}
          className="m-0 h-6 w-full min-w-0 border-0 bg-transparent p-0 text-sm leading-6 outline-none placeholder:text-[#8e969a]"
        />
        <span
          aria-live="polite"
          className="min-w-[90px] rounded-md bg-[#26282b] px-[10px] py-1 text-center text-xs leading-[1.2] whitespace-nowrap text-muted"
        >
          {count} result{count === 1 ? "" : "s"}
        </span>
      </label>
      <div className="flex items-center gap-3 max-[740px]:ml-auto max-[430px]:w-full max-[430px]:flex-wrap max-[430px]:justify-between">
        <Select
          value={status}
          onChange={(event) => onStatus(event.target.value)}
          aria-label="Filter by status"
          className="h-[38px] max-w-[145px] rounded-[9px] border-line bg-[#181a1c] px-[10px] py-2 pr-9 text-[13px] leading-[1.3] text-[#b2b7ba]"
        >
          <option value="all">All statuses</option>
          {statuses.map((value) => (
            <option key={value} value={value}>
              {statusLabel(value)}
            </option>
          ))}
        </Select>
        <Pagination page={page} pages={pages} onPage={onPage} />
      </div>
    </div>
  );
}
