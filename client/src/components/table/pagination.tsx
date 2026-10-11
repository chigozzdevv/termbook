import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";

export function Pagination({
  page,
  pages,
  onPage,
}: {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}) {
  const buttons = [
    { label: "First page", Icon: ChevronsLeft, target: 0, disabled: page === 0 },
    { label: "Previous page", Icon: ChevronLeft, target: page - 1, disabled: page === 0 },
    { label: "Next page", Icon: ChevronRight, target: page + 1, disabled: page >= pages - 1 },
    { label: "Last page", Icon: ChevronsRight, target: pages - 1, disabled: page >= pages - 1 },
  ];
  return (
    <div className="flex gap-2" aria-label="Pagination">
      {buttons.map(({ label, Icon, target, disabled }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          disabled={disabled}
          onClick={() => onPage(target)}
          className="touch-target grid h-[38px] w-[50px] place-items-center rounded-[10px] border border-line bg-transparent p-0 disabled:opacity-32"
        >
          <Icon aria-hidden="true" size={16} />
        </button>
      ))}
    </div>
  );
}
