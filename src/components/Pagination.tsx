"use client";

interface Props {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ currentPage, totalPages, onPageChange }: Props) {
  if (totalPages <= 1) return null;

  const pages: (number | "...")[] = [];
  for (let i = 1; i <= totalPages; i++) {
    if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="flex items-center justify-center gap-1 py-4">
      <button
        onClick={() => onPageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        이전
      </button>
      {pages.map((p, i) =>
        p === "..." ? (
          <span key={`dot-${i}`} className="px-2 text-sm text-zinc-400">...</span>
        ) : (
          <button
            key={p}
            onClick={() => onPageChange(p)}
            className={`rounded-sm px-3 py-1.5 text-sm ${
              p === currentPage
                ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }`}
          >
            {p}
          </button>
        )
      )}
      <button
        onClick={() => onPageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="rounded-sm border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        다음
      </button>
    </div>
  );
}
