"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Star } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx, formatDate } from "@/lib/format";
import { useFiscalYears } from "@/lib/queries";
import { useSession } from "@/lib/session";
import type { FiscalYear } from "@/lib/types";
import { Drawer, ErrorBox, Field, PageHeader, SaveButton, Spinner, StatusBadge, useToast } from "@/components/ui";

type Form = {
  id: number | null;
  code: string;
  label: string;
  start_date: string;
  end_date: string;
  is_current: boolean;
  was_current?: boolean;
  status?: FiscalYear["status"];
};

export default function FiscalYearsPage() {
  const { me, can } = useSession();
  const canManage = can("fiscal_years.manage");
  const years = useFiscalYears();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  async function openNew() {
    setErrors({});
    try {
      const { data } = await api<{ data: Omit<Form, "id" | "is_current"> }>("/fiscal-years/proposal");
      setForm({ id: null, ...data, is_current: false });
    } catch (e) {
      toast.error(e);
    }
  }

  function openEdit(y: FiscalYear) {
    setErrors({});
    setForm({
      id: y.id,
      code: y.code,
      label: y.label,
      start_date: y.start_date,
      end_date: y.end_date,
      is_current: y.is_current,
      was_current: y.is_current,
      status: y.status,
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    setErrors({});
    const body = {
      code: form.code.trim(),
      label: form.label.trim(),
      start_date: form.start_date,
      end_date: form.end_date,
      is_current: form.is_current,
    };
    try {
      if (form.id) {
        await api(`/fiscal-years/${form.id}`, { method: "PUT", body });
        toast.success(`Fiscal year ${body.label} updated.`);
      } else {
        await api("/fiscal-years", { method: "POST", body });
        toast.success(`Fiscal year ${body.label} created.`);
      }
      await queryClient.invalidateQueries({ queryKey: ["fiscal-years"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      setForm(null);
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) setErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])));
      else toast.error(e);
    } finally {
      setBusy(false);
    }
  }

  async function makeCurrent(id: number) {
    try {
      await api(`/fiscal-years/${id}/make-current`, { method: "POST" });
      await queryClient.invalidateQueries({ queryKey: ["fiscal-years"] });
      queryClient.invalidateQueries({ queryKey: ["kpis"] });
      toast.success("Current fiscal year changed.");
    } catch (e) {
      toast.error(e);
    }
  }

  const isClosedEdit = Boolean(form?.id && form.status && form.status !== "open");

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="Fiscal Years"
        description="New years are proposed from the fiscal year start month and day in Configuration. Year-end close comes with the reports stage."
        actions={canManage ? <button className="btn btn-primary" onClick={openNew}><Plus size={16} /> New fiscal year</button> : undefined}
      />
      <div className="card overflow-x-auto">
        {years.isLoading ? <Spinner /> : years.error ? <div className="p-4"><ErrorBox error={years.error} /></div> : (
          <table className="table-base">
            <thead><tr><th>Code</th><th>Label</th><th>Start</th><th>End</th><th>Status</th><th>Current</th><th /></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {years.data!.map((y) => (
                <tr key={y.id}>
                  <td className="font-medium">{y.code}</td>
                  <td>{y.label}</td>
                  <td className="tabular">{formatDate(y.start_date, me.preferences)}</td>
                  <td className="tabular">{formatDate(y.end_date, me.preferences)}</td>
                  <td><StatusBadge status={y.status} /></td>
                  <td>{y.is_current && <span className="badge bg-brand-700 text-white"><Star size={11} className="mr-1" />Current</span>}</td>
                  <td className="text-right whitespace-nowrap">
                    {canManage && (
                      <div className="inline-flex items-center gap-1">
                        {!y.is_current && y.status === "open" && (
                          <button className="btn btn-ghost py-1" onClick={() => makeCurrent(y.id)}>Make current</button>
                        )}
                        <button className="btn btn-ghost py-1" onClick={() => openEdit(y)} aria-label={`Edit ${y.label}`}>
                          <Pencil size={14} /> Edit
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Drawer
        open={!!form}
        title={form?.id ? "Edit fiscal year" : "New fiscal year"}
        onClose={() => setForm(null)}
        size="sm"
        footer={<><button className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button><SaveButton busy={busy} onClick={save}>{form?.id ? "Save" : "Create"}</SaveButton></>}
      >
        {form && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Code" required error={errors.code} htmlFor="fy-code">
                <input id="fy-code" className={cx("input", errors.code && "input-error")} maxLength={10} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
              </Field>
              <Field label="Label" required error={errors.label} htmlFor="fy-label">
                <input id="fy-label" className={cx("input", errors.label && "input-error")} maxLength={20} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </Field>
              <Field label="Start date" required error={errors.start_date} htmlFor="fy-start">
                <input id="fy-start" type="date" disabled={isClosedEdit} className={cx("input", errors.start_date && "input-error", isClosedEdit && "bg-gray-50 text-gray-500")} value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} />
              </Field>
              <Field label="End date" required error={errors.end_date} htmlFor="fy-end">
                <input id="fy-end" type="date" disabled={isClosedEdit} className={cx("input", errors.end_date && "input-error", isClosedEdit && "bg-gray-50 text-gray-500")} value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} />
              </Field>
            </div>
            {isClosedEdit && <p className="text-xs text-gray-500">Closed fiscal years cannot have their start or end dates changed.</p>}
            {(!form.id || (!form.was_current && form.status === "open")) && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="h-4 w-4 accent-brand-700" checked={form.is_current} onChange={(e) => setForm({ ...form, is_current: e.target.checked })} /> Make this the current fiscal year
              </label>
            )}
            <button type="submit" className="hidden" />
          </form>
        )}
      </Drawer>
    </div>
  );
}
