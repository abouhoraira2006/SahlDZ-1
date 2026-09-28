import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { requireRestaurantId } from "@/lib/server-staff-auth";

/**
 * Manual expense log ("مصاريف أخرى").
 *
 * Purchases, salaries and waste each have their own collection and are already
 * counted by the accounting report. This collection is the catch-all for the
 * running costs a restaurant has outside of those three: rent, electricity,
 * gas, water, internet, maintenance, cleaning, marketing and so on. Everything
 * written here is summed into the accounting report under `expenses.other`.
 */

/** Categories the owner can pick from. Free text is allowed via `notes`. */
export const EXPENSE_CATEGORIES = [
  { value: "rent", label: "إيجار" },
  { value: "electricity", label: "كهرباء" },
  { value: "gas", label: "غاز" },
  { value: "water", label: "ماء" },
  { value: "internet", label: "إنترنت وتليفون" },
  { value: "maintenance", label: "صيانة وإصلاحات" },
  { value: "cleaning", label: "نظافة" },
  { value: "marketing", label: "إشهار وترويج" },
  { value: "transport", label: "نقل وتوصيل" },
  { value: "packaging", label: "تعليب وتغليف" },
  { value: "tax", label: "ضرائب ورسوم" },
  { value: "other", label: "أخرى" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = new Set<string>(EXPENSE_CATEGORIES.map((c) => c.value));

export const EXPENSE_CATEGORY_LABEL: Record<string, string> =
  Object.fromEntries(EXPENSE_CATEGORIES.map((c) => [c.value, c.label]));

export const EXPENSE_METHODS = [
  { value: "cash", label: "نقداً" },
  { value: "card", label: "بطاقة" },
  { value: "transfer", label: "تحويل بنكي" },
  { value: "check", label: "شيك" },
  { value: "credit", label: "على الحساب" },
] as const;

const METHOD_VALUES = new Set<string>(EXPENSE_METHODS.map((m) => m.value));

export type ExpenseMethod = (typeof EXPENSE_METHODS)[number]["value"];

export type ExpenseRecord = {
  id: string;
  restaurant_id: string;
  category: string;
  amount: number;
  date: string; // YYYY-MM-DD, matches supplier_transactions/staff_transactions
  payment_method: string | null;
  vendor: string | null;
  reference: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
};

export type ExpenseInput = {
  category: string;
  amount: number;
  date?: string;
  payment_method?: string | null;
  vendor?: string | null;
  reference?: string | null;
  notes?: string | null;
};

const today = () => new Date().toISOString().slice(0, 10);

/** Keeps only a plain YYYY-MM-DD so range queries in the report line up. */
function normalizeDate(raw: unknown): string {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today();
}

/**
 * Same as `normalizeDate` but returns null for absent/invalid input, so callers
 * can leave that side of a range unbounded instead of collapsing it to today.
 */
function optionalDate(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function cleanText(raw: unknown, max: number): string | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);
  return s || null;
}

export function validateExpense(input: ExpenseInput):
  | {
      ok: true;
      value: Required<Pick<ExpenseInput, "category" | "amount" | "date">> &
        Record<string, unknown>;
    }
  | { ok: false; error: string } {
  const category = String(input.category ?? "").trim();
  if (!CATEGORY_VALUES.has(category))
    return { ok: false, error: "نوع المصروف غير معروف" };

  const amount = Math.round(Number(input.amount) * 100) / 100;
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "أدخل مبلغاً صحيحاً أكبر من صفر" };
  if (amount > 1_000_000_000)
    return { ok: false, error: "المبلغ كبير بشكل غير منطقي" };

  const method = cleanText(input.payment_method, 24);
  if (method && !METHOD_VALUES.has(method))
    return { ok: false, error: "طريقة الدفع غير معروفة" };

  return {
    ok: true,
    value: {
      category,
      amount,
      date: normalizeDate(input.date),
      payment_method: method,
      vendor: cleanText(input.vendor, 80),
      reference: cleanText(input.reference, 40),
      notes: cleanText(input.notes, 300),
    },
  };
}

// ─── DB logic ───────────────────────────────────────────────────

export async function createExpenseCore(
  rid: string,
  input: ExpenseInput,
  createdBy?: string | null,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const v = validateExpense(input);
  if (!v.ok) return { ok: false, error: v.error };

  const row = {
    restaurant_id: rid,
    category: v.value.category,
    amount: v.value.amount,
    date: v.value.date,
    payment_method: v.value.payment_method,
    vendor: v.value.vendor,
    reference: v.value.reference,
    notes: v.value.notes,
    created_by: createdBy ?? null,
    created_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("expenses")
    .insert(row)
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string } | null)?.id };
}

export async function listExpensesCore(
  rid: string,
  range?: { from?: string; to?: string },
): Promise<{ ok: boolean; expenses: ExpenseRecord[]; error?: string }> {
  let q = supabase
    .from("expenses")
    .select(
      "id,restaurant_id,category,amount,date,payment_method,vendor,reference,notes,created_by,created_at",
    )
    .eq("restaurant_id", rid);

  const from = optionalDate(range?.from);
  const to = optionalDate(range?.to);
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);

  const { data, error } = await q.order("date", { ascending: false });
  if (error) return { ok: false, expenses: [], error: error.message };
  return { ok: true, expenses: (data ?? []) as ExpenseRecord[] };
}

export async function updateExpenseCore(
  rid: string,
  expenseId: string,
  patch: ExpenseInput,
): Promise<{ ok: boolean; error?: string }> {
  const v = validateExpense(patch);
  if (!v.ok) return { ok: false, error: v.error };

  const { error } = await supabase
    .from("expenses")
    .update({
      category: v.value.category,
      amount: v.value.amount,
      date: v.value.date,
      payment_method: v.value.payment_method,
      vendor: v.value.vendor,
      reference: v.value.reference,
      notes: v.value.notes,
    })
    .eq("id", expenseId)
    .eq("restaurant_id", rid);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function deleteExpenseCore(
  rid: string,
  expenseId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", expenseId)
    .eq("restaurant_id", rid);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Total per category, used for the breakdown bars on the expenses screen. */
export function summarizeByCategory(
  expenses: ExpenseRecord[],
): { category: string; label: string; amount: number; count: number }[] {
  const map = new Map<string, { amount: number; count: number }>();
  for (const e of expenses) {
    const cur = map.get(e.category) ?? { amount: 0, count: 0 };
    cur.amount += Number(e.amount || 0);
    cur.count += 1;
    map.set(e.category, cur);
  }
  return [...map.entries()]
    .map(([category, v]) => ({
      category,
      label: EXPENSE_CATEGORY_LABEL[category] ?? category,
      amount: Math.round(v.amount * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// ─── Server-fn bindings ─────────────────────────────────────────

export const createExpense = createServerFn({ method: "POST" })
  .validator((d: ExpenseInput) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb()) return { ok: true };
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return createExpenseCore(rid, data);
  });

export const updateExpense = createServerFn({ method: "POST" })
  .validator((d: ExpenseInput & { expenseId: string }) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb()) return { ok: true };
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return updateExpenseCore(rid, data.expenseId, data);
  });

export const deleteExpense = createServerFn({ method: "POST" })
  .validator((d: { expenseId: string }) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb()) return { ok: true };
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return deleteExpenseCore(rid, data.expenseId);
  });
