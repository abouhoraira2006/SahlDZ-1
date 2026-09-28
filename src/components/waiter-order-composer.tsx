import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  X,
  Plus,
  Minus,
  Trash2,
  Loader2,
  Search,
  ShoppingBag,
  UtensilsCrossed,
  Bike,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { waiterGetMenu, waiterCreateOrder } from "@/lib/waiter.functions";
import { isPreviewToken } from "@/lib/preview-mode";
import { DEFAULT_CATEGORIES, DEFAULT_MENU_ITEMS } from "@/lib/default-menu";
import type { MenuOption } from "@/lib/menu-options.functions";
import type {
  OrderCategory as Category,
  OrderMenuItem as MenuItem,
  OrderTableInfo as TableInfo,
  OrderHallInfo as HallInfo,
  NewOrderLine as CartLine,
} from "@/lib/order-create";
import { MAIN_HALL_ID, MAIN_HALL_NAME } from "@/lib/halls";
import { tx } from "@/lib/ops-tx";

type Props = {
  token: string;
  restaurantName: string;
  onClose: () => void;
  onCreated: () => void;
};

export function WaiterOrderComposer({
  token,
  restaurantName,
  onClose,
  onCreated,
}: Props) {
  const menuFn = useServerFn(waiterGetMenu);
  const createFn = useServerFn(waiterCreateOrder);

  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [halls, setHalls] = useState<HallInfo[]>([]);
  const [hallId, setHallId] = useState("");
  const [optionsByItem, setOptionsByItem] = useState<
    Record<string, MenuOption[]>
  >({});

  const [activeCat, setActiveCat] = useState("all");
  const [q, setQ] = useState("");
  const [orderType, setOrderType] = useState<
    "dine_in" | "takeaway" | "delivery"
  >("dine_in");
  const [tableNo, setTableNo] = useState("");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddr, setCustAddr] = useState("");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [modalItem, setModalItem] = useState<MenuItem | null>(null);
  const [modalSel, setModalSel] = useState<Record<string, string[]>>({});

  const isPreview = isPreviewToken(token);

  useEffect(() => {
    if (isPreview) {
      setCategories(
        DEFAULT_CATEGORIES.map((c) => ({
          id: c.id,
          name: c.name,
          display_order: c.display_order,
        })),
      );
      setItems(
        DEFAULT_MENU_ITEMS.map((i) => ({
          id: i.id,
          name: i.name,
          description: i.description ?? null,
          price: i.price,
          category_id: i.category_id,
          image_url: i.image_url ?? null,
          is_available: i.is_available,
        })),
      );
      setTables(
        [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: `tbl-${n}`,
          table_number: n,
          hall_id: null,
          hall_name: MAIN_HALL_NAME,
        })),
      );
      setHalls([{ id: MAIN_HALL_ID, name: MAIN_HALL_NAME, table_count: 8 }]);
      setLoading(false);
      return;
    }
    setLoading(true);
    menuFn({ data: { token } })
      .then((res) => {
        setCategories(res.categories as Category[]);
        setItems(
          (res.items as MenuItem[]).filter((i) => i.is_available !== false),
        );
        setTables(res.tables as TableInfo[]);
        setHalls((res.halls ?? []) as HallInfo[]);
        setOptionsByItem(res.optionsByItem as Record<string, MenuOption[]>);
      })
      .catch((e) =>
        toast.error((e as Error).message || tx("تعذّر تحميل قائمة الطعام")),
      )
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, isPreview]);

  // Default the hall to the one holding the most tables.
  useEffect(() => {
    if (!halls.length) return;
    setHallId((cur) => {
      if (cur && halls.some((h) => h.id === cur)) return cur;
      return (
        halls.slice().sort((a, b) => b.table_count - a.table_count)[0]?.id ?? ""
      );
    });
  }, [halls]);

  const visibleItems = useMemo(() => {
    let list = items;
    if (activeCat !== "all")
      list = list.filter((i) => i.category_id === activeCat);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(s) ||
          (i.description ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [items, activeCat, q]);

  const totalItems = cart.reduce((s, l) => s + (l.quantity || 0), 0);
  const total = cart.reduce((s, l) => {
    const opt = (l.options ?? []).reduce((a, o) => a + (o.price_delta || 0), 0);
    return s + ((l.price || 0) + opt) * (l.quantity || 1);
  }, 0);

  function quickAdd(item: MenuItem) {
    const opts = optionsByItem[item.id] ?? [];
    if (opts.length > 0) {
      setModalItem(item);
      const init: Record<string, string[]> = {};
      for (const o of opts) {
        init[o.id] = !o.multi && o.choices.length ? [o.choices[0].id] : [];
      }
      setModalSel(init);
      return;
    }
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.menu_item_id === item.id && !l.note && !l.options?.length,
      );
      if (existing) {
        return prev.map((l) =>
          l === existing ? { ...l, quantity: l.quantity + 1 } : l,
        );
      }
      return [
        ...prev,
        {
          menu_item_id: item.id,
          name: item.name,
          price: item.price,
          quantity: 1,
        },
      ];
    });
  }

  function confirmConfigure() {
    if (!modalItem) return;
    const opts = optionsByItem[modalItem.id] ?? [];
    const lines: Array<{ label: string; choice: string; price_delta: number }> =
      [];
    for (const o of opts) {
      for (const cid of modalSel[o.id] ?? []) {
        const c = o.choices.find((x) => x.id === cid);
        if (c)
          lines.push({
            label: o.name,
            choice: c.name,
            price_delta: c.price_delta ?? 0,
          });
      }
    }
    setCart((prev) => [
      ...prev,
      {
        menu_item_id: modalItem.id,
        name: modalItem.name,
        price: modalItem.price,
        quantity: 1,
        options: lines,
      },
    ]);
    setModalItem(null);
  }

  function changeQty(idx: number, delta: number) {
    setCart((prev) =>
      prev.map((l, i) =>
        i === idx ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l,
      ),
    );
  }

  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  async function send() {
    if (!cart.length) return toast.error(tx("أضف صنفاً واحداً على الأقل"));
    if (orderType === "dine_in" && !tableNo)
      return toast.error(tx("حدد رقم الطاولة"));
    setSending(true);
    try {
      if (isPreview) {
        toast.success(
          tx("تم إرسال الطلب للمطبخ (وضع المعاينة) — رقم: ") +
            Math.floor(Math.random() * 900 + 100),
        );
      } else {
        const res = await createFn({
          data: {
            token,
            order_type: orderType,
            table_number: orderType === "dine_in" ? Number(tableNo) : undefined,
            // The same number can exist in several halls, so pin the hall.
            hall_id: orderType === "dine_in" ? hallId : undefined,
            customer_name: orderType === "delivery" ? custName : undefined,
            customer_phone: orderType === "delivery" ? custPhone : undefined,
            customer_address: orderType === "delivery" ? custAddr : undefined,
            notes: notes || undefined,
            lines: cart,
          },
        });
        toast.success(
          tx("تم إرسال الطلب للمطبخ — رقم: ") +
            String(res.dailyNumber).padStart(3, "0"),
        );
      }
      onCreated();
      onClose();
    } catch (e) {
      toast.error((e as Error).message || tx("فشل إرسال الطلب"));
    } finally {
      setSending(false);
    }
  }

  const cartPanel = (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-border">
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              { v: "dine_in", label: tx("محلي"), Icon: UtensilsCrossed },
              { v: "takeaway", label: tx("سفري"), Icon: ShoppingBag },
              { v: "delivery", label: tx("توصيل"), Icon: Bike },
            ] as const
          ).map(({ v, label, Icon }) => (
            <button
              key={v}
              onClick={() => setOrderType(v)}
              className={`flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-bold border transition-colors ${
                orderType === v
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border hover:bg-muted"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
        {orderType === "dine_in" && (
          <div className="mt-2 space-y-2">
            {halls.length > 1 && (
              <div>
                <Label className="text-xs">{tx("القاعة")}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {halls.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => {
                        setHallId(h.id);
                        setTableNo("");
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                        hallId === h.id
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {h.name}
                      <span className="opacity-60 text-[10px]">
                        {" "}
                        ({h.table_count})
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Label className="text-xs">{tx("رقم الطاولة")}</Label>
              <HallTables
                tables={tables}
                hallId={hallId}
                value={tableNo}
                onChange={setTableNo}
              />
            </div>
          </div>
        )}
        {orderType === "delivery" && (
          <div className="mt-2 space-y-2">
            <Input
              placeholder={tx("اسم العميل")}
              value={custName}
              onChange={(e) => setCustName(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder={tx("الهاتف")}
              value={custPhone}
              onChange={(e) => setCustPhone(e.target.value)}
              className="h-9"
            />
            <Input
              placeholder={tx("العنوان")}
              value={custAddr}
              onChange={(e) => setCustAddr(e.target.value)}
              className="h-9"
            />
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {cart.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground py-8">
            {tx("السلة فارغة")}
          </div>
        ) : (
          cart.map((l, idx) => (
            <div
              key={idx}
              className="rounded-lg border border-border p-2 space-y-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold truncate">{l.name}</span>
                <span className="text-sm font-bold text-primary whitespace-nowrap">
                  {(
                    ((l.price || 0) +
                      (l.options ?? []).reduce(
                        (a, o) => a + (o.price_delta || 0),
                        0,
                      )) *
                    l.quantity
                  ).toLocaleString("ar-DZ")}{" "}
                  {tx("دج")}
                </span>
              </div>
              {(l.options ?? []).length > 0 && (
                <div className="text-[10px] text-muted-foreground">
                  {(l.options ?? [])
                    .map((o) => `${o.label}: ${o.choice}`)
                    .join(" · ")}
                </div>
              )}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => changeQty(idx, -1)}
                    className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <span className="w-7 text-center text-sm font-bold">
                    {l.quantity}
                  </span>
                  <button
                    onClick={() => changeQty(idx, 1)}
                    className="w-7 h-7 rounded-md border border-border flex items-center justify-center hover:bg-muted"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
                <button
                  onClick={() => removeLine(idx)}
                  className="text-destructive hover:bg-destructive/10 rounded-md p-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t border-border space-y-2">
        <Input
          placeholder={tx("ملاحظات على الطلب (اختياري)")}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="h-9"
        />
        <div className="flex items-center justify-between text-sm font-bold">
          <span>{tx("الإجمالي")}</span>
          <span className="text-primary text-base">
            {total.toLocaleString("ar-DZ")} {tx("دج")}
          </span>
        </div>
        <Button
          onClick={send}
          disabled={sending}
          className="w-full h-11 font-bold gap-2"
        >
          {sending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <CheckCircle2 className="w-4 h-4" />
          )}
          {tx("إرسال للمطبخ")} ({totalItems})
        </Button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col" dir="rtl">
      <header className="h-14 shrink-0 bg-card border-b border-border flex items-center justify-between px-4">
        <div className="min-w-0">
          <div className="font-bold text-sm">{tx("طلب جديد")}</div>
          <div className="text-[11px] text-muted-foreground truncate">
            {restaurantName}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCart(true)}
            className="lg:hidden relative flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-sm font-bold"
          >
            <ShoppingBag className="w-4 h-4" />
            {totalItems}
          </button>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="gap-1"
          >
            <X className="w-4 h-4" /> {tx("إغلاق")}
          </Button>
        </div>
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="w-4 h-4 absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={tx("ابحث عن صنف…")}
                className="ps-9 h-9"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              <button
                onClick={() => setActiveCat("all")}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors ${
                  activeCat === "all"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border hover:bg-muted"
                }`}
              >
                {tx("الكل")}
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setActiveCat(c.id)}
                  className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold border transition-colors ${
                    activeCat === c.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card border-border hover:bg-muted"
                  }`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : visibleItems.length === 0 ? (
              <div className="text-center text-sm text-muted-foreground py-16">
                {tx("لا توجد أصناف")}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2.5">
                {visibleItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => quickAdd(item)}
                    className="text-start rounded-xl border border-border bg-card overflow-hidden hover:border-primary transition-colors"
                  >
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-24 object-cover"
                      />
                    ) : (
                      <div className="w-full h-24 bg-muted flex items-center justify-center">
                        <UtensilsCrossed className="w-6 h-6 text-muted-foreground" />
                      </div>
                    )}
                    <div className="p-2">
                      <div className="text-sm font-bold truncate">
                        {item.name}
                      </div>
                      <div className="text-xs text-primary font-bold mt-0.5">
                        {item.price.toLocaleString("ar-DZ")} {tx("دج")}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="hidden lg:flex w-80 shrink-0 border-s border-border bg-card flex-col">
          {cartPanel}
        </aside>
      </div>

      {showCart && (
        <div
          className="lg:hidden fixed inset-0 z-50 bg-black/40"
          onClick={() => setShowCart(false)}
        >
          <div
            className="absolute inset-y-0 start-0 w-[88%] max-w-sm bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            {cartPanel}
          </div>
        </div>
      )}

      <Dialog open={!!modalItem} onOpenChange={(o) => !o && setModalItem(null)}>
        <DialogContent
          dir="rtl"
          className="max-w-md max-h-[80vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>{modalItem?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {(optionsByItem[modalItem?.id ?? ""] ?? []).map((o) => (
              <div key={o.id}>
                <div className="text-sm font-bold mb-1.5">
                  {o.name}
                  {o.required && (
                    <span className="text-destructive text-xs ms-1">*</span>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {o.choices.map((c) => {
                    const selected = (modalSel[o.id] ?? []).includes(c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() =>
                          setModalSel((prev) => {
                            const cur = prev[o.id] ?? [];
                            if (!o.multi) return { ...prev, [o.id]: [c.id] };
                            return {
                              ...prev,
                              [o.id]: selected
                                ? cur.filter((x) => x !== c.id)
                                : [...cur, c.id],
                            };
                          })
                        }
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selected
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card border-border hover:bg-muted"
                        }`}
                      >
                        {c.name}
                        {c.price_delta ? ` (+${c.price_delta})` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModalItem(null)}>
              {tx("إلغاء")}
            </Button>
            <Button onClick={confirmConfigure}>{tx("إضافة")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Tables of the selected hall. Scrolls once the hall is large, and gets a
 *  number filter so any table can be reached without hunting. */
function HallTables({
  tables,
  hallId,
  value,
  onChange,
}: {
  tables: TableInfo[];
  hallId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [q, setQ] = useState("");
  const inHall = tables.filter(
    (t) => (t.hall_id ?? MAIN_HALL_ID) === (hallId || MAIN_HALL_ID),
  );
  const pool = inHall.length ? inHall : tables;
  const needle = q.trim();
  const shown = needle
    ? pool.filter((t) => String(t.table_number).includes(needle))
    : pool;
  const lots = pool.length > 24;

  if (!pool.length) {
    return (
      <p className="text-[11px] text-muted-foreground mt-1">
        لا توجد طاولات — أضفها من إعدادات القاعات والطاولات
      </p>
    );
  }

  return (
    <div className="mt-1 space-y-1.5">
      {lots && (
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx("رقم الطاولة…")}
          inputMode="numeric"
          className="h-7 w-24 text-xs"
        />
      )}
      <div
        className={
          lots
            ? "flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto pl-1"
            : "flex flex-wrap gap-1.5"
        }
      >
        {shown.map((t) => (
          <button
            key={t.id}
            onClick={() => onChange(String(t.table_number))}
            className={
              "w-9 h-9 rounded-lg text-sm font-bold border shrink-0 transition-colors " +
              (value === String(t.table_number)
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border hover:bg-muted")
            }
          >
            {t.table_number}
          </button>
        ))}
      </div>
    </div>
  );
}
