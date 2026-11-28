"use client";

import { X, Loader2, CheckCircle2, AlertCircle, ChevronDown } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/format";
import { ApiError } from "@/lib/api";

/* ---------- Field ---------- */
export function Field({
  label,
  required,
  error,
  hint,
  children,
  htmlFor,
}: {
  label: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-gray-700">
        {label}
        {required && <span className="ml-0.5 text-red-600" aria-hidden>*</span>}
        {required && <span className="sr-only"> (required)</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-gray-500">{hint}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------- Drawer ---------- */
export function Drawer({
  open,
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Escape closes the drawer. Kept apart from focus so a parent re-render never moves the cursor.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  // Put the cursor in the first field once, when the drawer opens.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      if (panel.current && !panel.current.contains(document.activeElement)) {
        panel.current.querySelector<HTMLElement>(".drawer-body input:not([disabled]):not([type=hidden]),.drawer-body select:not([disabled]),.drawer-body textarea")?.focus();
      }
    }, 50);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;
  const width = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-5xl" }[size];
  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <div ref={panel} className={cx("relative flex h-full w-full flex-col bg-white shadow-xl", width)}>
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button className="btn btn-ghost p-1.5" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="drawer-body flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Confirm dialog ---------- */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="alertdialog" aria-modal="true">
      <div className="absolute inset-0 bg-gray-900/30" onClick={onCancel} />
      <div className="relative w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <div className="mt-2 text-sm text-gray-600">{message}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button className={cx("btn", danger ? "btn-danger" : "btn-primary")} onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 size={16} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; kind: "success" | "error"; message: string };
const ToastContext = createContext<{ success: (m: string) => void; error: (m: string | unknown) => void }>({
  success: () => {},
  error: () => {},
});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 7000 : 3500);
  }, []);
  const value = {
    success: (m: string) => push("success", m),
    error: (m: string | unknown) => push("error", typeof m === "string" ? m : errorMessage(m)),
  };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2.5 text-sm shadow-md",
              t.kind === "success" ? "border-brand-100 bg-white text-gray-800" : "border-red-200 bg-red-50 text-red-800",
            )}
          >
            {t.kind === "success" ? (
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-brand-700" />
            ) : (
              <AlertCircle size={18} className="mt-0.5 shrink-0 text-red-600" />
            )}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const first = Object.values(error.errors)[0]?.[0];
    return first ?? error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong.";
}

/* ---------- Misc ---------- */
export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-gray-500" role="status">
      <Loader2 size={18} className="animate-spin text-brand-700" />
      {label}...
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-gray-600">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const active = status === "active" || status === "open";
  return (
    <span className={cx("badge", active ? "bg-brand-50 text-brand-800" : "bg-gray-100 text-gray-600")}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return (
    <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
      {errorMessage(error)}
    </div>
  );
}

export function SaveButton({ busy, children = "Save", ...props }: { busy?: boolean; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className="btn btn-primary" disabled={busy || props.disabled} {...props}>
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  );
}

/* ---------- MultiSelectDropdown ---------- */
export function MultiSelectDropdown<T extends { id: number | string; name: string }>({
  options,
  value,
  onChange,
  placeholder = "Select...",
  allLabel = "All selected",
  disabled,
  invalid,
  id,
  className,
}: {
  options: T[];
  value: Array<number | string>;
  onChange: (next: Array<number | string>) => void;
  placeholder?: string;
  allLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selectedSet = useMemo(() => new Set(value.map(String)), [value]);
  const selectedNames = useMemo(
    () => options.filter((o) => selectedSet.has(String(o.id))).map((o) => o.name),
    [options, selectedSet],
  );

  const summary =
    selectedNames.length === 0
      ? placeholder
      : options.length > 1 && selectedNames.length === options.length
      ? `${allLabel} (${selectedNames.length})`
      : selectedNames.length <= 2
      ? selectedNames.join(", ")
      : `${selectedNames.slice(0, 2).join(", ")} +${selectedNames.length - 2}`;

  const toggle = (itemId: number | string) => {
    const key = String(itemId);
    if (selectedSet.has(key)) {
      onChange(value.filter((v) => String(v) !== key));
    } else {
      onChange([...value, itemId]);
    }
  };

  return (
    <div ref={wrapRef} className={cx("relative", className)}>
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cx(
          "input flex items-center justify-between gap-2 text-left",
          invalid && "input-error",
          disabled && "cursor-not-allowed opacity-70",
        )}
      >
        <span className={cx("truncate", selectedNames.length === 0 && "text-gray-400")}>{summary}</span>
        <ChevronDown size={15} className={cx("shrink-0 text-gray-400 transition-transform", open && "rotate-180")} />
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 right-0 z-30 mt-1 max-h-56 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 shadow-lg"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">No options available</div>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-gray-100 px-2.5 py-1 text-[11px] text-gray-500">
                <button
                  type="button"
                  className="font-medium text-brand-700 hover:underline"
                  onClick={() => onChange(options.map((o) => o.id))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-gray-500 hover:underline"
                  onClick={() => onChange([])}
                >
                  Clear
                </button>
              </div>
              {options.map((o) => {
                const checked = selectedSet.has(String(o.id));
                return (
                  <label
                    key={String(o.id)}
                    className={cx(
                      "flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50",
                      checked && "bg-brand-50/50 font-medium text-brand-900",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-brand-700 accent-brand-700"
                      checked={checked}
                      onChange={() => toggle(o.id)}
                    />
                    <span className="truncate">{o.name}</span>
                  </label>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
}
