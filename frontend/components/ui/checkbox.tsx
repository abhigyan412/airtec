"use client";

import * as React from "react";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";

// A native checkbox styled to match the design system, rather than another Radix
// dependency: the billing screen renders one per class and per fee head, and a
// native input keeps the label/keyboard/form semantics for free.
//
// Indeterminate is a DOM property, not an attribute, so it can only be set
// imperatively — which is why the ref is merged rather than simply forwarded.

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate, checked, disabled, ...props }, ref) => {
    const inner = React.useRef<HTMLInputElement>(null);

    React.useImperativeHandle(ref, () => inner.current as HTMLInputElement);
    React.useEffect(() => {
      if (inner.current) inner.current.indeterminate = !!indeterminate && !checked;
    }, [indeterminate, checked]);

    return (
      <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center">
        <input
          ref={inner}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          className={cn(
            "peer h-4 w-4 cursor-pointer appearance-none rounded-[5px] border border-input bg-background transition-colors",
            "checked:border-primary checked:bg-primary indeterminate:border-primary indeterminate:bg-primary",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
          {...props}
        />
        <Check
          className="pointer-events-none absolute h-3 w-3 text-primary-foreground opacity-0 peer-checked:opacity-100"
          strokeWidth={3}
        />
        {indeterminate && !checked && (
          <Minus className="pointer-events-none absolute h-3 w-3 text-primary-foreground" strokeWidth={3} />
        )}
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";

/** Checkbox with a clickable label — the shape almost every caller wants. */
export function CheckboxField({
  label,
  hint,
  className,
  ...props
}: CheckboxProps & { label: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer select-none items-start gap-2.5 text-sm text-foreground",
        props.disabled && "cursor-not-allowed opacity-60",
        className,
      )}
    >
      <span className="mt-0.5">
        <Checkbox {...props} />
      </span>
      <span className="min-w-0">
        <span className="block leading-snug">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}
