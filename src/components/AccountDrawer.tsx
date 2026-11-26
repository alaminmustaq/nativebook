"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { cx } from "@/lib/format";
import { useOffices } from "@/lib/queries";
import { useSession } from "@/lib/session";
import type { Account } from "@/lib/types";
import { ConfirmDialog, Drawer, Field, MultiSelectDropdown, SaveButton, Spinner, useToast } from "./ui";

export type AccountDrawerMode = { kind: "create"; parentId?: number | null } | { kind: "edit"; id: number };

type Form = {
  parent_id: number | "";
  office_ids: number[];
  code: string;
  title: string;
  gl_id: string;
  old_code: string;
  is_posting: boolean;
  normal_side: "D" | "C" | "";
  economic_code: string;
  status: "active" | "inactive";
};

type ExistingChildDraft = {
  id: number;
  depth: number;
  code: string;
  level: number;
  hasChildren: boolean;
  officeName: string | null;
  title: string;
  origTitle: string;
  gl_id: string;
  origGlId: string;
  is_posting: boolean;
  origIsPosting: boolean;
  normal_side: "D" | "C";
  origNormalSide: "D" | "C";
  old_code: string;
  origOldCode: string;
  status: "active" | "inactive";
};

type ChildDraft = {
  key: string;
  title: string;
  gl_id: string;
  glIdManual: boolean;
  is_posting: boolean;
  normal_side: "D" | "C" | "";
  old_code: string;
  economic_code: string;
};

const EMPTY: Form = {
  parent_id: "",
  office_ids: [],
  code: "",
  title: "",
  gl_id: "",
  old_code: "",
  is_posting: true,
  normal_side: "",
  economic_code: "",
  status: "active",
};

const CODE_WIDTHS = [1, 1, 2, 3, 4];
const CODE_FIRST: Record<number, number> = { 1: 1, 2: 10, 3: 101, 4: 1000 };

let draftSeq = 1;
function makeDraft(normalSide: "D" | "C" | "" = "", glId = "", isPosting = true): ChildDraft {
  return {
    key: `row-${draftSeq++}`,
    title: "",
    gl_id: glId,
    glIdManual: false,
    is_posting: isPosting,
    normal_side: normalSide,
    old_code: "",
    economic_code: "",
  };
}

function isDraftEmpty(d: ChildDraft): boolean {
  return !d.title.trim() && !d.old_code.trim() && !d.economic_code.trim();
}

function isExistingRowDirty(r: ExistingChildDraft): boolean {
  return (
    r.title.trim() !== r.origTitle ||
    r.gl_id.trim() !== r.origGlId ||
    r.is_posting !== r.origIsPosting ||
    r.normal_side !== r.origNormalSide ||
    r.old_code.trim() !== r.origOldCode
  );
}

function previewChildCodes(parentCode: string, parentLevel: number, existingChildCodes: string[], count: number): string[] {
  if (!parentCode || parentLevel >= 5 || count <= 0) return Array(Math.max(0, count)).fill("");
  const baseSegments = parentCode.split("-").map((s) => Number.parseInt(s, 10));
  if (baseSegments.length !== 5 || baseSegments.some((n) => Number.isNaN(n))) {
    return Array(count).fill("");
  }
  const index = parentLevel;
  const firstVal = CODE_FIRST[index] ?? 1;
  const maxVal = 10 ** CODE_WIDTHS[index] - 1;
  let highest = 0;
  for (const code of existingChildCodes) {
    const segs = code.split("-").map((s) => Number.parseInt(s, 10));
    if (segs.length === 5 && !Number.isNaN(segs[index])) {
      highest = Math.max(highest, segs[index]);
    }
  }
  const start = Math.max(highest + 1, firstVal);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const val = start + i;
    if (val > maxVal) {
      out.push("");
    } else {
      const segs = [...baseSegments];
      segs[index] = val;
      out.push(segs.map((v, idx) => String(v).padStart(CODE_WIDTHS[idx], "0")).join("-"));
    }
  }
  return out;
}

function nextUnusedGlIds(
  startStr: string,
  accounts: Account[],
  count: number,
  extraUsed: Iterable<string> = [],
): string[] {
  if (count <= 0) return [];
  const used = new Set<string>();
  for (const a of accounts) {
    if (a.gl_id) used.add(a.gl_id.trim());
  }
  for (const g of extraUsed) {
    if (g.trim()) used.add(g.trim());
  }
  let candidate = Number.parseInt(startStr, 10);
  if (!Number.isFinite(candidate) || candidate <= 0) candidate = 1001;

  const out: string[] = [];
  while (out.length < count) {
    const s = String(candidate);
    if (!used.has(s)) {
      out.push(s);
      used.add(s);
    }
    candidate++;
  }
  return out;
}

export function AccountDrawer({
  mode,
  accounts,
  onClose,
  onExpandIds,
}: {
  mode: AccountDrawerMode | null;
  accounts: Account[];
  onClose: () => void;
  onExpandIds?: (ids: number[]) => void;
}) {
  const { me, can } = useSession();
  const officesQuery = useOffices();
  const offices = useMemo(() => {
    if (officesQuery.data && officesQuery.data.length > 0) {
      return officesQuery.data;
    }
    return me.offices;
  }, [officesQuery.data, me.offices]);

  // Head office is the default base office; do not show Head Office in branch selection
  const branchOffices = useMemo(() => offices.filter((o) => !o.is_head_office), [offices]);

  const toast = useToast();
  const queryClient = useQueryClient();
  const canCreate = can("accounts.create");
  const canEdit = can("accounts.edit");
  const canDeactivate = can("accounts.deactivate");
  const canDeletePerm = can("accounts.delete");

  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [existingRows, setExistingRows] = useState<ExistingChildDraft[]>([]);
  const [childDrafts, setChildDrafts] = useState<ChildDraft[]>([]);
  const [childErrors, setChildErrors] = useState<Record<string, string>>({});
  const [baseNextGlId, setBaseNextGlId] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteChildTarget, setDeleteChildTarget] = useState<ExistingChildDraft | null>(null);
  const [deleteChildBusy, setDeleteChildBusy] = useState(false);

  const editId = mode?.kind === "edit" ? mode.id : null;
  const modeKey = mode ? (mode.kind === "create" ? `create:${mode.parentId ?? ""}` : `edit:${mode.id}`) : "";
  const prevModeKeyRef = useRef<string>("");

  const detail = useQuery({
    queryKey: ["account", editId],
    queryFn: () =>
      api<{
        data: Account & {
          parent: { id: number; code: string; title: string } | null;
          has_children: boolean;
          has_activity: boolean;
        };
      }>(`/accounts/${editId}`),
    enabled: editId !== null,
  });

  const controls = useMemo(
    () => accounts.filter((a) => !a.is_posting && a.status === "active" && a.level < 5).sort((a, b) => a.code.localeCompare(b.code)),
    [accounts],
  );

  const parentAccount = useMemo(() => {
    if (!form.parent_id) return null;
    return accounts.find((a) => a.id === form.parent_id) ?? null;
  }, [form.parent_id, accounts]);

  const directChildren = useMemo(() => {
    if (editId === null) return [];
    return accounts.filter((a) => a.parent_id === editId).sort((a, b) => a.code.localeCompare(b.code));
  }, [editId, accounts]);

  // All descendants under the selected parent in hierarchical tree order
  const allDescendants = useMemo(() => {
    if (editId === null) return [];
    const byParent = new Map<number, Account[]>();
    for (const a of accounts) {
      if (a.parent_id !== null) {
        const list = byParent.get(a.parent_id) ?? [];
        list.push(a);
        byParent.set(a.parent_id, list);
      }
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.code.localeCompare(b.code));
    }
    const result: { account: Account; depth: number }[] = [];
    const visited = new Set<number>();
    const visit = (parentId: number, depth: number) => {
      const children = byParent.get(parentId) ?? [];
      for (const child of children) {
        if (visited.has(child.id)) continue;
        visited.add(child.id);
        result.push({ account: child, depth });
        visit(child.id, depth + 1);
      }
    };
    visit(editId, 0);
    return result;
  }, [editId, accounts]);

  const parentHasOffice = Boolean(mode?.kind === "create" && parentAccount?.office_id && !parentAccount?.office?.is_head_office);

  const creating = mode?.kind === "create";
  const account = detail.data?.data;
  const targetParentLevel = creating ? (parentAccount ? parentAccount.level + 1 : 99) : account?.level ?? 5;
  const targetParentCode = creating ? form.code : account?.code ?? form.code;
  const existingChildCodes = useMemo(() => (creating ? [] : directChildren.map((c) => c.code)), [creating, directChildren]);
  const codePreviews = useMemo(
    () => previewChildCodes(targetParentCode, targetParentLevel, existingChildCodes, childDrafts.length),
    [targetParentCode, targetParentLevel, existingChildCodes, childDrafts.length],
  );

  // Sync all descendant children into editable rows (preserving unsaved edits for the same parent)
  useEffect(() => {
    if (mode?.kind !== "edit") {
      setExistingRows([]);
      return;
    }
    const parentIdsSet = new Set(accounts.filter((a) => a.parent_id !== null).map((a) => a.parent_id!));
    const isSameParent = prevModeKeyRef.current === modeKey;
    setExistingRows((prev) => {
      const prevById = isSameParent ? new Map(prev.map((r) => [r.id, r])) : new Map<number, ExistingChildDraft>();
      return allDescendants.map(({ account: c, depth }) => {
        const prevRow = prevById.get(c.id);
        const keepEdited = prevRow && isExistingRowDirty(prevRow);
        return {
          id: c.id,
          depth,
          code: c.code,
          level: c.level,
          hasChildren: parentIdsSet.has(c.id),
          officeName: c.office && !c.office.is_head_office ? c.office.name : null,
          title: keepEdited ? prevRow.title : c.title,
          origTitle: c.title,
          gl_id: keepEdited ? prevRow.gl_id : c.gl_id ?? "",
          origGlId: c.gl_id ?? "",
          is_posting: keepEdited ? prevRow.is_posting : c.is_posting,
          origIsPosting: c.is_posting,
          normal_side: keepEdited ? prevRow.normal_side : c.normal_side,
          origNormalSide: c.normal_side,
          old_code: keepEdited ? prevRow.old_code : c.old_code ?? "",
          origOldCode: c.old_code ?? "",
          status: c.status,
        };
      });
    });
  }, [mode?.kind, modeKey, allDescendants, accounts]);

  // Reset form and child drafts only when mode/account changes (not on background accounts refetch)
  useEffect(() => {
    if (!mode) {
      prevModeKeyRef.current = "";
      return;
    }
    if (prevModeKeyRef.current === modeKey) return;
    prevModeKeyRef.current = modeKey;

    setErrors({});
    setChildErrors({});
    setBaseNextGlId("");
    setChildDrafts([]);

    if (mode.kind === "create") {
      const p = mode.parentId ? accounts.find((a) => a.id === mode.parentId) : undefined;
      const headOfficeIds = new Set(offices.filter((o) => o.is_head_office).map((o) => o.id));
      const defaultOfficeIds = (p?.office_id ? [p.office_id] : me.office_id ? [me.office_id] : []).filter((id) => !headOfficeIds.has(id));
      setForm({ ...EMPTY, parent_id: mode.parentId ?? "", office_ids: defaultOfficeIds });
    }
  }, [mode, modeKey, me.office_id, accounts, offices]);

  // When control account changes, pre-fill parent's branch if none selected yet
  useEffect(() => {
    if (mode?.kind === "create" && form.parent_id) {
      const p = accounts.find((a) => a.id === form.parent_id);
      const isHeadOffice = p?.office?.is_head_office;
      if (p?.office_id && !isHeadOffice && !form.office_ids.length) {
        setForm((f) => ({ ...f, office_ids: [p.office_id!] }));
      }
    }
  }, [form.parent_id, mode, accounts]);

  // Hydrate edit form from account detail
  useEffect(() => {
    const a = detail.data?.data;
    if (a && mode?.kind === "edit") {
      const headOfficeIds = new Set(offices.filter((o) => o.is_head_office).map((o) => o.id));
      const officeIdsFromData = (a as unknown as { office_ids?: number[] }).office_ids;
      const rawOfficeIds = officeIdsFromData && officeIdsFromData.length > 0 ? officeIdsFromData : a.office_id ? [a.office_id] : [];
      const initialOfficeIds = rawOfficeIds.filter((id) => !headOfficeIds.has(id));
      setForm({
        parent_id: a.parent_id ?? "",
        office_ids: initialOfficeIds,
        code: a.code,
        title: a.title,
        gl_id: a.gl_id ?? "",
        old_code: a.old_code ?? "",
        is_posting: a.is_posting,
        normal_side: a.normal_side,
        economic_code: a.economic_code ?? "",
        status: a.status,
      });
    }
  }, [detail.data, mode, offices]);

  // Fetch next code & next GL ID preview for create mode (when parent changes) or edit mode (for new child drafts)
  useEffect(() => {
    const queryParentId = mode?.kind === "create" ? form.parent_id : mode?.kind === "edit" ? mode.id : null;
    if (!queryParentId) {
      if (mode?.kind === "create") {
        setForm((f) => ({ ...f, code: "", gl_id: "" }));
        setBaseNextGlId("");
      }
      return;
    }

    if (mode?.kind === "edit") {
      const target = accounts.find((a) => a.id === mode.id);
      if (target && (target.is_posting || target.level >= 5)) {
        return;
      }
    }

    let cancelled = false;
    api<{ code: string; normal_side: "D" | "C"; gl_id?: string }>("/accounts/next-code", { query: { parent_id: queryParentId } })
      .then((r) => {
        if (cancelled) return;
        if (mode?.kind === "create") {
          setForm((f) => ({
            ...f,
            code: r.code,
            normal_side: r.normal_side,
            gl_id: f.gl_id ? f.gl_id : r.gl_id ?? "",
          }));
        }
        if (r.gl_id) {
          setBaseNextGlId(r.gl_id);
        }
      })
      .catch((e) => {
        if (!cancelled && mode?.kind === "create") {
          setErrors((x) => ({
            ...x,
            parent_id: e instanceof ApiError ? e.field("parent_id") ?? e.message : "Could not get a code.",
          }));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [form.parent_id, mode, accounts]);

  // Auto-fill sequential unused GL IDs on non-manual child draft rows
  useEffect(() => {
    if (!mode) return;
    const isCreatingMode = mode.kind === "create";
    const startFrom =
      baseNextGlId ||
      (isCreatingMode
        ? String((parentAccount?.class ?? 1) * 1000 + 1)
        : String(((detail.data?.data?.class ?? accounts.find((a) => a.id === mode.id)?.class) ?? 1) * 1000 + 1));

    setChildDrafts((prev) => {
      const autoCount = prev.filter((d) => !d.glIdManual).length;
      if (autoCount === 0) return prev;
      const reserved: string[] = [];
      if (isCreatingMode && form.gl_id.trim()) reserved.push(form.gl_id.trim());
      for (const r of existingRows) {
        if (r.gl_id.trim()) reserved.push(r.gl_id.trim());
      }
      for (const d of prev) {
        if (d.glIdManual && d.gl_id.trim()) reserved.push(d.gl_id.trim());
      }
      const generated = nextUnusedGlIds(startFrom, accounts, autoCount, reserved);
      let gIdx = 0;
      let changed = false;
      const next = prev.map((d) => {
        if (d.glIdManual) return d;
        const nextGl = generated[gIdx++] ?? "";
        if (d.gl_id !== nextGl) changed = true;
        return { ...d, gl_id: nextGl };
      });
      return changed ? next : prev;
    });
  }, [baseNextGlId, form.gl_id, existingRows, accounts, mode, parentAccount, detail.data?.data?.class]);

  if (!mode) return null;

  const readOnly = creating ? !canCreate : !canEdit;
  const canSaveDrawer = creating ? canCreate : canEdit || canDeactivate;
  const postingLocked = !creating && (account?.has_children || account?.has_activity);

  const canHaveChildren = targetParentLevel < 5;
  const childMustAllowPosting = targetParentLevel + 1 >= 5;
  const showChildrenTable = !form.is_posting && canHaveChildren && (creating ? canCreate && Boolean(form.parent_id) : Boolean(account));
  const canAddNewChildren = canCreate && (creating || account?.status === "active");

  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));

  const updateExistingRow = (id: number, patch: Partial<ExistingChildDraft>) => {
    setExistingRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const updateDraft = (key: string, patch: Partial<ChildDraft>) => {
    setChildDrafts((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addDraftRows = (count: number) => {
    const side = form.normal_side || account?.normal_side || "";
    const startFrom = baseNextGlId || String((parentAccount?.class ?? account?.class ?? 1) * 1000 + 1);
    const reserved: string[] = [];
    if (creating && form.gl_id.trim()) reserved.push(form.gl_id.trim());
    for (const r of existingRows) {
      if (r.gl_id.trim()) reserved.push(r.gl_id.trim());
    }
    for (const d of childDrafts) {
      if (d.gl_id.trim()) reserved.push(d.gl_id.trim());
    }
    const ids = nextUnusedGlIds(startFrom, accounts, count, reserved);
    setChildDrafts((rows) => [...rows, ...ids.map((glId) => makeDraft(side, glId, true))]);
  };

  const removeDraftRow = (key: string) => {
    setChildDrafts((rows) => rows.filter((r) => r.key !== key));
    setChildErrors({});
  };

  function validateTableRows(): {
    dirtyExisting: ExistingChildDraft[];
    validNewRows: ChildDraft[];
    rowErrors: Record<string, string>;
  } {
    const rowErrors: Record<string, string> = {};
    const dirtyExisting = existingRows.filter(isExistingRowDirty);
    const seenNewGl = new Set<string>();

    if (creating && form.gl_id.trim()) {
      seenNewGl.add(form.gl_id.trim());
    }
    for (const r of existingRows) {
      if (r.gl_id.trim()) {
        seenNewGl.add(r.gl_id.trim());
      }
    }

    for (const r of dirtyExisting) {
      if (!r.title.trim()) {
        rowErrors[`existing.${r.id}.title`] = "Title is required.";
      }
      if (r.gl_id.trim() && !/^\d+$/.test(r.gl_id.trim())) {
        rowErrors[`existing.${r.id}.gl_id`] = "Digits only.";
      }
    }

    const validNewRows: ChildDraft[] = [];
    childDrafts.forEach((d, idx) => {
      if (isDraftEmpty(d)) return;
      if (!d.title.trim()) {
        rowErrors[`children.${idx}.title`] = "Title is required.";
      }
      if (d.gl_id.trim()) {
        if (!/^\d+$/.test(d.gl_id.trim())) {
          rowErrors[`children.${idx}.gl_id`] = "Digits only.";
        } else if (seenNewGl.has(d.gl_id.trim())) {
          rowErrors[`children.${idx}.gl_id`] = "Duplicate GL ID.";
        } else {
          seenNewGl.add(d.gl_id.trim());
        }
      }
      if (childMustAllowPosting && !d.is_posting) {
        rowErrors[`children.${idx}.is_posting`] = "Level 5 must allow posting.";
      }
      validNewRows.push(d);
    });

    return { dirtyExisting, validNewRows, rowErrors };
  }

  async function saveDirtyExistingChildren(dirtyExisting: ExistingChildDraft[]): Promise<number> {
    let savedCount = 0;
    for (const r of dirtyExisting) {
      try {
        const body: Record<string, unknown> = {
          title: r.title.trim(),
          gl_id: r.gl_id.trim() || null,
          old_code: r.old_code.trim() || null,
          normal_side: r.normal_side,
        };
        if (r.is_posting !== r.origIsPosting) {
          body.is_posting = r.is_posting;
        }
        await api(`/accounts/${r.id}`, { method: "PUT", body });
        savedCount++;
      } catch (e) {
        if (e instanceof ApiError && Object.keys(e.errors).length) {
          const nextErr: Record<string, string> = {};
          for (const [k, v] of Object.entries(e.errors)) {
            nextErr[`existing.${r.id}.${k}`] = v[0];
          }
          setChildErrors((prev) => ({ ...prev, ...nextErr }));
          throw new Error(Object.values(e.errors)[0]?.[0] ?? e.message);
        }
        throw e;
      }
    }
    return savedCount;
  }

  async function saveChildrenBatch() {
    if (creating || !account || (!canEdit && !canCreate)) return;
    const { dirtyExisting, validNewRows, rowErrors } = validateTableRows();
    setChildErrors(rowErrors);
    if (Object.keys(rowErrors).length > 0) return;

    if (dirtyExisting.length === 0 && validNewRows.length === 0) {
      toast.error("Edit a child or add a new child row first.");
      return;
    }

    setBulkBusy(true);
    try {
      const updatedCount = dirtyExisting.length > 0 ? await saveDirtyExistingChildren(dirtyExisting) : 0;
      let createdCount = 0;

      if (validNewRows.length > 0 && canAddNewChildren) {
        const res = await api<{ data: { children: Account[] } }>("/accounts/bulk", {
          method: "POST",
          body: {
            parent_id: account.id,
            children: validNewRows.map((d) => ({
              title: d.title.trim(),
              gl_id: d.gl_id.trim() || null,
              old_code: d.old_code.trim() || null,
              economic_code: d.economic_code.trim() || null,
              is_posting: childMustAllowPosting ? true : d.is_posting,
              normal_side: d.normal_side || form.normal_side || account.normal_side,
              status: "active",
              office_ids: form.office_ids,
            })),
          },
        });
        createdCount = res.data.children.length;
        onExpandIds?.([account.id]);
      }

      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["account"] });

      if (createdCount > 0) {
        setChildDrafts([]);
      }

      const parts: string[] = [];
      if (updatedCount > 0) parts.push(`updated ${updatedCount} child${updatedCount === 1 ? "" : "ren"}`);
      if (createdCount > 0) parts.push(`added ${createdCount} child${createdCount === 1 ? "" : "ren"}`);
      toast.success(parts.length ? `${parts.join(" and ").replace(/^./, (c) => c.toUpperCase())}.` : "Saved.");
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) {
        setChildErrors(Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]])));
        toast.error(Object.values(e.errors)[0]?.[0] ?? e.message);
      } else {
        toast.error(e);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function save() {
    const local: Record<string, string> = {};
    if (creating && !form.parent_id) local.parent_id = "Choose a control account.";
    if (!form.title.trim()) local.title = "Title must have some value.";

    let dirtyExisting: ExistingChildDraft[] = [];
    let validNewRows: ChildDraft[] = [];
    if (showChildrenTable) {
      const tableCheck = validateTableRows();
      dirtyExisting = tableCheck.dirtyExisting;
      validNewRows = tableCheck.validNewRows;
      setChildErrors(tableCheck.rowErrors);
      if (Object.keys(tableCheck.rowErrors).length > 0) {
        setErrors(local);
        return;
      }
    }

    setErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      if (creating) {
        if (!form.is_posting && validNewRows.length > 0) {
          const res = await api<{ data: { group: Account | null; children: Account[] } }>("/accounts/bulk", {
            method: "POST",
            body: {
              parent_id: form.parent_id,
              group: {
                title: form.title.trim(),
                gl_id: form.gl_id.trim() || null,
                old_code: form.old_code.trim() || null,
                normal_side: form.normal_side || undefined,
                economic_code: form.economic_code.trim() || null,
                status: form.status,
                office_ids: form.office_ids,
              },
              children: validNewRows.map((d) => ({
                title: d.title.trim(),
                gl_id: d.gl_id.trim() || null,
                old_code: d.old_code.trim() || null,
                economic_code: d.economic_code.trim() || null,
                is_posting: childMustAllowPosting ? true : d.is_posting,
                normal_side: d.normal_side || form.normal_side || undefined,
                status: "active",
                office_ids: form.office_ids,
              })),
            },
          });
          const expandList = [Number(form.parent_id)];
          if (res.data.group?.id) expandList.push(res.data.group.id);
          onExpandIds?.(expandList);
          await queryClient.invalidateQueries({ queryKey: ["accounts"] });
          await queryClient.invalidateQueries({ queryKey: ["account"] });
          toast.success(`Group account created with ${res.data.children.length} child${res.data.children.length === 1 ? "" : "ren"}.`);
          onClose();
          return;
        }

        const body = {
          title: form.title.trim(),
          gl_id: form.gl_id.trim() || null,
          old_code: form.old_code.trim() || null,
          is_posting: form.is_posting,
          normal_side: form.normal_side || undefined,
          economic_code: form.economic_code.trim() || null,
          status: form.status,
          office_ids: form.office_ids,
          office_id: form.office_ids[0] ?? null,
          parent_id: form.parent_id,
        };
        await api("/accounts", { method: "POST", body });
        onExpandIds?.([Number(form.parent_id)]);
        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        await queryClient.invalidateQueries({ queryKey: ["account"] });
        toast.success("Account created.");
        onClose();
      } else if (mode?.kind === "edit") {
        const body = canEdit
          ? {
              title: form.title.trim(),
              gl_id: form.gl_id.trim() || null,
              old_code: form.old_code.trim() || null,
              is_posting: form.is_posting,
              normal_side: form.normal_side || undefined,
              economic_code: form.economic_code.trim() || null,
              ...(canDeactivate ? { status: form.status } : {}),
              office_ids: form.office_ids,
              office_id: form.office_ids[0] ?? null,
            }
          : { status: form.status };
        await api(`/accounts/${mode.id}`, { method: "PUT", body });

        let updatedCount = 0;
        let createdCount = 0;
        if (dirtyExisting.length > 0) {
          updatedCount = await saveDirtyExistingChildren(dirtyExisting);
        }
        if (showChildrenTable && canAddNewChildren && validNewRows.length > 0) {
          const res = await api<{ data: { children: Account[] } }>("/accounts/bulk", {
            method: "POST",
            body: {
              parent_id: mode.id,
              children: validNewRows.map((d) => ({
                title: d.title.trim(),
                gl_id: d.gl_id.trim() || null,
                old_code: d.old_code.trim() || null,
                economic_code: d.economic_code.trim() || null,
                is_posting: childMustAllowPosting ? true : d.is_posting,
                normal_side: d.normal_side || form.normal_side || account?.normal_side,
                status: "active",
                office_ids: form.office_ids,
              })),
            },
          });
          createdCount = res.data.children.length;
          onExpandIds?.([mode.id]);
        }

        await queryClient.invalidateQueries({ queryKey: ["accounts"] });
        await queryClient.invalidateQueries({ queryKey: ["account"] });

        const parts = ["Account saved"];
        if (updatedCount > 0) parts.push(`${updatedCount} child${updatedCount === 1 ? "" : "ren"} updated`);
        if (createdCount > 0) parts.push(`${createdCount} child${createdCount === 1 ? "" : "ren"} added`);
        toast.success(`${parts.join(", ")}.`);
        onClose();
      }
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.errors).length) {
        const mapped = Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0]]));
        setErrors(mapped);
        setChildErrors(mapped);
      } else {
        toast.error(e);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (mode?.kind !== "edit") return;
    setBusy(true);
    try {
      await api(`/accounts/${mode.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Account deleted.");
      setConfirmDelete(false);
      onClose();
    } catch (e) {
      toast.error(e);
      setConfirmDelete(false);
    } finally {
      setBusy(false);
    }
  }

  async function confirmRemoveChild() {
    if (!deleteChildTarget) return;
    setDeleteChildBusy(true);
    try {
      await api(`/accounts/${deleteChildTarget.id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey: ["accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["account"] });
      toast.success(`Deleted "${deleteChildTarget.title}".`);
      setDeleteChildTarget(null);
    } catch (e) {
      toast.error(e);
      setDeleteChildTarget(null);
    } finally {
      setDeleteChildBusy(false);
    }
  }

  const isBranchOfficeAccount = Boolean(account?.office && account.office.is_head_office === false);
  const isHeadOfficeUser = Boolean(
    me.user.is_super_admin ||
      me.roles.includes("Org Admin") ||
      me.offices.some((o) => o.is_head_office && (o.id === me.office_id || !me.office_id)),
  );

  const canDelete =
    !creating &&
    canDeletePerm &&
    account &&
    !account.has_activity &&
    account.level > 1 &&
    (isBranchOfficeAccount ? isHeadOfficeUser : !account.has_children);

  const dirtyExistingCount = existingRows.filter(isExistingRowDirty).length;
  const filledDraftCount = childDrafts.filter((d) => !isDraftEmpty(d)).length;
  const totalPendingChanges = dirtyExistingCount + filledDraftCount;

  return (
    <Drawer
      open={!!mode}
      size={showChildrenTable ? "xl" : "md"}
      title={creating ? "New GL account" : account ? `${account.title} (${account.code})` : "Account"}
      onClose={onClose}
      footer={
        <>
          {canDelete && (
            <button className="btn btn-danger mr-auto" type="button" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={onClose}>
            {canSaveDrawer ? "Cancel" : "Close"}
          </button>
          {canSaveDrawer && <SaveButton busy={busy} onClick={save} />}
        </>
      }
    >
      {!creating && detail.isLoading ? (
        <Spinner />
      ) : (
        <div className="space-y-6">
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <Field label="Organization unit">
              <p className="py-2 text-sm text-gray-800">{me.organization?.name}</p>
            </Field>
            <Field
              label="Branches"
              error={errors.office_ids}
              htmlFor="office_ids"
              hint={
                account?.has_children || !form.is_posting
                  ? "Header account: selected branches are assigned to child accounts only (parent remains unassigned)"
                  : parentHasOffice
                  ? `Control account belongs to ${parentAccount?.office?.name ?? "a branch"}`
                  : undefined
              }
            >
              <MultiSelectDropdown
                id="office_ids"
                options={branchOffices}
                value={form.office_ids}
                disabled={readOnly}
                invalid={!!errors.office_ids}
                placeholder={branchOffices.length ? "Select branches" : "No branch offices"}
                allLabel="All branches"
                onChange={(selected) => {
                  setErrors((x) => ({ ...x, office_ids: "" }));
                  setForm((f) => ({ ...f, office_ids: selected as number[] }));
                }}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Control A/C" required={creating} error={errors.parent_id} htmlFor="parent_id">
                {creating ? (
                  <select
                    id="parent_id"
                    className={`input ${errors.parent_id ? "input-error" : ""}`}
                    value={form.parent_id}
                    onChange={(e) => {
                      setErrors((x) => ({ ...x, parent_id: "" }));
                      set("parent_id", e.target.value ? Number(e.target.value) : "");
                    }}
                  >
                    <option value="">Select a control account</option>
                    {controls.map((c) => (
                      <option key={c.id} value={c.id}>
                        {"\u00a0\u00a0".repeat(c.level - 1)}
                        {c.title} {c.office && !c.office.is_head_office ? `[${c.office.name}] ` : ""}({c.code})
                      </option>
                    ))}
                  </select>
                ) : (
                  <p className="py-2 text-sm text-gray-800">
                    {account?.parent
                      ? `${account.parent.title} ${
                          (account.parent as unknown as { office?: { name: string; is_head_office?: boolean } })?.office &&
                          !(account.parent as unknown as { office?: { is_head_office?: boolean } })?.office?.is_head_office
                            ? `[${(account.parent as unknown as { office: { name: string } }).office.name}] `
                            : ""
                        }(${account.parent.code})`
                      : "None (class account)"}
                  </p>
                )}
              </Field>
            </div>
            <Field label="GL A/C No" hint={creating ? "Generated from the control account" : undefined}>
              <input className="input tabular" value={form.code} disabled readOnly placeholder={creating ? "Choose a control account" : ""} />
            </Field>
            <Field label="GL ID" error={errors.gl_id} htmlFor="gl_id" hint="Short numeric code (auto serial if blank)">
              <input
                id="gl_id"
                className={`input ${errors.gl_id ? "input-error" : ""}`}
                maxLength={20}
                inputMode="numeric"
                value={form.gl_id}
                disabled={readOnly}
                onChange={(e) => set("gl_id", e.target.value)}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Title" required error={errors.title} htmlFor="title">
                <input
                  id="title"
                  className={`input ${errors.title ? "input-error" : ""}`}
                  maxLength={200}
                  value={form.title}
                  disabled={readOnly}
                  onChange={(e) => set("title", e.target.value)}
                />
              </Field>
            </div>
            <Field
              label="Posting allowed"
              required
              error={errors.is_posting}
              htmlFor="is_posting"
              hint={postingLocked ? "Locked: the account has child accounts or balances" : "Yes = accepts entries; No = groups other accounts"}
            >
              <select
                id="is_posting"
                className="input"
                value={form.is_posting ? "1" : "0"}
                disabled={readOnly || !!postingLocked}
                onChange={(e) => set("is_posting", e.target.value === "1")}
              >
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </Field>
            <Field label="Transaction type" required error={errors.normal_side} htmlFor="normal_side" hint="Normal balance side">
              <select
                id="normal_side"
                className="input"
                value={form.normal_side}
                disabled={readOnly}
                onChange={(e) => set("normal_side", e.target.value as Form["normal_side"])}
              >
                <option value="">Select</option>
                <option value="D">Debit</option>
                <option value="C">Credit</option>
              </select>
            </Field>
            <Field label="Old GL A/C No" error={errors.old_code} htmlFor="old_code">
              <input id="old_code" className="input" maxLength={20} value={form.old_code} disabled={readOnly} onChange={(e) => set("old_code", e.target.value)} />
            </Field>
            <Field label="Economic code" error={errors.economic_code} htmlFor="economic_code">
              <input
                id="economic_code"
                className="input"
                maxLength={20}
                value={form.economic_code}
                disabled={readOnly}
                onChange={(e) => set("economic_code", e.target.value)}
              />
            </Field>
            <Field
              label="Status"
              required
              error={errors.status}
              htmlFor="status"
              hint={!creating && account && !account.is_posting ? "Making a control account inactive also makes the accounts below it inactive" : undefined}
            >
              <select
                id="status"
                className="input"
                value={form.status}
                disabled={creating ? !canCreate : !canDeactivate}
                onChange={(e) => set("status", e.target.value as Form["status"])}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </Field>
            <button type="submit" className="hidden" />
          </form>

          {showChildrenTable && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-3.5 py-2.5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Child accounts {form.title.trim() ? `under ${form.title.trim()}` : ""}
                  </h3>
                  <p className="text-xs text-gray-500">
                    {creating
                      ? "Click \"Add row\" or \"+5 rows\" to add child accounts while creating this group."
                      : `${existingRows.length} child account${existingRows.length === 1 ? "" : "s"} under this parent (edit or remove inline). Click "Add row" to add new children.`}
                  </p>
                </div>
                {canAddNewChildren && (
                  <div className="flex items-center gap-1.5">
                    <button type="button" className="btn btn-secondary py-1 text-xs" onClick={() => addDraftRows(1)}>
                      <Plus size={14} /> Add row
                    </button>
                    <button type="button" className="btn btn-secondary py-1 text-xs" onClick={() => addDraftRows(5)}>
                      +5 rows
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto bg-white">
                <table className="table w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-xs font-medium text-gray-500">
                      <th className="w-10 px-2.5 py-2">#</th>
                      <th className="w-40 px-2.5 py-2">A/C No</th>
                      <th className="min-w-52 px-2.5 py-2">Title *</th>
                      <th className="w-28 px-2.5 py-2">GL ID</th>
                      <th className="w-24 px-2.5 py-2">Posting</th>
                      <th className="w-24 px-2.5 py-2">Side</th>
                      <th className="w-28 px-2.5 py-2">Old code</th>
                      {(canDeletePerm || (canAddNewChildren && childDrafts.length > 0)) && <th className="w-14 px-2.5 py-2 text-right">Remove</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {existingRows.length === 0 && childDrafts.length === 0 && (
                      <tr>
                        <td colSpan={canDeletePerm || (canAddNewChildren && childDrafts.length > 0) ? 8 : 7} className="px-3 py-4 text-center text-xs text-gray-500">
                          No child accounts yet. Click &ldquo;Add row&rdquo; or &ldquo;+5 rows&rdquo; above to add child accounts.
                        </td>
                      </tr>
                    )}

                    {/* All descendant child rows under this parent (editable + removable) */}
                    {existingRows.map((row, idx) => {
                      const titleErr = childErrors[`existing.${row.id}.title`];
                      const glErr = childErrors[`existing.${row.id}.gl_id`];
                      const postErr = childErrors[`existing.${row.id}.is_posting`];
                      const dirty = isExistingRowDirty(row);
                      const postingDisabled = readOnly || row.level >= 5 || row.hasChildren;
                      return (
                        <tr
                          key={`existing-${row.id}`}
                          className={cx(
                            dirty ? "bg-amber-50/40" : !row.is_posting ? "bg-gray-50/70" : "",
                            row.status === "inactive" && "opacity-60",
                          )}
                        >
                          <td className="px-2.5 py-1.5 text-xs text-gray-500 tabular">{idx + 1}</td>
                          <td className="px-2.5 py-1.5 font-mono text-xs text-gray-700 tabular whitespace-nowrap">
                            <div style={{ paddingLeft: `${row.depth * 12}px` }} className="flex items-center gap-1">
                              {row.depth > 0 && <span className="text-gray-400">↳</span>}
                              <span className={!row.is_posting ? "font-semibold text-gray-900" : ""}>{row.code}</span>
                            </div>
                            {row.officeName && (
                              <div style={{ paddingLeft: `${row.depth * 12}px` }} className="font-sans text-[10px] text-brand-700">
                                {row.officeName}
                              </div>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              className={cx("input py-1 text-sm", !row.is_posting && "font-medium", titleErr && "input-error")}
                              maxLength={200}
                              value={row.title}
                              disabled={readOnly}
                              onChange={(e) => {
                                setChildErrors((err) => ({ ...err, [`existing.${row.id}.title`]: "" }));
                                updateExistingRow(row.id, { title: e.target.value });
                              }}
                            />
                            {titleErr && <p className="mt-0.5 text-[11px] text-red-600">{titleErr}</p>}
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              inputMode="numeric"
                              className={cx("input py-1 text-sm", glErr && "input-error")}
                              maxLength={20}
                              value={row.gl_id}
                              disabled={readOnly}
                              onChange={(e) => {
                                setChildErrors((err) => ({ ...err, [`existing.${row.id}.gl_id`]: "" }));
                                updateExistingRow(row.id, { gl_id: e.target.value });
                              }}
                            />
                            {glErr && <p className="mt-0.5 text-[11px] text-red-600">{glErr}</p>}
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className={cx("input py-1 text-sm", postErr && "input-error")}
                              value={row.is_posting ? "1" : "0"}
                              disabled={postingDisabled}
                              title={row.hasChildren ? "Has child accounts" : row.level >= 5 ? "Level 5 must allow posting" : undefined}
                              onChange={(e) => {
                                setChildErrors((err) => ({ ...err, [`existing.${row.id}.is_posting`]: "" }));
                                updateExistingRow(row.id, { is_posting: e.target.value === "1" });
                              }}
                            >
                              <option value="1">Yes</option>
                              <option value="0">No</option>
                            </select>
                            {postErr && <p className="mt-0.5 text-[11px] text-red-600">{postErr}</p>}
                          </td>
                          <td className="px-2 py-1.5">
                            <select
                              className="input py-1 text-sm"
                              value={row.normal_side}
                              disabled={readOnly}
                              onChange={(e) => updateExistingRow(row.id, { normal_side: e.target.value as "D" | "C" })}
                            >
                              <option value="D">Dr</option>
                              <option value="C">Cr</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <input
                              type="text"
                              className="input py-1 text-sm"
                              placeholder="Optional"
                              maxLength={20}
                              value={row.old_code}
                              disabled={readOnly}
                              onChange={(e) => updateExistingRow(row.id, { old_code: e.target.value })}
                            />
                          </td>
                          {(canDeletePerm || (canAddNewChildren && childDrafts.length > 0)) && (
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">
                              {canDeletePerm && (
                                <button
                                  type="button"
                                  className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                  onClick={() => setDeleteChildTarget(row)}
                                title={`Delete ${row.title}`}
                                  aria-label={`Delete ${row.title}`}
                                >
                                  <Trash2 size={15} />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}

                    {/* New child rows to add */}
                    {canAddNewChildren &&
                      childDrafts.map((row, idx) => {
                        const titleErr = childErrors[`children.${idx}.title`];
                        const glErr = childErrors[`children.${idx}.gl_id`];
                        const postErr = childErrors[`children.${idx}.is_posting`];
                        return (
                          <tr key={row.key}>
                            <td className="px-2.5 py-1.5 text-xs text-brand-600 tabular">+{idx + 1}</td>
                            <td className="px-2.5 py-1.5 font-mono text-xs text-gray-500 tabular whitespace-nowrap">{codePreviews[idx] || "—"}</td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                className={cx("input py-1 text-sm", titleErr && "input-error")}
                                placeholder="New child account title"
                                maxLength={200}
                                value={row.title}
                                onChange={(e) => {
                                  setChildErrors((err) => ({ ...err, [`children.${idx}.title`]: "" }));
                                  updateDraft(row.key, { title: e.target.value });
                                }}
                              />
                              {titleErr && <p className="mt-0.5 text-[11px] text-red-600">{titleErr}</p>}
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                inputMode="numeric"
                                className={cx("input py-1 text-sm", glErr && "input-error")}
                                placeholder="Auto"
                                maxLength={20}
                                value={row.gl_id}
                                onChange={(e) => {
                                  setChildErrors((err) => ({ ...err, [`children.${idx}.gl_id`]: "" }));
                                  updateDraft(row.key, { gl_id: e.target.value, glIdManual: true });
                                }}
                              />
                              {glErr && <p className="mt-0.5 text-[11px] text-red-600">{glErr}</p>}
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                className={cx("input py-1 text-sm", postErr && "input-error")}
                                value={childMustAllowPosting || row.is_posting ? "1" : "0"}
                                disabled={childMustAllowPosting}
                                onChange={(e) => updateDraft(row.key, { is_posting: e.target.value === "1" })}
                              >
                                <option value="1">Yes</option>
                                {!childMustAllowPosting && <option value="0">No</option>}
                              </select>
                              {postErr && <p className="mt-0.5 text-[11px] text-red-600">{postErr}</p>}
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                className="input py-1 text-sm"
                                value={row.normal_side || form.normal_side || "D"}
                                onChange={(e) => updateDraft(row.key, { normal_side: e.target.value as "D" | "C" })}
                              >
                                <option value="D">Dr</option>
                                <option value="C">Cr</option>
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <input
                                type="text"
                                className="input py-1 text-sm"
                                placeholder="Optional"
                                maxLength={20}
                                value={row.old_code}
                                onChange={(e) => updateDraft(row.key, { old_code: e.target.value })}
                              />
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <button
                                type="button"
                                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                onClick={() => removeDraftRow(row.key)}
                                title="Remove row"
                                aria-label={`Remove new row ${idx + 1}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 px-3.5 py-2.5 text-xs text-gray-500">
                <span>
                  {creating
                    ? `${filledDraftCount} new row${filledDraftCount === 1 ? "" : "s"} ready`
                    : `${dirtyExistingCount} edited · ${filledDraftCount} new`}
                </span>
                {!creating && (canEdit || canCreate) && (
                  <SaveButton busy={bulkBusy} type="button" onClick={saveChildrenBatch} disabled={totalPendingChanges === 0}>
                    {dirtyExistingCount > 0 && filledDraftCount > 0
                      ? `Save ${dirtyExistingCount} edited & ${filledDraftCount} new`
                      : dirtyExistingCount > 0
                      ? `Save ${dirtyExistingCount} edited child${dirtyExistingCount === 1 ? "" : "ren"}`
                      : `Save ${filledDraftCount || ""} new child${filledDraftCount === 1 ? "" : "ren"}`}
                  </SaveButton>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Delete account"
        message={
          account?.has_children
            ? `Delete "${form.title}" (${form.code}) and all accounts under it? This cannot be undone.`
            : `Delete "${form.title}" (${form.code})? This cannot be undone.`
        }
        confirmLabel="Delete"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setConfirmDelete(false)}
      />

      <ConfirmDialog
        open={Boolean(deleteChildTarget)}
        title="Delete child account"
        message={
          deleteChildTarget?.hasChildren
            ? `Delete "${deleteChildTarget.title}" (${deleteChildTarget.code}) and all accounts under it? This cannot be undone.`
            : `Delete "${deleteChildTarget?.title}" (${deleteChildTarget?.code})? This cannot be undone.`
        }
        confirmLabel="Delete"
        danger
        busy={deleteChildBusy}
        onConfirm={confirmRemoveChild}
        onCancel={() => setDeleteChildTarget(null)}
      />
    </Drawer>
  );
}
