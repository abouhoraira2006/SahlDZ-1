import { useEffect, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { requireOpsAccess } from "@/lib/permissions";
import { Wallet, Loader2, Calendar, Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { useRestaurantId, formatDZD } from "@/lib/restaurant";
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABEL,
  EXPENSE_METHODS,
  createExpense as createExpenseFn,
  deleteExpense as deleteExpenseFn,
  updateExpense as updateExpenseFn,
  type ExpenseRecord,
} from "@/lib/expenses.functions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { tx } from "@/lib/ops-tx";
import { CanWrite } from "@/components/PermissionsGate";
import { useAreaPermission } from "@/lib/permissions";

export const Route = createFileRoute("/ops/expenses")({
  beforeLoad: requireOpsAccess("expenses"),
  component: OpsExpenses,
});

type TxRow = {
  id: string;
  supplier_name: string;
  type: string;
  amount: number;
  date: string;
  notes: string | null;
};

type Summary = {
  purchases: number;
  salaries: number;
  waste: number;
  manual: number;
  total: number;
};

const TYPE_LABELS: Record<
  string,
  {
    label: string;
    variant: "destructive" | "success" | "secondary" | "warning";
  }
> = {
  purchase: { label: tx("شراء"), variant: "destructive" },
  payment: { label: tx("دفعة"), variant: "success" },
  advance: { label: tx("سلفة"), variant: "secondary" },
  return: { label: tx("مرتجع"), variant: "warning" },
};

function startOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function OpsExpenses() {
  const { restaurantId } = useRestaurantId();
  const { canWrite } = useAreaPermission("expenses");
  const createFn = useServerFn(createExpenseFn);
  const updateFn = useServerFn(updateExpenseFn);
  const removeFn = useServerFn(deleteExpenseFn);

  const [txRows, setTxRows] = useState<TxRow[]>([]);
  const [manual, setManual] = useState<ExpenseRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());
  const [typeFilter, setTypeFilter] = useState("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<ExpenseRecord | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [form, setForm] = useState({
    category: "other",
    amount: "",
    date: today(),
    payment_method: "cash",
    vendor: "",
    reference: "",
    notes: "",
  });

  function resetForm() {
    setForm({
      category: "other",
      amount: "",
      date: today(),
      payment_method: "cash",
      vendor: "",
      reference: "",
      notes: "",
    });
  }

  function openAdd() {
    resetForm();
    setEditingId(null);
    setDialogOpen(true);
  }

  function openEdit(e: ExpenseRecord) {
    setForm({
      category: e.category,
      amount: String(e.amount ?? ""),
      date: e.date ?? today(),
      payment_method: e.payment_method ?? "cash",
      vendor: e.vendor ?? "",
      reference: e.reference ?? "",
      notes: e.notes ?? "",
    });
    setEditingId(e.id);
    setDialogOpen(true);
  }

  async function authHeaders(): Promise<Record<string, string>> {
    if (!getFirebaseDb()) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { authorization: `Bearer ${token}` } : {};
  }

  async function submit() {
    if (!restaurantId) return;
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0)
      return toast.error(tx("أدخل مبلغاً صحيحاً أكبر من صفر"));
    setSaving(true);
    try {
      const payload = {
        category: form.category,
        amount,
        date: form.date,
        payment_method: form.payment_method,
        vendor: form.vendor.trim() || null,
        reference: form.reference.trim() || null,
        notes: form.notes.trim() || null,
      };
      const res = editingId
        ? await updateFn({
            headers: await authHeaders(),
            data: { ...payload, expenseId: editingId },
          })
        : await createFn({ headers: await authHeaders(), data: payload });
      if (!(res as { ok: boolean }).ok)
        throw new Error((res as { error?: string }).error || tx("فشل الحفظ"));
      toast.success(
        editingId ? tx("تم تعديل المصروف") : tx("تم تسجيل المصروف"),
      );
      setDialogOpen(false);
      resetForm();
      setEditingId(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message || tx("فشل الحفظ"));
    } finally {
      setSaving(false);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setSaving(true);
    try {
      const res = await removeFn({
        headers: await authHeaders(),
        data: { expenseId: toDelete.id },
      });
      if (!(res as { ok: boolean }).ok)
        throw new Error((res as { error?: string }).error || tx("فشل الحذف"));
      toast.success(tx("تم حذف المصروف"));
      setToDelete(null);
      setReloadKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message || tx("فشل الحذف"));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (restaurantId === undefined) return;
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("supplier_transactions")
        .select("id, type, amount, date, notes, suppliers(name)")
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false });

      const { data: manualRows } = await supabase
        .from("expenses")
        .select(
          "id,restaurant_id,category,amount,date,payment_method,vendor,reference,notes,created_by,created_at",
        )
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to)
        .order("date", { ascending: false });

      if (cancel) return;
      if (error) {
        console.error(error);
        setLoading(false);
        return;
      }

      setManual((manualRows ?? []) as ExpenseRecord[]);

      const rows: TxRow[] = (data ?? []).map((d: any) => ({
        id: d.id,
        supplier_name: d.suppliers?.name ?? tx("مورد غير محدد"),
        type: d.type,
        amount: Number(d.amount || 0),
        date: d.date,
        notes: d.notes,
      }));

      setTxRows(rows);
      setLoading(false);
    })();
    return () => {
      cancel = true;
    };
  }, [restaurantId, from, to, reloadKey]);

  const [summary, setSummary] = useState<Summary>({
    purchases: 0,
    salaries: 0,
    waste: 0,
    manual: 0,
    total: 0,
  });

  useEffect(() => {
    if (!restaurantId) return;
    let cancel = false;
    (async () => {
      const [salRes, wasteRes] = await Promise.all([
        supabase
          .from("employee_salary_payments")
          .select("net_salary")
          .eq("restaurant_id", restaurantId)
          .gte("paid_at", from + "T00:00:00")
          .lte("paid_at", to + "T23:59:59"),
        supabase
          .from("waste_logs")
          .select("cost")
          .eq("restaurant_id", restaurantId)
          .gte("created_at", from + "T00:00:00")
          .lte("created_at", to + "T23:59:59"),
      ]);

      if (cancel) return;

      const purchases = txRows
        .filter((r) => r.type === "purchase")
        .reduce((s, r) => s + r.amount, 0);

      const payments = txRows
        .filter((r) => r.type === "payment")
        .reduce((s, r) => s + r.amount, 0);

      const salaries = (salRes.data ?? []).reduce(
        (s: number, r: any) => s + Number(r.net_salary || 0),
        0,
      );
      const waste = (wasteRes.data ?? []).reduce(
        (s: number, r: any) => s + Number(r.cost || 0),
        0,
      );
      const manualTotal = manual.reduce((s, e) => s + Number(e.amount || 0), 0);

      setSummary({
        purchases,
        salaries,
        waste,
        manual: manualTotal,
        total: purchases - payments + salaries + waste + manualTotal,
      });
    })();
    return () => {
      cancel = true;
    };
  }, [restaurantId, txRows, manual, from, to]);

  const manualTotal = useMemo(
    () => manual.reduce((s, e) => s + Number(e.amount || 0), 0),
    [manual],
  );

  const filtered = useMemo(() => {
    if (typeFilter === "all") return txRows;
    return txRows.filter((r) => r.type === typeFilter);
  }, [txRows, typeFilter]);

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of manual)
      map.set(e.category, (map.get(e.category) ?? 0) + Number(e.amount || 0));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [manual]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Contextual Page Toolbar */}
      <div className="rounded-md border border-border bg-card p-3 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-sm bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Wallet className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-foreground">
              {tx("سجل المصاريف والمدفوعات")}
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {tx("إدارة قيود المشتريات والمدفوعات والرواتب")}
            </p>
          </div>
        </div>

        {/* Date & Type Filters */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center gap-1.5 border border-border rounded-sm px-2 py-1 bg-secondary/30 text-xs">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            <span className="text-[11px] text-muted-foreground">
              {tx("من")}
            </span>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-6 w-28 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
            />
            <span className="text-border">·</span>
            <span className="text-[11px] text-muted-foreground">
              {tx("إلى")}
            </span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-6 w-28 text-xs border-0 bg-transparent p-0 focus-visible:ring-0"
            />
          </div>

          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="h-8 w-28 text-xs rounded-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tx("كل القيود")}</SelectItem>
              <SelectItem value="purchase">{tx("شراء")}</SelectItem>
              <SelectItem value="payment">{tx("دفعة")}</SelectItem>
              <SelectItem value="advance">{tx("سلفة")}</SelectItem>
              <SelectItem value="return">{tx("مرتجع")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <CanWrite area="expenses">
        <Button onClick={openAdd} className="gap-1.5 rounded-sm" size="sm">
          <Plus className="w-4 h-4" />
          {tx("تسجيل مصروف")}
        </Button>
      </CanWrite>

      {/* Manual expense log — rent, electricity, gas, maintenance, ... */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground">
            {tx("مصاريف تشغيلية أخرى")}
          </h2>
          <span className="text-[11px] font-bold text-destructive tabular-nums">
            −{formatDZD(manualTotal)}
          </span>
        </div>

        {loading ? (
          <div className="p-6 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : manual.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground">
            {tx(
              "لا توجد مصاريف مسجلة — اضغط «تسجيل مصروف» لإضافة إيجار، كهرباء، غاز…",
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{tx("التاريخ")}</TableHead>
                  <TableHead className="text-xs">{tx("النوع")}</TableHead>
                  <TableHead className="text-xs">
                    {tx("الجهة / الدافع")}
                  </TableHead>
                  <TableHead className="text-xs">{tx("طريقة الدفع")}</TableHead>
                  <TableHead className="text-xs text-left">
                    {tx("المبلغ")}
                  </TableHead>
                  {canWrite && <TableHead className="text-xs" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {manual.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="text-xs font-mono text-muted-foreground">
                      {e.date}
                    </TableCell>
                    <TableCell>
                      <Badge variant="warning" className="text-[10px]">
                        {EXPENSE_CATEGORY_LABEL[e.category] ?? e.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-medium text-foreground">
                      {e.vendor || "—"}
                      {e.notes ? (
                        <span className="text-muted-foreground font-normal">
                          {" "}
                          · {e.notes}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {EXPENSE_METHODS.find((m) => m.value === e.payment_method)
                        ?.label ?? "—"}
                    </TableCell>
                    <TableCell className="text-xs font-bold text-left tabular-nums text-destructive">
                      −{formatDZD(e.amount)}
                    </TableCell>
                    {canWrite && (
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => openEdit(e)}
                            aria-label={tx("تعديل")}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => setToDelete(e)}
                            aria-label={tx("حذف")}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {byCategory.length > 0 && (
          <div className="px-4 py-3 border-t border-border bg-secondary/10">
            <h3 className="text-[11px] font-semibold text-muted-foreground mb-2">
              {tx("التوزيع حسب النوع")}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {byCategory.map(([cat, amt]) => (
                <span
                  key={cat}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px]"
                >
                  <span className="text-muted-foreground">
                    {EXPENSE_CATEGORY_LABEL[cat] ?? cat}
                  </span>
                  <span className="font-bold tabular-nums">
                    {formatDZD(amt)}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent dir="rtl" className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? tx("تعديل مصروف") : tx("تسجيل مصروف جديد")}
            </DialogTitle>
            <DialogDescription>
              {tx("يُحتسب تلقائياً في المحاسبة ضمن «مصاريف أخرى»")}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label>{tx("نوع المصروف")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) => setForm({ ...form, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tx("المبلغ (دج)")}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>{tx("التاريخ")}</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm({ ...form, date: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tx("طريقة الدفع")}</Label>
                <Select
                  value={form.payment_method}
                  onValueChange={(v) => setForm({ ...form, payment_method: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_METHODS.map((m) => (
                      <SelectItem key={m.value} value={m.value}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{tx("الجهة / الدافع")}</Label>
                <Input
                  value={form.vendor}
                  onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                  placeholder={tx("مثال: سونلاغاز")}
                />
              </div>
            </div>

            <div>
              <Label>{tx("ملاحظة")}</Label>
              <Textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder={tx("مثال: فاتورة كهرباء لشهر سبتمبر")}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {tx("إلغاء")}
            </Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? tx("جاري الحفظ…") : tx("حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <DialogContent dir="rtl" className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tx("حذف المصروف")}</DialogTitle>
            <DialogDescription>
              {tx("سيُحذف")}
              {toDelete ? ` ${formatDZD(toDelete.amount)} ` : " "}
              {tx("من السجل نهائياً.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              {tx("إلغاء")}
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDelete}
              disabled={saving}
            >
              {tx("حذف")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Horizontal Financial Summary Ribbon */}
      <div className="rounded-md border border-border bg-card overflow-hidden grid grid-cols-2 md:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-border">
        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            {tx("إجمالي المشتريات")}
          </span>
          <div className="text-xl font-bold text-foreground tabular-nums my-1">
            {formatDZD(summary.purchases)}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {tx("فواتير الموردين المسجلة")}
          </span>
        </div>

        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            {tx("المدفوعات المسددة")}
          </span>
          <div className="text-xl font-bold text-[#27734F] tabular-nums my-1">
            {formatDZD(
              summary.purchases -
                summary.total +
                summary.salaries +
                summary.waste,
            )}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {tx("دفعات نقدية وبنكية")}
          </span>
        </div>

        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            {tx("رواتب وأجور")}
          </span>
          <div className="text-xl font-bold text-foreground tabular-nums my-1">
            {formatDZD(summary.salaries)}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {tx("مسيرات الشهر المدفوعة")}
          </span>
        </div>

        <div className="p-3.5 flex flex-col justify-between">
          <span className="text-xs text-muted-foreground font-medium">
            {tx("مصاريف أخرى (يدوية)")}
          </span>
          <div className="text-xl font-bold text-destructive tabular-nums my-1">
            {formatDZD(summary.manual)}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {tx("إيجار، كهرباء، غاز، صيانة")}
          </span>
        </div>

        <div className="p-3.5 flex flex-col justify-between bg-secondary/15">
          <span className="text-xs text-muted-foreground font-medium">
            {tx("صافي الالتزام والتشغيل")}
          </span>
          <div className="text-xl font-bold text-foreground tabular-nums my-1">
            {formatDZD(summary.total)}
          </div>
          <span className="text-[11px] text-muted-foreground">
            {tx("إجمالي التكلفة التشغيلية")}
          </span>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="rounded-md border border-border bg-card overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/30 border-b border-border flex items-center justify-between">
          <h2 className="text-xs font-semibold text-foreground">
            {tx("تفاصيل المعاملات والقيود")}
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {filtered.length} {tx("معاملة مسجلة")}
          </span>
        </div>

        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-xs text-muted-foreground">
            {tx("لا توجد معاملات مسجلة في هذه الفترة")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{tx("التاريخ")}</TableHead>
                  <TableHead className="text-xs">
                    {tx("المورد / الجهة")}
                  </TableHead>
                  <TableHead className="text-xs">{tx("نوع القيد")}</TableHead>
                  <TableHead className="text-xs text-left">
                    {tx("المبلغ")}
                  </TableHead>
                  <TableHead className="text-xs">{tx("ملاحظات")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => {
                  const typeInfo =
                    TYPE_LABELS[row.type] ?? TYPE_LABELS.purchase;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {row.date}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-foreground">
                        {row.supplier_name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={typeInfo.variant}
                          className="text-[10px]"
                        >
                          {typeInfo.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-bold text-left tabular-nums">
                        <span
                          className={
                            row.type === "payment"
                              ? "text-[#27734F]"
                              : "text-foreground"
                          }
                        >
                          {row.type === "purchase" ? "+" : "−"}
                          {formatDZD(row.amount)}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[240px] truncate">
                        {row.notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
