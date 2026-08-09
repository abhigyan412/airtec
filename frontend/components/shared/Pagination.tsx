"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

// Every fee list is paginated now — the backend stopped returning a school's
// entire invoice history in one response once fee_invoices.amount_paid removed
// the need to sum payments per row. Without a control the extra pages are
// unreachable, which is worse than the unpaginated version.

export function Pagination({
  page,
  limit,
  total,
  onPageChange,
  label = "rows",
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  label?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (total === 0) return null;

  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-3">
      <p className="text-xs text-muted-foreground">
        {/* The count matters here: "showing 20 of 412 unpaid" is the number an
            accountant is actually looking for, not the page they're on. */}
        Showing <span className="font-medium text-foreground tabular-nums">{first}–{last}</span> of{" "}
        <span className="font-medium text-foreground tabular-nums">{total}</span> {label}
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm" variant="outline"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="px-2 text-xs tabular-nums text-muted-foreground">
          {page} / {pages}
        </span>
        <Button
          size="sm" variant="outline"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= pages}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
