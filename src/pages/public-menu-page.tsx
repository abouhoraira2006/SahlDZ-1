import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Check,
  CookingPot,
  Loader2,
  Minus,
  Phone,
  Plus,
  ScrollText,
  ShoppingBasket,
  Store,
  User,
  UtensilsCrossed,
  X,
  Bike,
  MapPin,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  getPublicOrderStatus,
  getTakeawayMenu,
  getTableMenu,
  getDeliveryMenu,
  placeTakeawayOrder,
  placeTableOrder,
  placeDeliveryOrder,
} from "@/lib/public-order.functions";
import type {
  PlaceTakeawayOrderInput,
  PlaceDeliveryOrderInput,
  PublicMenuData,
  PublicMenuItem,
  PublicOrderTrackResult,
} from "@/lib/public-order.functions";
import type { MenuOption, OptionChoice } from "@/lib/menu-options.functions";
import { formatDZD } from "@/lib/restaurant";

export type PublicMenuMode = "takeaway" | "dine_in" | "delivery";

type PickGroup = { group: MenuOption; choices: OptionChoice[] };
type CartLine = {
  key: string;
  item: PublicMenuItem;
  qty: number;
  note: string;
  picks: PickGroup[];
};

type PlacedResult = { orderId: string; dailyNumber: number; total: number };

function optionKey(itemId: string, picks: PickGroup[]) {
  const parts = picks
    .flatMap((p) => p.choices.map((c) => c.id))
    .sort()
    .join("|");
  return `${itemId}::${parts}`;
}

function lineUnitPrice(line: CartLine) {
  const delta = line.picks.reduce(
    (s, p) => s + p.choices.reduce((a, c) => a + (c.price_delta || 0), 0),
    0,
  );
  return (line.item.price || 0) + delta;
}

const STEPS: Array<{
  key: "new" | "preparing" | "ready" | "served" | "paid";
  label: string;
  icon: LucideIcon;
}> = [
  { key: "new", label: "استلام", icon: ScrollText },
  { key: "preparing", label: "تحضير", icon: CookingPot },
  { key: "ready", label: "جاهز", icon: BellRing },
  { key: "served", label: "مُسلَّم", icon: UtensilsCrossed },
  { key: "paid", label: "تسليم", icon: Check },
];

export function PublicMenuPage({
  token,
  mode,
}: {
  token: string;
  mode: PublicMenuMode;
}) {
  const [menu, setMenu] = useState<PublicMenuData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [adding, setAdding] = useState<PublicMenuItem | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [draftNote, setDraftNote] = useState("");
  const [cartOpen, setCartOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [placing, setPlacing] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PlacedResult | null>(null);
  const [track, setTrack] = useState<PublicOrderTrackResult | null>(null);

  const isDelivery = mode === "delivery";
  const isTakeaway = mode === "takeaway";
  const isDineIn = mode === "dine_in";

  useEffect(() => {
    if (!placed) {
      setTrack(null);
      return;
    }
    let cancelled = false;
    const orderId = placed.orderId;
    async function poll() {
      try {
        const res = await getPublicOrderStatus({
          data: { orderId },
        });
        if (!cancelled) setTrack(res);
      } catch {
        if (!cancelled) setTrack(null);
      }
    }
    void poll();
    const interval = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [placed]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = isDelivery
          ? await getDeliveryMenu({ data: { token } })
          : isTakeaway
            ? await getTakeawayMenu({ data: { token } })
            : await getTableMenu({ data: { token } });
        if (!cancelled) setMenu(data);
      } catch (e) {
        if (!cancelled)
          setLoadError(e instanceof Error ? e.message : "حدث خطأ غير متوقع");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [token, mode]);

  const tableNumber = isTakeaway ? null : (menu?.tableNumber ?? null);
  const tableLabel = tableNumber != null ? `طاولة ${tableNumber}` : null;

  const availableItems = useMemo(() => {
    if (!menu) return [];
    return menu.items.filter((i) => {
      if (i.is_available === false || (i as any).is_available === "false") return false;
      return true;
    });
  }, [menu]);

  const itemsByCategory = useMemo(() => {
    if (activeCategory === "all") return availableItems;
    return availableItems.filter(
      (i) => String(i.category_id ?? "").trim() === String(activeCategory).trim(),
    );
  }, [availableItems, activeCategory]);

  const cartCount = cart.reduce((s, l) => s + l.qty, 0);
  const cartTotal = cart.reduce((s, l) => s + lineUnitPrice(l) * l.qty, 0);

  function openAddSheet(item: PublicMenuItem) {
    setAdding(item);
    setDraftNote("");
    setSubmitError(null);
    const groups = menu?.optionsByItem[item.id] ?? [];
    const init: Record<string, string[]> = {};
    for (const g of groups) {
      if (g.required && g.choices.length) init[g.id] = [g.choices[0].id];
    }
    setDrafts(init);
  }

  function addToCart() {
    if (!adding) return;
    const groups = menu?.optionsByItem[adding.id] ?? [];
    const missing = groups.find(
      (g) => g.required && !(drafts[g.id] ?? []).length,
    );
    if (missing) {
      setSubmitError(`اختر خيار «${missing.name}» أولاً`);
      return;
    }
    const picks: PickGroup[] = [];
    for (const g of groups) {
      const ids = drafts[g.id] ?? [];
      if (!ids.length) continue;
      const cho = g.choices.filter((c) => ids.includes(c.id));
      if (cho.length) picks.push({ group: g, choices: cho });
    }
    const key = optionKey(adding.id, picks);
    setCart((prev) => {
      const idx = prev.findIndex((l) => l.key === key);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
        return next;
      }
      return [
        ...prev,
        { key, item: adding, qty: 1, note: draftNote.trim(), picks },
      ];
    });
    setAdding(null);
  }

  function setLineQty(index: number, qty: number) {
    setCart((prev) => {
      const next = [...prev];
      if (qty <= 0) next.splice(index, 1);
      else next[index] = { ...next[index], qty };
      return next;
    });
  }

  function sameGroupPicked(group: MenuOption, choiceId: string) {
    return (drafts[group.id] ?? []).includes(choiceId);
  }

  function toggleChoice(group: MenuOption, choiceId: string) {
    setDrafts((prev) => {
      const current = prev[group.id] ?? [];
      if (group.multi) {
        return {
          ...prev,
          [group.id]: current.includes(choiceId)
            ? current.filter((c) => c !== choiceId)
            : [...current, choiceId],
        };
      }
      return { ...prev, [group.id]: [choiceId] };
    });
  }

  function toLines() {
    return cart.map((l) => ({
      menu_item_id: l.item.id,
      name: l.item.name,
      quantity: l.qty,
      price: l.item.price || 0,
      note: l.note.trim() || null,
      options: l.picks.flatMap((p) =>
        p.choices.map((c) => ({
          label: p.group.name,
          choice: c.name,
          price_delta: c.price_delta || 0,
        })),
      ),
    }));
  }

  async function submitOrder() {
    if (!menu || !menu.restaurant) return;
    if (isDelivery) {
      if (!name.trim()) {
        setSubmitError("اكتب اسمك ليتم تجهيز طلبك");
        return;
      }
      if (!phone.trim()) {
        setSubmitError("اكتب رقم هاتفك ليتواصل معك مسؤول التوصيل");
        return;
      }
      if (!address.trim()) {
        setSubmitError("اكتب عنوان التوصيل بالتفصيل");
        return;
      }
    } else if (isTakeaway && !name.trim()) {
      setSubmitError("اكتب اسمك ليتم تجهيز طلبك");
      return;
    }
    setPlacing(true);
    setSubmitError(null);
    try {
      const common = { token, lines: toLines() };
      let result;
      if (isDelivery) {
        result = await placeDeliveryOrder({
          data: {
            ...common,
            customer_name: name.trim(),
            customer_phone: phone.trim(),
            customer_address: address.trim(),
            notes: orderNotes.trim() || null,
          } satisfies PlaceDeliveryOrderInput,
        });
      } else if (isTakeaway) {
        result = await placeTakeawayOrder({
          data: {
            ...common,
            customer_name: name.trim(),
            customer_phone: phone.trim() || null,
          } satisfies PlaceTakeawayOrderInput,
        });
      } else {
        result = await placeTableOrder({ data: common });
      }
      setPlaced({
        orderId: result.orderId,
        dailyNumber: result.dailyNumber,
        total: result.total,
      });
      setCartOpen(false);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "لم يتم إرسال الطلب");
    } finally {
      setPlacing(false);
    }
  }

  function resetOrder() {
    setPlaced(null);
    setCart([]);
    setName("");
    setPhone("");
    setAddress("");
    setOrderNotes("");
  }

  if (loading) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center gap-3 bg-background text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm">جاري تحميل القائمة…</p>
      </div>
    );
  }

  if (loadError || !menu || !menu.restaurant || !menu.enabled) {
    return (
      <div className="min-h-dvh flex items-center justify-center bg-background px-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-destructive/10 text-destructive flex items-center justify-center">
            {isDelivery ? (
              <Bike className="w-8 h-8" />
            ) : (
              <UtensilsCrossed className="w-8 h-8" />
            )}
          </div>
          <h1 className="text-xl font-bold text-foreground">
            {isDelivery
              ? "خدمة التوصيل غير متوفرة"
              : isTakeaway
                ? "الطلب السريع غير متوفر"
                : "هذه الطاولة غير متاحة"}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {loadError ||
              (menu?.restaurant && !menu.enabled
                ? isDelivery
                  ? "خدمة التوصيل معطلة حالياً لدى المطعم. يرجى التواصل مع المطعم مباشرة."
                  : "الطلب السريع معطّل حالياً عند صاحب المطعم. حاول مرة أخرى لاحقاً."
                : isDelivery
                  ? "رابط التوصيل غير صالح. يرجى طلب رابط جديد من صاحب المطعم."
                  : "الرابط غير صالح. امسح رمز QR جديداً.")}
          </p>
        </div>
      </div>
    );
  }

  if (placed) {
    const status = track?.status ?? "new";
    const currentIdx = STEPS.findIndex((s) => s.key === status);
    const readyNow = status === "ready";
    const delivered = status === "served" || status === "paid";
    const notFound = track && !track.found;

    return (
      <div className="min-h-dvh bg-background px-6 flex items-center justify-center">
        <div className="max-w-sm w-full text-center space-y-5">
          <div
            className={`w-20 h-20 mx-auto rounded-full flex items-center justify-center transition-colors ${
              readyNow
                ? "bg-amber-100 text-amber-600 animate-pulse"
                : delivered
                  ? "bg-green-100 text-green-700"
                  : "bg-primary/10 text-[var(--primary)]"
            }`}
          >
            {delivered ? (
              <Check className="w-11 h-11" />
            ) : readyNow ? (
              <BellRing className="w-11 h-11" />
            ) : (
              <Loader2 className="w-11 h-11 animate-spin" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-foreground">
              {delivered
                ? "تم التسليم"
                : readyNow
                  ? isDelivery
                    ? "طلبك جاهز وجاري التوصيل"
                    : isTakeaway
                      ? "جاهز — خذ طلبك"
                      : "طلبك جاهز"
                  : isDelivery
                    ? "تم استلام طلب التوصيل"
                    : "تم استلام طلبك"}
            </h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              {isDelivery
                ? "رقم طلبك للتوصيل"
                : isTakeaway
                  ? "رقم طلبك عند الكاشير"
                  : tableLabel
                    ? `رقم طلبك للطاولة ${tableNumber}`
                    : "رقم طلبك"}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-6 space-y-3">
            <div
              className="text-5xl font-black tracking-widest text-[var(--primary)]"
              dir="ltr"
            >
              {placed.dailyNumber.toString().padStart(3, "0")}
            </div>
            <div className="h-px bg-border" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">المجموع</span>
              <span className="font-bold text-foreground">
                {formatDZD(placed.total)}
              </span>
            </div>
          </div>

          {isDelivery && address && (
            <div className="rounded-2xl border border-border bg-card p-4 text-xs text-right space-y-1">
              <div className="font-semibold text-foreground flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-primary" />
                عنوان التوصيل:
              </div>
              <p className="text-muted-foreground leading-relaxed">{address}</p>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center">
              {STEPS.map((s, i) => {
                const active = i <= currentIdx;
                const current = i === currentIdx;
                return (
                  <Fragment key={s.key}>
                    {i > 0 && (
                      <div
                        className={`flex-1 h-0.5 rounded ${active ? "bg-[var(--primary)]" : "bg-muted"}`}
                      />
                    )}
                    <div className="flex flex-col items-center gap-1">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors ${
                          current && !delivered
                            ? "bg-primary/10 border-primary text-[var(--primary)]"
                            : active
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-primary"
                              : "bg-card border-border text-muted-foreground"
                        }`}
                      >
                        <s.icon className="w-4 h-4" />
                      </div>
                      <span
                        className={`text-[10px] font-semibold ${active ? "text-foreground" : "text-muted-foreground"}`}
                      >
                        {s.label}
                      </span>
                    </div>
                  </Fragment>
                );
              })}
            </div>
          </div>

          <p
            className={`text-sm leading-relaxed font-medium ${
              readyNow ? "text-amber-700" : "text-muted-foreground"
            }`}
          >
            {notFound
              ? "لم يتم العثور على الطلب — تواصل مع المطعم برقم طلبك."
              : status === "ready"
                ? isDelivery
                  ? "طلبك جاهز في المطبخ ومسؤول التوصيل في طريقه إليك."
                  : isTakeaway
                    ? "طلبك جاهز — توجّه إلى الكاشير واذكر رقمك لاستلامه."
                    : "طلبك جاهز — سيُحضَر إلى طاولتك."
                : status === "paid"
                  ? "تم تسليم الطلب بنجاح — نتمنى لك وجبة شهية!"
                  : isDelivery
                    ? "طلبك قيد التحضير في المطبخ الآن — سيتم إشعارك فور خروجه للتوصيل."
                    : isTakeaway
                      ? "نحن نجهّزه الآن — تتحدّث هذه الصفحة تلقائياً عندما يكون جاهزاً."
                      : "نحن نجهّزه الآن — تتحدّث هذه الصفحة تلقائياً."}
          </p>

          <button
            onClick={resetOrder}
            className="inline-flex gap-2 items-center px-5 py-2.5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-semibold text-sm"
          >
            <ShoppingBasket className="w-4 h-4" />
            طلب جديد
          </button>
        </div>
      </div>
    );
  }

  const activeGroups = adding ? (menu.optionsByItem[adding.id] ?? []) : [];

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <div className="mx-auto max-w-lg">
        <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3">
            {menu.restaurant.logo_url ? (
              <img
                src={menu.restaurant.logo_url}
                alt=""
                className="w-11 h-11 rounded-xl object-cover border border-border"
              />
            ) : (
              <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                <Store className="w-5 h-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-foreground truncate">
                {menu.restaurant.name}
              </h1>
              <p className="text-[11px] text-muted-foreground truncate">
                {isDelivery
                  ? "اطلب من بيتك وسنوصله حتى باب منزلك"
                  : isTakeaway
                    ? "اطلب بسرعة وخذ رقمك من الكاشير"
                    : "اطلب من هاتفك ونوصله لطاولتك"}
              </p>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-[11px] font-bold text-[var(--primary)] shrink-0">
              {isDelivery ? (
                <>
                  <Bike className="w-3.5 h-3.5" />
                  توصيل
                </>
              ) : isTakeaway ? (
                <>
                  <UtensilsCrossed className="w-3.5 h-3.5" />
                  سفري
                </>
              ) : (
                <>
                  <Store className="w-3.5 h-3.5" />
                  {tableLabel}
                </>
              )}
            </span>
          </div>
          {menu.categories.length > 0 && (
            <div className="px-4 pb-3 flex gap-2 overflow-x-auto">
              <Chip
                active={activeCategory === "all"}
                onClick={() => setActiveCategory("all")}
              >
                الكل
              </Chip>
              {menu.categories.map((c) => (
                <Chip
                  key={c.id}
                  active={activeCategory === c.id}
                  onClick={() => setActiveCategory(c.id)}
                >
                  {c.name}
                </Chip>
              ))}
            </div>
          )}
        </header>

        <main className="px-4 py-4 pb-40 space-y-3">
          {itemsByCategory.length === 0 && (
            <div className="text-center py-16 space-y-2 text-muted-foreground">
              <Store className="w-10 h-10 mx-auto opacity-50" />
              <p className="text-sm">لا توجد أصناف في هذا القسم</p>
            </div>
          )}
          {itemsByCategory.map((item) => {
            const inCart = cart.find((l) => l.item.id === item.id);
            return (
              <button
                key={item.id}
                onClick={() => openAddSheet(item)}
                className="w-full text-right flex items-center gap-3 rounded-2xl border border-border bg-card p-3 hover:border-primary/50 transition-colors active:scale-[0.99]"
              >
                {item.image_url ? (
                  <img
                    src={item.image_url}
                    alt=""
                    className="w-16 h-16 rounded-xl object-cover shrink-0 border border-border"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                    <UtensilsCrossed className="w-6 h-6" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-[15px] truncate">
                    {item.name}
                  </div>
                  {item.description && (
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {item.description}
                    </div>
                  )}
                  <div className="font-bold text-[15px] text-[var(--primary)] mt-1.5">
                    {formatDZD(item.price || 0)}
                  </div>
                </div>
                <span className="w-9 h-9 rounded-full bg-primary text-[var(--primary-foreground)] flex items-center justify-center shrink-0">
                  {inCart ? (
                    <span className="text-sm font-bold">{inCart.qty}</span>
                  ) : (
                    <Plus className="w-5 h-5" />
                  )}
                </span>
              </button>
            );
          })}
        </main>
      </div>

      {cartCount > 0 && (
        <div className="fixed bottom-0 inset-x-0 z-30 border-t border-border bg-background/95 backdrop-blur">
          <div className="mx-auto max-w-lg flex items-center gap-3 px-4 py-3">
            <span className="relative w-11 h-11 rounded-full bg-primary/10 text-[var(--primary)] flex items-center justify-center">
              <ShoppingBasket className="w-5 h-5" />
              <span className="absolute -top-1 -left-1 min-w-[20px] h-5 px-1 rounded-full bg-primary text-[var(--primary-foreground)] text-[11px] font-bold flex items-center justify-center">
                {cartCount}
              </span>
            </span>
            <div className="flex-1 text-left">
              <div className="font-extrabold text-lg text-foreground">
                {formatDZD(cartTotal)}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {cart.length} صنف مختلف
              </div>
            </div>
            <button
              onClick={() => setCartOpen(true)}
              className="h-12 px-5 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold text-sm"
            >
              عرض السلة
            </button>
          </div>
        </div>
      )}

      {adding && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
          onClick={() => setAdding(null)}
        >
          <div
            className="w-full max-w-lg mx-auto rounded-t-3xl bg-background p-5 pb-8 max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-bold text-lg text-foreground">
                  {adding.name}
                </h3>
                <p className="text-sm font-bold text-[var(--primary)] mt-1">
                  {formatDZD(adding.price || 0)}
                </p>
              </div>
              <button
                onClick={() => setAdding(null)}
                className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {activeGroups.map((g) => (
              <div key={g.id} className="mt-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{g.name}</span>
                  {g.required && (
                    <span className="text-[10px] rounded-full bg-destructive/10 text-destructive px-2 py-0.5">
                      مطلوب
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {g.choices.map((c) => {
                    const activeC = sameGroupPicked(g, c.id);
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleChoice(g, c.id)}
                        className={`px-3.5 h-10 rounded-xl text-sm font-medium border transition-colors ${
                          activeC
                            ? "bg-primary/10 border-primary text-[var(--primary)]"
                            : "bg-card border-border text-foreground"
                        }`}
                      >
                        {c.name}
                        {c.price_delta ? (
                          <span className="text-xs opacity-80">
                            {" "}
                            (+{c.price_delta})
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <div className="mt-5">
              <label className="text-sm font-semibold">ملاحظة (اختياري)</label>
              <textarea
                value={draftNote}
                onChange={(e) => setDraftNote(e.target.value)}
                rows={2}
                placeholder="مثال: بدون بصل، إضافي حار…"
                className="mt-2 w-full rounded-xl border border-border bg-card px-3 py-2 text-sm placeholder:text-muted-foreground/60"
              />
            </div>

            {submitError && (
              <p className="mt-3 text-sm text-destructive">{submitError}</p>
            )}

            <button
              onClick={addToCart}
              className="mt-5 w-full h-12 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold text-base"
            >
              أضف إلى السلة
            </button>
          </div>
        </div>
      )}

      {cartOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 flex items-end justify-center"
          onClick={() => {
            setCartOpen(false);
            setSubmitError(null);
          }}
        >
          <div
            className="w-full max-w-lg mx-auto rounded-t-3xl bg-background p-5 pb-8 max-h-[85dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">سلتك</h3>
              <button
                onClick={() => setCartOpen(false)}
                className="w-8 h-8 rounded-full bg-muted text-muted-foreground flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {cart.map((line, i) => (
                <div
                  key={line.key}
                  className="rounded-2xl border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <Stepper
                      value={line.qty}
                      onDec={() => setLineQty(i, line.qty - 1)}
                      onInc={() => setLineQty(i, line.qty + 1)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm truncate">
                        {line.item.name}
                      </div>
                      {line.picks.length > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {line.picks
                            .flatMap((p) => p.choices.map((c) => `«${c.name}»`))
                            .join("، ")}
                        </div>
                      )}
                    </div>
                    <div className="font-bold text-sm text-[var(--primary)] shrink-0">
                      {formatDZD(lineUnitPrice(line) * line.qty)}
                    </div>
                  </div>
                  <input
                    value={line.note}
                    onChange={(e) =>
                      setCart((prev) =>
                        prev.map((l, idx) =>
                          idx === i ? { ...l, note: e.target.value } : l,
                        ),
                      )
                    }
                    placeholder="ملاحظة لهذا الصنف…"
                    className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60"
                  />
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-3">
              {(isTakeaway || isDelivery) && (
                <>
                  <label className="block">
                    <span className="text-sm font-semibold flex items-center gap-1.5">
                      <User className="w-4 h-4 text-muted-foreground" />
                      اسمك
                      <span className="text-destructive">*</span>
                    </span>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="مثال: أحمد"
                      className="mt-1.5 w-full h-11 rounded-xl border border-border bg-card px-3 text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm font-semibold flex items-center gap-1.5">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      رقم الهاتف
                      {isDelivery ? (
                        <span className="text-destructive">*</span>
                      ) : (
                        <span className="text-xs text-muted-foreground font-normal">
                          (اختياري)
                        </span>
                      )}
                    </span>
                    <input
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="0650 00 00 00"
                      inputMode="tel"
                      dir="ltr"
                      className="mt-1.5 w-full h-11 rounded-xl border border-border bg-card px-3 text-sm text-left"
                    />
                  </label>
                  {isDelivery && (
                    <>
                      <label className="block">
                        <span className="text-sm font-semibold flex items-center gap-1.5">
                          <MapPin className="w-4 h-4 text-muted-foreground" />
                          عنوان التوصيل بالتفصيل
                          <span className="text-destructive">*</span>
                        </span>
                        <input
                          value={address}
                          onChange={(e) => setAddress(e.target.value)}
                          placeholder="مثال: حي النور، عمارة 12، الطابق 2"
                          className="mt-1.5 w-full h-11 rounded-xl border border-border bg-card px-3 text-sm"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm font-semibold flex items-center gap-1.5">
                          <ScrollText className="w-4 h-4 text-muted-foreground" />
                          ملاحظة للطلب أو السائق
                          <span className="text-xs text-muted-foreground font-normal">
                            (اختياري)
                          </span>
                        </span>
                        <input
                          value={orderNotes}
                          onChange={(e) => setOrderNotes(e.target.value)}
                          placeholder="مثال: بدون بصل، أو يرجى الاتصال عند الوصول"
                          className="mt-1.5 w-full h-11 rounded-xl border border-border bg-card px-3 text-sm"
                        />
                      </label>
                    </>
                  )}
                </>
              )}
            </div>

            {submitError && (
              <p className="mt-3 text-sm text-destructive">{submitError}</p>
            )}

            <button
              onClick={submitOrder}
              disabled={placing}
              className="mt-5 w-full h-12 rounded-xl bg-[var(--primary)] text-[var(--primary-foreground)] font-bold text-base flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {placing ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <ScrollText className="w-5 h-5" />
              )}
              {placing
                ? "جاري إرسال الطلب…"
                : `أرسل الطلب · ${formatDZD(cartTotal)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`h-9 px-4 rounded-full text-sm font-semibold whitespace-nowrap border transition-colors ${
        active
          ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-primary"
          : "bg-card text-muted-foreground border-border"
      }`}
    >
      {children}
    </button>
  );
}

function Stepper({
  value,
  onDec,
  onInc,
}: {
  value: number;
  onDec: () => void;
  onInc: () => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1 shrink-0">
      <button
        onClick={onInc}
        className="w-7 h-7 rounded-full bg-primary/10 text-[var(--primary)] flex items-center justify-center"
      >
        <Plus className="w-4 h-4" />
      </button>
      <span className="w-7 text-center text-sm font-bold">{value}</span>
      <button
        onClick={onDec}
        className="w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center"
      >
        <Minus className="w-4 h-4" />
      </button>
    </div>
  );
}
