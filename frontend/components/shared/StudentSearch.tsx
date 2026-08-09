"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, X, Loader2 } from "lucide-react";
import { studentsApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

// Find a student and select them.
//
// The collect screen is the one an accountant lives in, and every visit starts
// here — a parent is at the desk, the cashier has a name or an admission number.
// It was previously an ad-hoc block inlined in the discount modal, which meant
// the only way to reach a student's fees at all was through a form about
// something else.
//
// Keyboard-first on purpose: arrow keys and Enter, because the person using this
// is typing while talking to someone, not reaching for a mouse.

export interface StudentLite {
  id: string;
  first_name: string;
  last_name: string;
  admission_number?: string | null;
  classes?: { name?: string } | null;
  sections?: { name?: string } | null;
}

export function studentLabel(s: StudentLite): string {
  const cls = [s.classes?.name, s.sections?.name].filter(Boolean).join("-");
  return `${s.first_name} ${s.last_name}${cls ? ` · ${cls}` : ""}`;
}

export function StudentSearch({
  value,
  onSelect,
  placeholder = "Search by name or admission number…",
  autoFocus,
  className,
}: {
  value: StudentLite | null;
  onSelect: (student: StudentLite | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [term, setTerm] = React.useState("");
  const [active, setActive] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  const boxRef = React.useRef<HTMLDivElement>(null);

  // Debounced so a fast typist fires one request, not one per keystroke.
  const [debounced, setDebounced] = React.useState("");
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(term), 200);
    return () => clearTimeout(t);
  }, [term]);

  const { data: results, isFetching } = useQuery({
    queryKey: ["student-search", debounced],
    queryFn: () => studentsApi.list({ search: debounced, limit: 8 }).then((r: any) => r.data as StudentLite[]),
    enabled: debounced.trim().length > 1,
  });

  const options = results ?? [];

  React.useEffect(() => setActive(0), [debounced]);

  // Close on outside click, so the list doesn't sit over the page after the user
  // has moved on.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const choose = (s: StudentLite) => {
    onSelect(s);
    setTerm("");
    setOpen(false);
  };

  if (value) {
    return (
      <div className={cn("flex items-center justify-between gap-2 rounded-xl bg-primary/10 px-4 py-2.5", className)}>
        <span className="min-w-0 truncate text-sm font-medium text-primary">{studentLabel(value)}</span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="shrink-0 text-primary/60 transition-colors hover:text-primary"
          aria-label="Clear selected student"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  const showList = open && debounced.trim().length > 1;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={term}
        onChange={e => { setTerm(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        className="pl-9"
        role="combobox"
        aria-expanded={showList}
        aria-autocomplete="list"
        onKeyDown={e => {
          if (!showList || !options.length) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(i => (i + 1) % options.length); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(i => (i - 1 + options.length) % options.length); }
          if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {isFetching && (
        <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      )}

      {showList && (
        <div
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-popover shadow-lg"
        >
          {!options.length ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              {isFetching ? "Searching…" : `No student matches "${debounced}"`}
            </p>
          ) : (
            options.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(s)}
                className={cn(
                  "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors",
                  i === active ? "bg-accent" : "hover:bg-accent/60",
                )}
              >
                <span className="min-w-0 truncate font-medium text-foreground">
                  {s.first_name} {s.last_name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {[s.classes?.name, s.sections?.name].filter(Boolean).join("-")}
                  {s.admission_number ? ` · ${s.admission_number}` : ""}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
