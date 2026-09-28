import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ChefHat,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Printer,
  ArrowUp,
  ArrowDown,
  Power,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DEFAULT_KITCHEN_ID, isSyntheticKitchen, type Kitchen, type KitchensSnapshot } from "@/lib/kitchens";
import {
  kitchensLoad,
  kitchensCreate,
  kitchensUpdate,
  kitchensDelete,
  kitchensReorder,
} from "@/lib/kitchens.functions";
import {
  listIndividualChefs,
  setIndividualChefKitchen,
} from "@/lib/individual-chef.functions";
import { listPrinters } from "@/lib/kitchen-print";
import type { ChefListRow } from "@/lib/individual-chef.functions";

// ─── المطابخ + توجيه الطباعة ──────────────────────────────────────
//
// The owner defines the stations (مطبخ البيتزا، مطبخ الحلويات…) and, per
// station, the local printer and print behaviour. Categories are then pointed
// at a kitchen from the menu editor, and the cashier's order is split
// automatically: every kitchen terminal only ever receives — and prints — its
// own lines.

type Chef = ChefListRow;

const emptySnapshot: KitchensSnapshot = { kitchens: [], is_empty: true };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("الجلسة منتهية، سجّل دخولك من جديد");
  return { authorization: `Bearer ${token}` };
}

type FormState = {
  name: string;
  code: string;
  printer_name: string;
  copies: string;
  auto_print: boolean;
  is_active: boolean;
};

const emptyForm: FormState = {
  name: "",
  code: "",
  printer_name: "",
  copies: "1",
  auto_print: true,
  is_active: true,
};

export function KitchensSettingsPageView() {
  const loadFn = useServerFn(kitchensLoad);
  const createFn = useServerFn(kitchensCreate);
  const updateFn = useServerFn(kitchensUpdate);
  const deleteFn = useServerFn(kitchensDelete);
  const reorderFn = useServerFn(kitchensReorder);
  const listChefsFn = useServerFn(listIndividualChefs);
  const bindChefFn = useServerFn(setIndividualChefKitchen);

  const [snap, setSnap] = useState<KitchensSnapshot>(emptySnapshot);
  const [chefs, setChefs] = useState<Chef[]>([]);
  /** Printers reported by the desktop shell; empty in a browser. */
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Create / edit dialog
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formErr, setFormErr] = useState<string | null>(null);

  // Delete confirm
  const [toDelete, setToDelete] = useState<Kitchen | null>(null);
  /** Staff assigned to the kitchen being created/edited, in the same save. */
  const [formStaff, setFormStaff] = useState<string[]>([]);
  /** Printer settings stay collapsed — they are optional, not the main task. */
  const [showPrint, setShowPrint] = useState(false);

  const refresh = async () => {
    try {
      const headers = await authHeaders();
      setSnap((await loadFn({ headers })) as KitchensSnapshot);
    } catch (e) {
      toast.error("تعذّر تحميل المطابخ: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const headers = await authHeaders();
        const [s, c] = await Promise.all([
          loadFn({ headers }) as Promise<KitchensSnapshot>,
          listChefsFn({ headers }) as Promise<{ chefs: Chef[] }>,
        ]);
        setSnap(s);
        setChefs(c.chefs ?? []);
      } catch (e) {
        toast.error("تعذّر تحميل المطابخ: " + (e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
    // Printer names only exist in the desktop shell; a browser just shows the
    // manual field.
    listPrinters().then(setPrinters).catch(() => setPrinters([]));
  }, [loadFn, listChefsFn]);

  const realKitchens = snap.kitchens.filter((k) => !isSyntheticKitchen(k.id));
  const hasDefault = snap.kitchens.some((k) => k.id === DEFAULT_KITCHEN_ID);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setFormErr(null);
    setFormStaff([]);
    setOpen(true);
  };

  const openEdit = (k: Kitchen) => {
    setEditingId(k.id);
    setForm({
      name: k.name,
      code: k.code,
      printer_name: k.printer_name ?? "",
      copies: String(k.copies ?? 1),
      auto_print: k.auto_print !== false,
      is_active: k.is_active !== false,
    });
    setFormStaff(chefs.filter((c) => c.kitchen_id === k.id).map((c) => c.id));
    setFormErr(null);
    setOpen(true);
  };

  const submit = async () => {
    if (!form.name.trim()) {
      setFormErr("اسم المطبخ مطلوب");
      return;
    }
    setBusy(true);
    setFormErr(null);
    try {
      const headers = await authHeaders();
      const payload = {
        name: form.name,
        code: form.code,
        printer_name: form.printer_name,
        copies: Number(form.copies) || 1,
        auto_print: form.auto_print,
        is_active: form.is_active,
      };
      const before = new Set(snap.kitchens.map((k) => k.id));
      const next = editingId
        ? ((await updateFn({
            headers,
            data: { ...payload, kitchenId: editingId },
          })) as KitchensSnapshot)
        : ((await createFn({ headers, data: payload })) as KitchensSnapshot);
      setSnap(next);

      // Assigning staff is the point of a kitchen, so it happens in the same
      // save as the creation itself instead of a second hidden step.
      const targetId =
        editingId ??
        (next.kitchens.find((k) => !before.has(k.id))?.id ?? null);
      if (targetId) {
        for (const chefId of formStaff) {
          await bindChef(chefId, targetId);
        }
      }

      setOpen(false);
      toast.success(
        editingId
          ? "تم تحديث المطبخ"
          : formStaff.length
            ? `تمت إضافة المطبخ وربط ${formStaff.length} موظف`
            : "تمت إضافة المطبخ",
      );
    } catch (e) {
      const msg = (e as Error).message;
      setFormErr(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      const headers = await authHeaders();
      const next = (await deleteFn({
        headers,
        data: { kitchenId: toDelete.id },
      })) as KitchensSnapshot;
      setSnap(next);
      setToDelete(null);
      toast.success("تم حذف المطبخ — عادت فئاته للمطبخ الرئيسي");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const move = async (k: Kitchen, direction: "up" | "down") => {
    try {
      const headers = await authHeaders();
      setSnap((await reorderFn({
        headers,
        data: { kitchenId: k.id, direction },
      })) as KitchensSnapshot);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const bindChef = async (chefId: string, kitchenId: string) => {
    try {
      const headers = await authHeaders();
      await bindChefFn({ headers, data: { chefId, kitchen_id: kitchenId } });
      setChefs((prev) =>
        prev.map((c) => (c.id === chefId ? { ...c, kitchen_id: kitchenId } : c)),
      );
      toast.success("تم ربط الجهاز بالمطبخ");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <ChefHat className="w-5 h-5 text-[var(--primary)]" />
            المطابخ
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            قسّم عملك بين المطابخ، وحدد الطابعة الخاصة بكل واحد. بعد ربط الفئات
            بالمطابخ، كل طلب يتوزّع تلقائياً على المطابخ، وكل مطبخة تطبع
            أصنافها على طابعتها.
          </p>
        </div>
        <Button onClick={openCreate} disabled={busy}>
          <Plus className="w-4 h-4" />
          مطبخ جديد
        </Button>
      </div>

      <KitchenStaffPanel
        chefs={chefs}
        kitchens={snap.kitchens}
        onBind={bindChef}
      />

      {snap.is_empty && !hasDefault && realKitchens.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <ChefHat className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p>لا توجد مطابخ بعد.</p>
          <p className="text-sm mt-1">
            أضف مطبخاً واحداً على الأقل لتتمكن من توجيه الفئات والطباعة.
          </p>
        </div>
      ) : null}

      {hasDefault ? (
        <DefaultKitchenCard
          chefs={chefs}
          kitchens={snap.kitchens}
          onBind={bindChef}
        />
      ) : null}

      <div className="grid gap-3">
        {realKitchens.map((k, idx) => (
          <KitchenCard
            key={k.id}
            kitchen={k}
            chefs={chefs}
            allKitchens={snap.kitchens}
            isFirst={idx === 0}
            isLast={idx === realKitchens.length - 1}
            onEdit={() => openEdit(k)}
            onDelete={() => setToDelete(k)}
            onMove={(d) => move(k, d)}
            onBind={bindChef}
          />
        ))}
      </div>

      {/* Create / edit */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingId ? "تعديل المطبخ" : "مطبخ جديد"}
            </DialogTitle>
            <DialogDescription>
              سمّ المطبخ، ثم اختر من سيشتغل فيه. الطابعة اختيارية وتقدر
              تضيفها لاحقاً.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>اسم المطبخ</Label>
              <Input
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="مثال: مطبخ البيتزا"
              />
            </div>

            <ChefPicker
              chefs={chefs}
              selected={formStaff}
              onToggle={(id) =>
                setFormStaff((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id],
                )
              }
            />

            {/* Printing is optional: a kitchen with no printer just falls back
                to the browser dialog, so it stays out of the way. */}
            <button
              type="button"
              onClick={() => setShowPrint((v) => !v)}
              className="text-sm text-muted-foreground underline underline-offset-4"
            >
              {showPrint ? "إخفاء إعدادات الطباعة" : "إعدادات الطباعة (اختياري)"}
            </button>

            {showPrint ? (
              <>
                <div className="space-y-2">
                  <Label>الرمز على التذكرة</Label>
                  <Input
                    value={form.code}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, code: e.target.value }))
                    }
                    placeholder="PIZZA"
                  />
                </div>

                <div className="space-y-2">
                  <Label>الطابعة</Label>
                  <Select
                    value={form.printer_name || "__default__"}
                    onValueChange={(v) =>
                      setForm((f) => ({
                        ...f,
                        printer_name: v === "__default__" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="الطابعة الافتراضية" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__default__">
                        الطابعة الافتراضية
                      </SelectItem>
                      {printers.map((p) => (
                        <SelectItem key={p.name} value={p.name}>
                          {p.name}
                          {p.isDefault ? " (افتراضية)" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {printers.length
                      ? "اختر طابعة هذا المطبخ من جهازه. الفارغة = الطابعة الافتراضية."
                      : "لم تُكتشف طابعات — سيُستعمل الأمر في المتصفح، أو اسم الطابعة مكتوب يدوياً."}
                  </p>
                  {printers.length ? null : (
                    <Input
                      value={form.printer_name}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, printer_name: e.target.value }))
                      }
                      placeholder="أو اكتب اسم الطابعة يدوياً"
                    />
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>عدد النسخ</Label>
                    <Input
                      type="number"
                      min={1}
                      max={9}
                      value={form.copies}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, copies: e.target.value }))
                      }
                    />
                  </div>
                  <div className="space-y-3 pt-6">
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-1.5">
                        <Printer className="w-3.5 h-3.5" />
                        طباعة تلقائية
                      </Label>
                      <Switch
                        checked={form.auto_print}
                        onCheckedChange={(v) =>
                          setForm((f) => ({ ...f, auto_print: v }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label className="flex items-center gap-1.5">
                        <Power className="w-3.5 h-3.5" />
                        مفعّل
                      </Label>
                      <Switch
                        checked={form.is_active}
                        onCheckedChange={(v) =>
                          setForm((f) => ({ ...f, is_active: v }))
                        }
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {formErr ? (
              <p className="text-sm text-destructive">{formErr}</p>
            ) : null}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!toDelete}
        onOpenChange={(o) => !o && setToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المطبخ؟</AlertDialogTitle>
            <AlertDialogDescription>
              الفئات وأصناف هذا المطبخ ترجع تلقائياً للمطبخ الرئيسي، والأجهزة
              المرتبطة به تصبح غير مرتبطة. لا يمكن التراجع.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={remove}
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── cards ────────────────────────────────────────────────────────

/**
 * Every employee holding the `kitchen` permission, with the kitchen each one
 * serves. This is the single place the binding is managed, so nobody has to
 * open a kitchen card to find out who cooks where.
 */
function KitchenStaffPanel({
  chefs,
  kitchens,
  onBind,
}: {
  chefs: Chef[];
  kitchens: Kitchen[];
  onBind: (chefId: string, kitchenId: string) => void;
}) {
  const nameOf = (id: string) =>
    kitchens.find((k) => k.id === id)?.name ?? "المطبخ الرئيسي";
  return (
    <div className="rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="w-5 h-5 text-[var(--primary)]" />
        <h2 className="font-semibold">موظفو المطبخ</h2>
        <span className="text-xs text-muted-foreground">
          {chefs.length} موظف عندهم صلاحية المطبخ
        </span>
      </div>
      {chefs.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          ماكاين حتى موظف عندو صلاحية المطبخ. زيد موظف من صفحة الموظفين وديرو
          عليه صلاحية «المطبخ».
        </p>
      ) : (
        <div className="space-y-2">
          {chefs.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate font-medium">{c.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {nameOf(c.kitchen_id)}
                </span>
                <div className="w-48 shrink-0">
                  <Select
                    value={c.kitchen_id}
                    onValueChange={(v) => onBind(c.id, v)}
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {kitchens
                        .filter((k) => k.is_active !== false)
                        .map((k) => (
                          <SelectItem key={k.id} value={k.id}>
                            {k.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Checkbox list of kitchen-capable staff, used inside the create/edit dialog. */
function ChefPicker({
  chefs,
  selected,
  onToggle,
}: {
  chefs: Chef[];
  selected: string[];
  onToggle: (chefId: string) => void;
}) {
  if (chefs.length === 0) return null;
  return (
    <div className="space-y-2">
      <Label>من سيشتغل في هذا المطبخ؟</Label>
      <div className="rounded-md border divide-y max-h-56 overflow-y-auto">
        {chefs.map((c) => {
          const on = selected.includes(c.id);
          return (
            <label
              key={c.id}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-muted/50"
            >
              <Checkbox
                checked={on}
                onCheckedChange={() => onToggle(c.id)}
                id={`chef-${c.id}`}
              />
              <span className="text-sm flex-1">{c.name}</span>
              <span className="text-xs text-muted-foreground">
                حالياً:{" "}
                {isSyntheticKitchen(c.kitchen_id)
                  ? "المطبخ الرئيسي"
                  : c.kitchen_id}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function ChefBindingRow({
  chef,
  kitchenId,
  kitchens,
  onBind,
}: {
  chef: Chef;
  kitchenId: string;
  kitchens: Kitchen[];
  onBind: (chefId: string, kitchenId: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="truncate">{chef.name}</span>
      <div className="w-52 shrink-0">
        <Select
          value={kitchenId}
          onValueChange={(v) => onBind(chef.id, v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kitchens
              .filter((k) => k.is_active !== false)
              .map((k) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function DefaultKitchenCard({
  chefs,
  kitchens,
  onBind,
}: {
  chefs: Chef[];
  kitchens: Kitchen[];
  onBind: (chefId: string, kitchenId: string) => void;
}) {
  const bound = chefs.filter((c) => !isSyntheticKitchen(c.kitchen_id));
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ChefHat className="w-4 h-4 text-[var(--primary)]" />
        <span className="font-semibold">المطبخ الرئيسي</span>
        <span className="text-xs text-muted-foreground">
          تلقائي — كل فئة غير مرتبطة بمطبخ
        </span>
      </div>
      {bound.length ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">الأجهزة المرتبطة</p>
          {chefs.map((c) => (
            <ChefBindingRow
              key={c.id}
              chef={c}
              kitchenId={c.kitchen_id}
              kitchens={kitchens}
              onBind={onBind}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function KitchenCard({
  kitchen,
  chefs,
  allKitchens,
  isFirst,
  isLast,
  onEdit,
  onDelete,
  onMove,
  onBind,
}: {
  kitchen: Kitchen;
  chefs: Chef[];
  allKitchens: Kitchen[];
  isFirst: boolean;
  isLast: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMove: (d: "up" | "down") => void;
  onBind: (chefId: string, kitchenId: string) => void;
}) {
  const bound = chefs.filter((c) => c.kitchen_id === kitchen.id);
  const inactive = kitchen.is_active === false;

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold">{kitchen.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-mono">
              {kitchen.code}
            </span>
            {inactive ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                موقوف
              </span>
            ) : null}
            {!kitchen.auto_print ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                طباعة يدوية
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Printer className="w-3 h-3" />
              {kitchen.printer_name || "الطابعة الافتراضية"}
            </span>
            <span>{kitchen.copies ?? 1} نسخة</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isFirst}
            onClick={() => onMove("up")}
            title="تحريك للأعلى"
          >
            <ArrowUp className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={isLast}
            onClick={() => onMove("down")}
            title="تحريك للأسفل"
          >
            <ArrowDown className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onEdit}
            title="تعديل"
          >
            <Pencil className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive"
            onClick={onDelete}
            title="حذف"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {bound.length ? (
        <div className="space-y-2 border-t pt-3">
          <p className="text-xs text-muted-foreground">الأجهزة المرتبطة</p>
          {chefs
            .filter((c) => c.kitchen_id === kitchen.id)
            .map((c) => (
              <ChefBindingRow
                key={c.id}
                chef={c}
                kitchenId={c.kitchen_id}
                kitchens={allKitchens}
                onBind={onBind}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}
