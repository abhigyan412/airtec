"use client";

import * as React from "react";
import { Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Confirmation for actions that cannot be undone or that move money for hundreds
// of families at once — waiving an arrear, cancelling an invoice, generating a
// term's billing.
//
// `confirmText` exists for the ones where a plain "are you sure" is too easy to
// click through: the user has to type the word before the button enables. Used
// on waive, which permanently writes off a balance, and on billing runs of more
// than a hundred invoices.

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Require the user to type this exact string before confirming. */
  confirmText?: string;
  loading?: boolean;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open, onOpenChange, title, description, children,
  confirmLabel = "Confirm", cancelLabel = "Cancel",
  destructive, confirmText, loading, onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = React.useState("");

  // Reset between openings, or the previous confirmation carries over and the
  // next destructive action is one click away.
  React.useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const blocked = !!confirmText && typed.trim() !== confirmText;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {destructive && <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />}
            {title}
          </DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {children}

        {confirmText && (
          <div className="space-y-1.5">
            <label htmlFor="confirm-phrase" className="text-sm text-muted-foreground">
              Type <span className="font-semibold text-foreground">{confirmText}</span> to continue
            </label>
            <input
              id="confirm-phrase"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              autoComplete="off"
              className={cn(
                "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading || blocked}
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
