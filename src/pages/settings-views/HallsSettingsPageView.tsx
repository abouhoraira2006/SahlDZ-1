import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  LayoutGrid,
  Loader2,
  Plus,
  Pencil,
  QrCode,
  Trash2,
  Printer,
  Download,
  Copy,
  RefreshCw,
  DoorOpen,
  Check,
} from "lucide-react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { appOrigin } from "@/lib/app-url";
import type { HallWithTables, Table } from "@/lib/halls";
import {
  hallsLoad,
  hallsCreate,
  hallsRename,
  hallsDelete,
  hallsAddTables,
  hallsRenameTable,
  hallsDeleteTable,
  hallsRegenerateTableQr,
  hallsBackfillQr,
} from "@/lib/halls.functions";

// ─── القاعات والطاولات ───────────────────────────────────────────
//
// The owner is in full control: any number of halls, any number of tables
// per hall, and any table numbering they want. Every table gets a QR code
// pointing at its own public menu page, all reachable from a single button.

type Snapshot = { halls: HallWithTables[]; tables: Table[] };

async function authHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("الجلسة منتهية، سجّل دخولك من جديد");
  return { authorization: `Bearer ${token}` };
}

const emptySnapshot: Snapshot = { halls: [], tables: [] };

export function HallsSettingsPageView() {
  const loadFn = useServerFn(hallsLoad);
  const createFn = useServerFn(hallsCreate);
  const renameFn = useServerFn(hallsRename);
  const deleteFn = useServerFn(hallsDelete);
  const addTablesFn = useServerFn(hallsAddTables);
  const renameTableFn = useServerFn(hallsRenameTable);
  const deleteTableFn = useServerFn(hallsDeleteTable);
  const regenQrFn = useServerFn(hallsRegenerateTableQr);
  const backfillFn = useServerFn(hallsBackfillQr);

  const [snap, setSnap] = useState<Snapshot>(emptySnapshot);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New hall
  const [hallOpen, setHallOpen] = useState(false);
  const [hallName, setHallName] = useState("");
  const [hallCount, setHallCount] = useState("4");
  const [hallStart, setHallStart] = useState("1");

  // Rename hall
  const [editing, setEditing] = useState<HallWithTables | null>(null);
  const [editingName, setEditingName] = useState("");

  // Add tables
  const [addingTo, setAddingTo] = useState<HallWithTables | null>(null);
  const [addCount, setAddCount] = useState("1");
  const [addStart, setAddStart] = useState("");

  // QR sheet
  const [qrOpen, setQrOpen] = useState(false);
  const [qrHall, setQrHall] = useState<string>("all");

  // Deletes
  const [toDeleteTable, setToDeleteTable] = useState<Table | null>(null);
  const [toDeleteHall, setToDeleteHall] = useState<HallWithTables | null>(null);
  const [deleteHallTables, setDeleteHallTables] = useState(false);
  const [toRenameTable, setToRenameTable] = useState<Table | null>(null);
  const [renameTableNo, setRenameTableNo] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const headers = await authHeaders();
        setSnap((await loadFn({ headers })) as Snapshot);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [loadFn]);

  /** Runs a mutation, then refreshes the whole snapshot. */
  async function mutate(fn: () => Promise<Snapshot>, okMsg?: string) {
    setBusy(true);
    try {
      const next = await fn();
      setSnap(next);
      if (okMsg) toast.success(okMsg);
      return true;
    } catch (e) {
      toast.error((e as Error).message || "تعذر تنفيذ العملية");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function onCreateHall(e: React.FormEvent) {
    e.preventDefault();
    const ok = await mutate(async () => {
      return (await createFn({
        headers: await authHeaders(),
        data: {
          name: hallName,
          tableCount: Number(hallCount) || 0,
          startNumber: Number(hallStart) || 1,
        },
      })) as Snapshot;
    }, "تمت إضافة القاعة");
    if (ok) {
      setHallOpen(false);
      setHallName("");
      setHallCount("4");
      setHallStart("1");
    }
  }

  async function onRenameHall(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const ok = await mutate(async () => {
      return (await renameFn({
        headers: await authHeaders(),
        data: {
          hallId: editing.id,
          name: editingName,
        },
      })) as Snapshot;
    }, "تم تعديل اسم القاعة");
    if (ok) setEditing(null);
  }

  async function onAddTables(e: React.FormEvent) {
    e.preventDefault();
    if (!addingTo) return;
    const ok = await mutate(async () => {
      return (await addTablesFn({
        headers: await authHeaders(),
        data: {
          hallId: addingTo.id,
          count: Number(addCount) || 0,
          startNumber: Number(addStart) || 0,
        },
      })) as Snapshot;
    }, "تمت إضافة الطاولات");
    if (ok) setAddingTo(null);
  }

  async function onDeleteHall() {
    if (!toDeleteHall) return;
    const ok = await mutate(async () => {
      return (await deleteFn({
        headers: await authHeaders(),
        data: {
          hallId: toDeleteHall.id,
          deleteTables: deleteHallTables,
        },
      })) as Snapshot;
    }, "تم حذف القاعة");
    if (ok) {
      setToDeleteHall(null);
      setDeleteHallTables(false);
    }
  }

  async function onRenameTable(e: React.FormEvent) {
    e.preventDefault();
    if (!toRenameTable) return;
    const ok = await mutate(async () => {
      return (await renameTableFn({
        headers: await authHeaders(),
        data: {
          tableId: toRenameTable.id,
          tableNumber: Number(renameTableNo),
        },
      })) as Snapshot;
    }, "تم تعديل رقم الطاولة");
    if (ok) setToRenameTable(null);
  }

  async function onDeleteTable() {
    if (!toDeleteTable) return;
    const ok = await mutate(async () => {
      return (await deleteTableFn({
        headers: await authHeaders(),
        data: {
          tableId: toDeleteTable.id,
        },
      })) as Snapshot;
    }, "تم حذف الطاولة");
    if (ok) setToDeleteTable(null);
  }

  async function onRegenQr(table: Table) {
    await mutate(async () => {
      return (await regenQrFn({
        headers: await authHeaders(),
        data: {
          tableId: table.id,
        },
      })) as Snapshot;
    }, "تم توليد رمز QR جديد");
  }

  async function onBackfillQr() {
    await mutate(async () => {
      const headers = await authHeaders();
      return (await backfillFn({ headers })) as Snapshot;
    }, "تم تجهيز رموز QR لكل الطاولات");
  }

  const totalTables = snap.tables.length;
  const totalHalls = snap.halls.length;
  const missingQr = snap.tables.filter((t) => !t.qr_token).length;

  const qrHalls = useMemo(
    () =>
      qrHall === "all" ? snap.halls : snap.halls.filter((h) => h.id === qrHall),
    [qrHall, snap.halls],
  );

  function openAddTables(h: HallWithTables) {
    setAddingTo(h);
    setAddCount("1");
    // Continue from the highest number already in the hall.
    const max = h.tables.reduce((m, t) => Math.max(m, t.table_number ?? 0), 0);
    setAddStart(String(max + 1));
  }

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">
            <LayoutGrid className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              القاعات والطاولات
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {totalHalls} قاعة · {totalTables} طاولة — والأرقام غير محدودة
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 w-full lg:w-auto">
          <Button
            variant="outline"
            onClick={() => setQrOpen(true)}
            disabled={!totalTables}
            className="rounded-lg flex-1 lg:flex-none"
          >
            <QrCode className="ml-2 h-4 w-4" />
            الطاولات ورموز QR
          </Button>
          {missingQr > 0 && (
            <Button
              variant="outline"
              onClick={onBackfillQr}
              disabled={busy}
              className="rounded-lg flex-1 lg:flex-none"
            >
              <RefreshCw className="ml-2 h-4 w-4" />
              تجهيز رموز QR
            </Button>
          )}
          <Button
            onClick={() => setHallOpen(true)}
            disabled={busy}
            className="rounded-lg flex-1 lg:flex-none"
          >
            <Plus className="ml-2 h-4 w-4" />
            قاعة جديدة
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 text-destructive text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* ── Empty state ────────────────────────────────────────── */}
      {totalHalls === 0 ? (
        <div className="bg-card border-2 border-dashed border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-lg bg-secondary flex items-center justify-center mb-3 text-muted-foreground">
            <DoorOpen className="w-6 h-6" />
          </div>
          <p className="text-base font-semibold text-foreground">
            لم تُضِف أي قاعة بعد
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            أضف قاعة وحدّد داخلها عدد الطاولات وأرقامها، وسيظهر الكاشير يختار
            منها
          </p>
          <Button onClick={() => setHallOpen(true)} className="mt-4 rounded-lg">
            <Plus className="ml-2 h-4 w-4" />
            قاعة جديدة
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          {snap.halls.map((h) => (
            <HallCard
              key={h.id}
              hall={h}
              busy={busy}
              onAddTables={() => openAddTables(h)}
              onRename={() => {
                setEditing(h);
                setEditingName(h.name);
              }}
              onDelete={() => {
                setToDeleteHall(h);
                setDeleteHallTables(false);
              }}
              onDeleteTable={setToDeleteTable}
              onRenameTable={(t) => {
                setToRenameTable(t);
                setRenameTableNo(String(t.table_number));
              }}
              onRegenQr={onRegenQr}
            />
          ))}
        </div>
      )}

      {/* ── New hall dialog ────────────────────────────────────── */}
      <Dialog open={hallOpen} onOpenChange={setHallOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة قاعة جديدة</DialogTitle>
            <DialogDescription>
              سمِّ القاعة ثم حدّد كم طاولة تريد فيها وبأي أرقام تبدأ.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onCreateHall} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="hall-name">اسم القاعة</Label>
              <Input
                id="hall-name"
                value={hallName}
                onChange={(e) => setHallName(e.target.value)}
                placeholder="مثال: القاعة الرئيسية / قعة VIP / القاعة الخارجية"
                required
                autoFocus
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="hall-count">عدد الطاولات</Label>
                <Input
                  id="hall-count"
                  type="number"
                  min={0}
                  value={hallCount}
                  onChange={(e) => setHallCount(e.target.value)}
                  placeholder="4"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="hall-start">تبدأ من رقم</Label>
                <Input
                  id="hall-start"
                  type="number"
                  min={1}
                  value={hallStart}
                  onChange={(e) => setHallStart(e.target.value)}
                  placeholder="1"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              يمكنك وضع 0 الآن وإضافة الطاولات لاحقاً بأي عدد تريده. الأرقام لا
              تتكرر داخل نفس القاعة.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setHallOpen(false)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <Check className="w-4 h-4 ml-2" />
                )}
                إنشاء القاعة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Rename hall dialog ─────────────────────────────────── */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل اسم القاعة</DialogTitle>
          </DialogHeader>
          <form onSubmit={onRenameHall} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-hall-name">اسم القاعة</Label>
              <Input
                id="edit-hall-name"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditing(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Add tables dialog ──────────────────────────────────── */}
      <Dialog open={!!addingTo} onOpenChange={(v) => !v && setAddingTo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>إضافة طاولات — {addingTo?.name}</DialogTitle>
            <DialogDescription>
              حدّد العدد والأرقام التي تريدها. النظام يتخطّى الأرقام المستعملة
              تلقائياً.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onAddTables} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="add-count">عدد الطاولات</Label>
                <Input
                  id="add-count"
                  type="number"
                  min={1}
                  value={addCount}
                  onChange={(e) => setAddCount(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="add-start">تبدأ من رقم</Label>
                <Input
                  id="add-start"
                  type="number"
                  min={1}
                  value={addStart}
                  onChange={(e) => setAddStart(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAddingTo(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? (
                  <Loader2 className="w-4 h-4 animate-spin ml-2" />
                ) : (
                  <Plus className="w-4 h-4 ml-2" />
                )}
                إضافة
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Rename table dialog ────────────────────────────────── */}
      <Dialog
        open={!!toRenameTable}
        onOpenChange={(v) => !v && setToRenameTable(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تعديل رقم الطاولة</DialogTitle>
          </DialogHeader>
          <form onSubmit={onRenameTable} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="table-no">الرقم الجديد</Label>
              <Input
                id="table-no"
                type="number"
                min={1}
                value={renameTableNo}
                onChange={(e) => setRenameTableNo(e.target.value)}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setToRenameTable(null)}
              >
                إلغاء
              </Button>
              <Button type="submit" disabled={busy}>
                حفظ
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── QR sheet ───────────────────────────────────────────── */}
      <QrSheet
        open={qrOpen}
        onOpenChange={setQrOpen}
        halls={qrHalls}
        allHalls={snap.halls}
        selected={qrHall}
        onSelect={setQrHall}
        restaurantName={""}
      />

      {/* ── Confirm deletes ────────────────────────────────────── */}
      <AlertDialog
        open={!!toDeleteTable}
        onOpenChange={(v) => !v && setToDeleteTable(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              حذف الطاولة {toDeleteTable?.table_number}؟
            </AlertDialogTitle>
            <AlertDialogDescription>
              لن يمكن اختيارها في الكاشير بعد الآن. الطلبات السابقة لهذه الطاولة
              ستبقى لكن بدون رقم طاولة.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteTable}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!toDeleteHall}
        onOpenChange={(v) => !v && setToDeleteHall(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              حذف القاعة «{toDeleteHall?.name}»؟
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <span>
                اختر ماذا تفعل بطاولات هذه القاعة (
                {toDeleteHall?.tables.length ?? 0} طاولة):
              </span>
              <label className="flex items-start gap-2 cursor-pointer text-foreground">
                <input
                  type="radio"
                  name="hall-tables-action"
                  className="mt-1"
                  checked={!deleteHallTables}
                  onChange={() => setDeleteHallTables(false)}
                />
                <span className="text-sm">
                  نقلها إلى القاعة الرئيسية (موصى به)
                </span>
              </label>
              <label className="flex items-start gap-2 cursor-pointer text-destructive">
                <input
                  type="radio"
                  name="hall-tables-action"
                  className="mt-1"
                  checked={deleteHallTables}
                  onChange={() => setDeleteHallTables(true)}
                />
                <span className="text-sm">
                  حذف الطاولات نهائياً مع كل رموز QR الخاصة بها
                </span>
              </label>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDeleteHall}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              حذف القاعة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── One hall card ──────────────────────────────────────────────

function HallCard({
  hall,
  busy,
  onAddTables,
  onRename,
  onDelete,
  onDeleteTable,
  onRenameTable,
  onRegenQr,
}: {
  hall: HallWithTables;
  busy: boolean;
  onAddTables: () => void;
  onRename: () => void;
  onDelete: () => void;
  onDeleteTable: (t: Table) => void;
  onRenameTable: (t: Table) => void;
  onRegenQr: (t: Table) => void;
}) {
  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">
            <Building2 className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h3 className="font-bold text-foreground truncate">{hall.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              {hall.tables.length} طاولة
              {hall.is_main ? " · القاعة الافتراضية" : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={onAddTables}
            disabled={busy}
            className="rounded-lg"
          >
            <Plus className="ml-1.5 h-3.5 w-3.5" />
            طاولات
          </Button>
          {!hall.is_main && (
            <>
              <Button
                size="icon"
                variant="ghost"
                onClick={onRename}
                disabled={busy}
                aria-label="rename hall"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={onDelete}
                disabled={busy}
                aria-label="delete hall"
                className="text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {hall.tables.length === 0 ? (
        <p className="px-5 py-8 text-center text-xs text-muted-foreground">
          لا توجد طاولات في هذه القاعة بعد
        </p>
      ) : (
        <div className="p-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5">
          {hall.tables.map((t) => (
            <div
              key={t.id}
              className="group relative flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3 hover:border-primary/40 transition-colors"
            >
              <span className="w-9 h-9 rounded-lg bg-secondary text-primary flex items-center justify-center font-bold text-sm">
                {t.table_number}
              </span>
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <QrCode className="h-3 w-3" />
                {t.qr_token ? "جاهز" : "بدون رمز"}
              </span>
              <div className="absolute inset-x-1 top-1 flex justify-between opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onRenameTable(t)}
                  disabled={busy}
                  aria-label="rename table"
                  className="p-1 rounded-md bg-card/90 text-muted-foreground hover:text-primary"
                >
                  <Pencil className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onRegenQr(t)}
                  disabled={busy}
                  aria-label="regenerate qr"
                  className="p-1 rounded-md bg-card/90 text-muted-foreground hover:text-primary"
                >
                  <RefreshCw className="h-3 w-3" />
                </button>
                <button
                  onClick={() => onDeleteTable(t)}
                  disabled={busy}
                  aria-label="delete table"
                  className="p-1 rounded-md bg-card/90 text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── QR sheet ───────────────────────────────────────────────────

function QrSheet({
  open,
  onOpenChange,
  halls,
  allHalls,
  selected,
  onSelect,
  restaurantName,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  halls: HallWithTables[];
  allHalls: HallWithTables[];
  selected: string;
  onSelect: (v: string) => void;
  restaurantName: string;
}) {
  const count = halls.reduce((n, h) => n + h.tables.length, 0);

  async function downloadOne(table: Table) {
    try {
      const url = tableQrUrl(table);
      const dataUrl = await QRCode.toDataURL(url, {
        width: 900,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `table-${table.table_number}-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("تعذر إنشاء رمز QR");
    }
  }

  async function downloadAll() {
    try {
      for (const h of halls) {
        for (const t of h.tables) {
          await downloadOne(t);
          await new Promise((r) => setTimeout(r, 250));
        }
      }
      toast.success(`تم تحميل ${count} رمز QR`);
    } catch {
      toast.error("تعذر تحميل بعض الرموز");
    }
  }

  /** Opens a print-ready sheet with every code for the current filter. */
  function printAll() {
    const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8">
      <title>رموز QR للطاولات</title><style>
        @page { size: A4; margin: 10mm; }
        body { font-family: sans-serif; margin: 0; }
        h1 { font-size: 18px; text-align: center; }
        h2 { font-size: 14px; margin: 12px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
        .g { display: flex; flex-wrap: wrap; gap: 8px; }
        .c { width: 32%; border: 1px solid #ddd; border-radius: 8px; padding: 8px; text-align: center; break-inside: avoid; }
        .n { font-weight: bold; font-size: 14px; }
        .h { font-size: 10px; color: #666; margin-bottom: 4px; }
        img { width: 100%; }
      </style></head><body>
      <h1>${escapeHtml(restaurantName || "مطعم")} — رموز QR للطاولات</h1>
      ${halls
        .map(
          (h) =>
            `<h2>${escapeHtml(h.name)} (${h.tables.length})</h2><div class="g">${h.tables
              .map(
                (t) =>
                  `<div class="c"><div class="n">طاولة ${t.table_number}</div><div class="h">${escapeHtml(h.name)}</div><img src="${tableQrUrl(t)}" /></div>`,
              )
              .join("")}</div>`,
        )
        .join("")}
      <script>window.onload=()=>setTimeout(()=>window.print(),400)</script>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) {
      toast.error("الرجاء السماح بالنوافذ المنبثقة");
      return;
    }
    w.document.write(html);
    w.document.close();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>الطاولات ورموز QR</DialogTitle>
          <DialogDescription>
            {count} رمز جاهز للطباعة أو التحميل — امسح الرمز ليُفتح للعميل менيو
            الطاولة.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Hall filter */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onSelect("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                selected === "all"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:border-primary/40"
              }`}
            >
              الكل ({allHalls.reduce((n, h) => n + h.tables.length, 0)})
            </button>
            {allHalls.map((h) => (
              <button
                key={h.id}
                onClick={() => onSelect(h.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  selected === h.id
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary/40"
                }`}
              >
                {h.name} ({h.tables.length})
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={printAll}
              className="rounded-lg"
            >
              <Printer className="ml-2 h-4 w-4" />
              طباعة الكل
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={downloadAll}
              className="rounded-lg"
            >
              <Download className="ml-2 h-4 w-4" />
              تحميل الكل ({count})
            </Button>
          </div>

          {halls.map((h) => (
            <div key={h.id} className="space-y-2">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-foreground">{h.name}</h4>
                <span className="text-[11px] text-muted-foreground">
                  {h.tables.length} طاولة
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {h.tables.map((t) => (
                  <QrCard
                    key={t.id}
                    table={t}
                    hallName={h.name}
                    onDownload={downloadOne}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function QrCard({
  table,
  hallName,
  onDownload,
}: {
  table: Table;
  hallName: string;
  onDownload: (t: Table) => void;
}) {
  const url = tableQrUrl(table);

  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-baseline gap-1.5">
        <span className="text-sm font-bold text-foreground">
          طاولة {table.table_number}
        </span>
        <span className="text-[10px] text-muted-foreground truncate">
          {hallName}
        </span>
      </div>
      {table.qr_token ? (
        <QrCanvas url={url} />
      ) : (
        <div className="w-full aspect-square rounded-lg border border-dashed border-border flex items-center justify-center text-[10px] text-muted-foreground text-center px-2">
          بدون رمز — استخدم «تجهيز رموز QR»
        </div>
      )}
      <div className="w-full flex gap-1">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            navigator.clipboard.writeText(url);
            toast.success("تم نسخ الرابط");
          }}
          className="flex-1 rounded-lg h-7 px-1"
          aria-label="copy link"
        >
          <Copy className="h-3 w-3" />
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => onDownload(table)}
          className="flex-1 rounded-lg h-7 px-1"
          aria-label="download qr"
        >
          <Download className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

function QrCanvas({ url }: { url: string }) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
    })
      .then((d) => alive && setSrc(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  if (!src)
    return (
      <div className="w-full aspect-square animate-pulse rounded-lg bg-muted" />
    );
  return (
    <img
      src={src}
      alt={url}
      className="w-full aspect-square rounded-lg bg-white p-1.5 border border-border"
    />
  );
}

function tableQrUrl(table: Table): string {
  return `${appOrigin()}/r/${table.qr_token ?? ""}`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
