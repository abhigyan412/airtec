import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Inline explanation attached to a form or a result — "12 students were skipped
// and here is why", "this role has no discount ceiling configured". Distinct from
// a toast: these are conditions the user needs to read while deciding, not
// confirmations of something already done.

const alertVariants = cva(
  "flex gap-3 rounded-xl border p-3.5 text-sm",
  {
    variants: {
      variant: {
        info: "border-border bg-muted/50 text-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

const ICONS = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  destructive: XCircle,
} as const;

// `title` is omitted from the DOM attributes: the native one is a string tooltip,
// and this takes a ReactNode heading.
export interface AlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">, VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  icon?: boolean;
}

export function Alert({ className, variant = "info", title, icon = true, children, ...props }: AlertProps) {
  const Icon = ICONS[variant ?? "info"];
  return (
    <div className={cn(alertVariants({ variant }), className)} role="status" {...props}>
      {icon && <Icon className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn("text-current/90", title && "mt-0.5")}>{children}</div>}
      </div>
    </div>
  );
}
