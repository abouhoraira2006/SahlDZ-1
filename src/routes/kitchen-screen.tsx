import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut,
  ChefHat,
  Volume2,
  VolumeX,
  Loader2,
  Bell,
  Bike,
  Phone,
  MapPin,
  Clock,
  CheckCircle2,
  UtensilsCrossed,
  PanelRightOpen,
  PanelRightClose,
  Pause,
  Play,
  Flag,
  Filter,
  History,
  Eye,
  Printer,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useServerFn } from "@tanstack/react-start";
import {
  getIndividualChefContext,
  individualChefListActive,
  individualChefStartPreparing,
  individualChefMarkReady,
  individualChefLogout,
  getPublicChefList,
} from "@/lib/individual-chef.functions";
import {
  loadKitchensSnapshot,
  resolveKitchenId,
  type Kitchen,
} from "@/lib/kitchens";
import {
  buildKitchenTicket,
  printKitchenTicket as printKitchenTicketSilent,
} from "@/lib/kitchen-print";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { notifyDriversForOrder } from "@/lib/delivery-drivers.functions";
import { decrementStockForOrder } from "@/lib/stock-consumption";
import { isPreviewToken, PREVIEW_RESTAURANT } from "@/lib/preview-mode";
import { tx } from "@/lib/ops-tx";
import { clearKioskRole } from "@/lib/kiosk-session";
import { staffLoginFailPath } from "@/lib/staff-session";
import { StaffTabs } from "@/components/staff-tabs";

export const Route = createFileRoute("/kitchen-screen")({
  component: Page,
});

type Restaurant = { id: string; name: string; logo_url: string | null };
type Order = {
  id: string;
  status: string;
  created_at: string;
  acknowledged: boolean;
  table_number: number | null;
  notes: string | null;
  order_type: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  daily_number: number | null;
  total?: number;
  chef_id?: string | null;
  chef_name?: string | null;
  started_at?: string | null;
  items: Array<{
    name: string;
    qty: number;
    note?: string | null;
    options?: Array<{ label: string; choice: string; price_delta: number }>;
    image_url?: string | null;
  }>;
};

const MOCK_KITCHEN_ORDERS: Order[] = [
  {
    id: "mock-k1",
    status: "new",
    created_at: new Date().toISOString(),
    acknowledged: false,
    table_number: 5,
    notes: null,
    order_type: "dine_in",
    customer_name: null,
    customer_phone: null,
    customer_address: null,
    daily_number: 1,
    items: [
      { name: "شاورما لحم", qty: 2, image_url: "/food/shawarma.jpg" },
      { name: "فرينش فرايز", qty: 1, image_url: "/food/fries.jpg" },
    ],
  },
  {
    id: "mock-k2",
    status: "preparing",
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    acknowledged: true,
    table_number: 12,
    notes: "بدون بصل",
    order_type: "delivery",
    customer_name: "أحمد بن علي",
    customer_phone: "0555123456",
    customer_address: "شارع الاستقلال، الجزائر",
    daily_number: 2,
    chef_id: "mock-chef1",
    chef_name: "الشيف يوسف",
    started_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
    items: [
      { name: "برغر لحم", qty: 1, image_url: "/food/burger.jpg" },
      { name: "عصير برتقال", qty: 2, image_url: "/food/orange.jpg" },
    ],
  },
  {
    id: "mock-k3",
    status: "new",
    created_at: new Date(Date.now() - 3 * 60 * 1000).toISOString(),
    acknowledged: false,
    table_number: null,
    notes: null,
    order_type: "delivery",
    customer_name: "أحمد",
    customer_phone: "0555123456",
    customer_address: "شارع الحرية",
    daily_number: 3,
    items: [
      { name: "بيتزا مارغريتا", qty: 1, image_url: "/food/pizza.jpg" },
      { name: "سلطة سيزر", qty: 1, image_url: "/food/caesar.jpg" },
    ],
  },
];

function getElapsedMinutes(iso: string) {
  return Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 60000),
  );
}

/**
 * Prints one order's slice for this kitchen.
 *
 * The order already arrives filtered to this terminal's kitchen, so the ticket
 * carries only the dishes this station cooks. On the desktop the print is
 * silent and targets the kitchen's own printer; in a browser it falls back to
 * the print dialog.
 */
async function printKitchenTicket(
  order: Order,
  restaurantName: string,
  station: Kitchen,
) {
  const html = buildKitchenTicket({
    kitchenName: station.name || restaurantName || "المطبخ",
    kitchenCode: station.code,
    orderNo: order.daily_number ?? order.id,
    orderType: order.order_type,
    tableNumber: order.table_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    customerAddress: order.customer_address,
    orderNotes: order.notes,
    createdAt: order.created_at,
    lines: (order.items ?? []).map((it) => ({
      name: it.name,
      qty: it.qty,
      note: it.note,
      options: it.options,
    })),
  });

  const res = await printKitchenTicketSilent({
    html,
    printerName: station.printer_name,
    copies: station.copies || 1,
    jobName: `k${station.code || "MAIN"}-${order.daily_number ?? order.id}`,
  });

  if (res.via === "dialog" && res.reason === "sumatra-missing") {
    toast.warning("SumatraPDF غير موجود — فُتحت نافذة الطباعة");
  } else if (res.via === "silent") {
    toast.success("تم إرسال التذكرة للطابعة");
  } else if (res.via === "dialog") {
    toast.success("تم فتح نافذة الطباعة");
  } else {
    toast.error("تعذّر طباعة التذكرة");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getTimerColor(minutes: number) {
  if (minutes < 5)
    return {
      bg: "bg-blue-50",
      border: "border-blue-300",
      text: "text-blue-600",
      dot: "bg-blue-500",
    };
  if (minutes < 10)
    return {
      bg: "bg-yellow-50",
      border: "border-yellow-300",
      text: "text-yellow-600",
      dot: "bg-yellow-500",
    };
  if (minutes < 15)
    return {
      bg: "bg-orange-50",
      border: "border-orange-300",
      text: "text-orange-600",
      dot: "bg-orange-500",
    };
  return {
    bg: "bg-red-50",
    border: "border-red-400",
    text: "text-red-600",
    dot: "bg-red-500",
  };
}

function formatElapsed(iso: string) {
  const sec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function Page() {
  const navigate = useNavigate();
  const iCtxFn = useServerFn(getIndividualChefContext);
  const iListFn = useServerFn(individualChefListActive);
  const iStartFn = useServerFn(individualChefStartPreparing);
  const iReadyFn = useServerFn(individualChefMarkReady);
  const iLogoutFn = useServerFn(individualChefLogout);
  const chefListFn = useServerFn(getPublicChefList);

  const [token, setToken] = useState<string | null>(null);
  const [chefName, setChefName] = useState<string | null>(null);
  /** Which station this terminal serves — its label and its ticket slice. */
  const [kitchenId, setKitchenId] = useState<string>("default");
  const [kitchenName, setKitchenName] = useState<string | null>(null);
  /** Printer + behaviour of the station this terminal is bound to. */
  const [station, setStation] = useState<Kitchen | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [tick, setTick] = useState(0);
  const [showSidebar, setShowSidebar] = useState(true);
  const [highlightItem, setHighlightItem] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<"all" | "dine_in" | "delivery">(
    "all",
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const [completedOrders, setCompletedOrders] = useState<Order[]>([]);
  const [pausedOrders, setPausedOrders] = useState<Set<string>>(new Set());
  const [flaggedOrders, setFlaggedOrders] = useState<Set<string>>(new Set());
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [chefs, setChefs] = useState<{ id: string; name: string }[]>([]);
  const [pendingOrder, setPendingOrder] = useState<Order | null>(null);
  const [selectedChefId, setSelectedChefId] = useState<string | null>(null);
  const prevOrderCount = useRef(0);
  const skipRefreshUntil = useRef(0);

  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const goLogin = () => {
      const r = localStorage.getItem("individual_chef_restaurant");
      const rid = r ? (JSON.parse(r) as Restaurant).id : "";
      localStorage.removeItem("individual_chef_token");
      localStorage.removeItem("individual_chef_expires");
      navigate(staffLoginFailPath(rid, "/kitchen-login"));
    };
    const it = localStorage.getItem("individual_chef_token");
    const iexp = localStorage.getItem("individual_chef_expires");
    if (!it || !iexp || new Date(iexp) < new Date()) {
      goLogin();
      return;
    }
    setToken(it);
    if (isPreviewToken(it)) {
      setRestaurant(PREVIEW_RESTAURANT);
      setChefName(localStorage.getItem("individual_chef_name"));
      setKitchenId(
        resolveKitchenId(localStorage.getItem("individual_chef_kitchen")),
      );
      return;
    }
    iCtxFn({ data: { token: it } })
      .then(async (res) => {
        setRestaurant(res.restaurant);
        setChefName(res.chefName);
        setKitchenId(res.kitchenId);
        localStorage.setItem("individual_chef_kitchen", res.kitchenId);
        // Label the terminal with the station it serves, so the chef can see
        // at a glance whether the right screen is open on this machine.
        try {
          const kk = await loadKitchensSnapshot(res.restaurant?.id);
          const mine = kk.kitchens.find(
            (k) => resolveKitchenId(k.id) === resolveKitchenId(res.kitchenId),
          );
          if (mine) {
            setStation(mine);
            setKitchenName(mine.name);
          }
        } catch {
          /* label is cosmetic; ignore */
        }
      })
      .catch(goLogin);
  }, [iCtxFn, navigate]);

  const refresh = useCallback(async () => {
    if (!token) return;
    if (Date.now() < skipRefreshUntil.current) return;
    if (isPreviewToken(token)) {
      setOrders(MOCK_KITCHEN_ORDERS);
      return;
    }
    try {
      const res = await iListFn({ data: { token } });
      setOrders(res.orders);
    } catch (e) {
      toast.error("خطأ في تحميل الطلبيات: " + (e as Error).message);
    }
  }, [token, iListFn]);

  useEffect(() => {
    if (!token || !restaurant) return;
    refresh();
    const poll = setInterval(refresh, 3000);
    return () => clearInterval(poll);
  }, [token, restaurant, refresh]);

  useEffect(() => {
    if (!token || !restaurant) return;
    if (isPreviewToken(token)) {
      setChefs([{ id: "mock-chef1", name: "الشيف يوسف" }]);
      return;
    }
    chefListFn({ data: { restaurantId: restaurant.id } })
      .then((res) => {
        if (res.found) setChefs(res.chefs);
      })
      .catch(() => {});
  }, [token, restaurant, chefListFn]);

  function openChefPicker(o: Order) {
    setPendingOrder(o);
    const lastId = localStorage.getItem("kitchen_last_chef_id");
    const sessionId = localStorage.getItem("individual_chef_id");
    setSelectedChefId(lastId || sessionId);
  }

  const selectedChef =
    chefs.find((c) => c.id === selectedChefId) ??
    chefs.find((c) => c.id === localStorage.getItem("kitchen_last_chef_id")) ??
    chefs[0] ??
    null;

  async function confirmStart() {
    if (!pendingOrder || !selectedChef) return;
    if (!token) return;
    const order = pendingOrder;
    if (isPreviewToken(token)) {
      localStorage.setItem("kitchen_last_chef_id", selectedChef.id);
      setOrders((prev) =>
        prev.map((x) =>
          x.id === order.id
            ? {
                ...x,
                status: "preparing",
                acknowledged: true,
                chef_id: selectedChef.id,
                chef_name: selectedChef.name,
                started_at: new Date().toISOString(),
              }
            : x,
        ),
      );
      setPendingOrder(null);
      return;
    }
    setBusy(order.id);
    skipRefreshUntil.current = Date.now() + 6000;
    try {
      await iStartFn({
        data: { token, orderId: order.id, chefId: selectedChef.id },
      });
      void decrementStockForOrder(order.id);
      localStorage.setItem("kitchen_last_chef_id", selectedChef.id);
      setOrders((prev) =>
        prev.map((x) =>
          x.id === order.id
            ? {
                ...x,
                status: "preparing",
                acknowledged: true,
                chef_id: selectedChef.id,
                chef_name: selectedChef.name,
                started_at: new Date().toISOString(),
              }
            : x,
        ),
      );
    } catch (e) {
      skipRefreshUntil.current = 0;
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      setPendingOrder(null);
    }
  }

  useEffect(() => {
    if (!token || isPreviewToken(token)) return;
    const id = setInterval(() => {
      const exp = localStorage.getItem("individual_chef_expires");
      if (!exp || new Date(exp) < new Date()) {
        const r = localStorage.getItem("individual_chef_restaurant");
        const rid = r ? (JSON.parse(r) as Restaurant).id : "";
        localStorage.removeItem("individual_chef_token");
        localStorage.removeItem("individual_chef_expires");
        localStorage.removeItem("individual_chef_name");
        localStorage.removeItem("individual_chef_id");
        navigate(staffLoginFailPath(rid, "/kitchen-login"));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [token]);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const hasUnack = useMemo(
    () => orders.some((o) => o.status === "new" && !o.acknowledged),
    [orders],
  );

  useEffect(() => {
    if (!soundOn || !hasUnack) return;
    let cancelled = false;
    function beep() {
      if (cancelled) return;
      try {
        if (!audioCtxRef.current) {
          const Ctx =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext })
              .webkitAudioContext;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current!;
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 800;
        osc.type = "sine";
        gain.gain.value = 0.3;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.2);
        osc.stop(ctx.currentTime + 0.22);
      } catch {
        // ignore
      }
    }
    beep();
    const i = setInterval(beep, 3000);
    return () => {
      cancelled = true;
      clearInterval(i);
    };
  }, [soundOn, hasUnack]);

  useEffect(() => {
    if (orders.length > prevOrderCount.current && prevOrderCount.current > 0) {
      toast.info("طلبية جديدة وصلت!", { duration: 4000 });
    }
    prevOrderCount.current = orders.length;
  }, [orders.length]);

  const printedOrderIds = useRef<Set<string>>(
    new Set<string>(
      JSON.parse(
        localStorage.getItem("kitchen_printed_order_ids") ?? "[]",
      ) as string[],
    ),
  );
  useEffect(() => {
    if (!restaurant || !station) return;
    // A kitchen that turned auto-print off waits for the chef to print by hand.
    if (!station.auto_print) return;
    let changed = false;
    for (const o of orders) {
      if (o.status === "new" && !printedOrderIds.current.has(o.id)) {
        printedOrderIds.current.add(o.id);
        changed = true;
        void printKitchenTicket(o, restaurant.name, station);
      }
    }
    if (changed) {
      localStorage.setItem(
        "kitchen_printed_order_ids",
        JSON.stringify([...printedOrderIds.current]),
      );
    }
  }, [orders, restaurant, station]);

  async function onReady(o: Order) {
    if (!token) return;
    setBusy(o.id);
    skipRefreshUntil.current = Date.now() + 6000;
    try {
      await iReadyFn({ data: { token, orderId: o.id } });
      if (o.order_type === "delivery" && restaurant) {
        void notifyDriversForOrder({
          data: {
            restaurantId: restaurant.id,
            orderId: o.id,
            total: Number(o.total ?? 0),
            customerName: o.customer_name,
            customerPhone: o.customer_phone,
            customerAddress: o.customer_address,
            items: (o.items ?? []).map((it: any) => ({
              name: it.name ?? "",
              quantity: it.qty ?? 1,
            })),
            dailyNumber: o.daily_number,
          },
        });
      }
      setCompletedOrders((prev) =>
        [{ ...o, status: "completed" }, ...prev].slice(0, 50),
      );
      setOrders((prev) => prev.filter((x) => x.id !== o.id));
    } catch (e) {
      skipRefreshUntil.current = 0;
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function onLogout() {
    if (token) {
      try {
        await iLogoutFn({ data: { token } });
      } catch {
        // ignore
      }
    }
    const r = localStorage.getItem("individual_chef_restaurant");
    const rid = r ? (JSON.parse(r) as Restaurant).id : "";
    localStorage.removeItem("individual_chef_token");
    localStorage.removeItem("individual_chef_expires");
    localStorage.removeItem("individual_chef_name");
    localStorage.removeItem("individual_chef_id");
    clearKioskRole("chef");
    navigate(staffLoginFailPath(rid, "/kitchen-login"));
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  const newOrders = orders.filter((o) => o.status === "new");
  const prepOrders = orders.filter((o) => o.status === "preparing");

  const filteredNewOrders = newOrders.filter(
    (o) => filterType === "all" || o.order_type === filterType,
  );
  const filteredPrepOrders = prepOrders.filter(
    (o) => filterType === "all" || o.order_type === filterType,
  );

  const allDayCounts: Record<string, number> = {};
  for (const o of orders) {
    for (const it of o.items) {
      allDayCounts[it.name] = (allDayCounts[it.name] || 0) + it.qty;
    }
  }
  const sortedAllDay = Object.entries(allDayCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div
      className="min-h-screen bg-[var(--background)] flex flex-col"
      dir="rtl"
    >
      <StaffTabs />
      {/* Header */}
      <header className="h-14 bg-[var(--card)] border-b border-[var(--border)] flex items-center justify-between px-4 md:px-6 sticky top-0 z-20">
        <div className="flex items-center gap-3 min-w-0">
          {restaurant.logo_url ? (
            <img
              src={restaurant.logo_url}
              alt={restaurant.name}
              className="w-9 h-9 rounded-lg object-cover"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] font-bold text-sm">
              {restaurant.name?.[0] ?? "M"}
            </div>
          )}
          <div className="leading-tight min-w-0">
            <div className="font-bold text-sm truncate flex items-center gap-1.5 text-[var(--foreground)]">
              <ChefHat className="w-4 h-4 text-[var(--primary)]" />
              {restaurant.name}
            </div>
            {kitchenName && (
              <div className="text-[11px] font-semibold text-[var(--primary)] truncate">
                {kitchenName}
              </div>
            )}
            {chefName && (
              <div className="text-[11px] text-[var(--muted-foreground)] truncate">
                {chefName}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Reprint a single ticket without waiting for auto-print. */}
          <Button
            variant="outline"
            size="sm"
            className="h-9"
            disabled={!station || busy !== null}
            onClick={() => {
              const target = selectedOrder ?? prepOrders[0] ?? newOrders[0];
              if (!target || !restaurant || !station)
                return toast.error("ما كاين حتى طلب للطباعة");
              void printKitchenTicket(target, restaurant.name, station);
            }}
            title="إعادة طباعة تذكرة"
          >
            <Printer className="w-4 h-4" />
            طباعة
          </Button>

          {/* Filter buttons */}
          <div className="hidden md:flex items-center gap-1 bg-[var(--muted)] rounded-lg p-1">
            {(
              [
                ["all", "الكل"],
                ["dine_in", "inside المطعم"],
                ["delivery", "توصيل"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setFilterType(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  filterType === k
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Order counts */}
          <div className="hidden md:flex items-center gap-3 me-4 text-sm">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
              <span className="text-[var(--muted-foreground)]">جديد:</span>
              <span className="font-bold text-blue-600">
                {newOrders.length}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-[var(--muted-foreground)]">تحضير:</span>
              <span className="font-bold text-orange-600">
                {prepOrders.length}
              </span>
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowCompleted((s) => !s)}
            className={`text-[var(--muted-foreground)] hover:text-[var(--foreground)] h-9 w-9 p-0 ${showCompleted ? "bg-[var(--primary)]/10 text-[var(--primary)]" : ""}`}
          >
            <History className="w-5 h-5" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowSidebar((s) => !s)}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] h-9 w-9 p-0"
          >
            {showSidebar ? (
              <PanelRightClose className="w-5 h-5" />
            ) : (
              <PanelRightOpen className="w-5 h-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSoundOn((s) => !s)}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] h-9 w-9 p-0"
          >
            {soundOn ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onLogout}
            className="text-[var(--muted-foreground)] hover:text-[var(--foreground)] h-9 w-9 p-0"
          >
            <LogOut className="w-5 h-5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Grid */}
        <main className="flex-1 p-3 md:p-4 overflow-y-auto">
          <div className="grid gap-4 md:grid-cols-2 max-w-7xl mx-auto">
            {/* New Orders */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                  <Bell className="w-5 h-5 text-blue-500" />
                  طلبات جديدة
                </h2>
                <span className="bg-blue-600 text-white rounded-lg px-2.5 py-0.5 text-sm font-bold min-w-[28px] text-center">
                  {filteredNewOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                <AnimatePresence>
                  {filteredNewOrders
                    .sort((a, b) => {
                      if (flaggedOrders.has(a.id) && !flaggedOrders.has(b.id))
                        return -1;
                      if (!flaggedOrders.has(a.id) && flaggedOrders.has(b.id))
                        return 1;
                      return (
                        new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime()
                      );
                    })
                    .map((o) => {
                      const mins = getElapsedMinutes(o.created_at);
                      const tc = getTimerColor(mins);
                      const isPaused = pausedOrders.has(o.id);
                      const isFlagged = flaggedOrders.has(o.id);
                      return (
                        <motion.div
                          key={o.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`rounded-xl border-2 p-4 space-y-3 transition-all ${tc.bg} ${tc.border} ${isFlagged ? "ring-2 ring-amber-400" : ""} ${isPaused ? "opacity-60" : ""}`}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {o.order_type === "delivery" ? (
                                <span className="bg-blue-100 text-blue-800 rounded-lg px-2.5 py-1 text-sm font-bold flex items-center gap-1.5 dark:bg-blue-900/30 dark:text-blue-300">
                                  <Bike className="w-4 h-4" />
                                  توصيل
                                </span>
                              ) : o.order_type === "takeaway" ? (
                                <span className="bg-emerald-100 text-emerald-800 rounded-lg px-2.5 py-1 text-sm font-bold flex items-center gap-1.5 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  <UtensilsCrossed className="w-4 h-4" />
                                  سفري
                                </span>
                              ) : (
                                <span className="bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg px-2.5 py-1 text-sm font-bold">
                                  طاولة {o.table_number ?? "—"}
                                </span>
                              )}
                              {o.daily_number != null && (
                                <span className="text-[var(--muted-foreground)] font-mono text-sm">
                                  #{String(o.daily_number).padStart(3, "0")}
                                </span>
                              )}
                              {isFlagged && (
                                <Flag className="w-4 h-4 text-amber-500 fill-amber-500" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setFlaggedOrders((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(o.id)) next.delete(o.id);
                                    else next.add(o.id);
                                    return next;
                                  });
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${isFlagged ? "bg-amber-100 text-amber-600" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}
                              >
                                <Flag
                                  className={`w-4 h-4 ${isFlagged ? "fill-amber-500" : ""}`}
                                />
                              </button>
                              <div
                                className={`flex items-center gap-1.5 ${tc.text} font-mono text-lg font-bold`}
                              >
                                <Clock className="w-4 h-4" />
                                {formatElapsed(o.created_at)}
                              </div>
                            </div>
                          </div>

                          {/* Customer Info (delivery) */}
                          {o.order_type === "delivery" && (
                            <div className="bg-[var(--muted)] rounded-lg p-2.5 space-y-1 text-sm">
                              <div className="font-bold text-[var(--foreground)]">
                                {o.customer_name ?? "—"}
                              </div>
                              {o.customer_phone && (
                                <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                                  <Phone className="w-3.5 h-3.5" />
                                  <a
                                    href={`tel:${o.customer_phone}`}
                                    dir="ltr"
                                    className="font-mono"
                                  >
                                    {o.customer_phone}
                                  </a>
                                </div>
                              )}
                              {o.customer_address && (
                                <div className="flex items-start gap-1.5 text-[var(--muted-foreground)]">
                                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <span className="break-words">
                                    {o.customer_address}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Items */}
                          <ul className="space-y-1.5">
                            {o.items.map((it, idx) => (
                              <li key={idx} className="flex items-center gap-3">
                                {it.image_url && (
                                  <img
                                    src={it.image_url}
                                    alt={it.name}
                                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-[var(--destructive)] font-bold text-lg">
                                      ×{it.qty}
                                    </span>
                                    <span className="text-[var(--foreground)] font-bold text-base truncate">
                                      {it.name}
                                    </span>
                                  </div>
                                  {it.options && it.options.length > 0 && (
                                    <div className="mt-0.5 space-y-0.5">
                                      {it.options.map((op, oi) => (
                                        <div
                                          key={oi}
                                          className="text-xs text-[var(--muted-foreground)]"
                                        >
                                          + {op.label}: {op.choice}
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {it.note && (
                                    <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                                      ◈ {it.note}
                                    </div>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ul>

                          {/* Notes */}
                          {o.notes && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 text-sm dark:bg-yellow-900/20 dark:border-yellow-800">
                              <div className="font-bold text-yellow-800 dark:text-yellow-300 mb-0.5 text-xs">
                                ملاحظات:
                              </div>
                              <div className="text-yellow-900 dark:text-yellow-200 whitespace-pre-wrap break-words">
                                {o.notes}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <Button
                              onClick={() => openChefPicker(o)}
                              disabled={busy === o.id || isPaused}
                              className="flex-1 h-12 text-base font-bold bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-[var(--primary-foreground)] rounded-xl"
                            >
                              {busy === o.id ? (
                                <Loader2 className="w-5 h-5 animate-spin ms-2" />
                              ) : (
                                "بدء التحضير"
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      );
                    })}
                </AnimatePresence>
                {filteredNewOrders.length === 0 && (
                  <div className="text-center text-[var(--muted-foreground)] py-12">
                    <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">لا توجد طلبات جديدة</p>
                  </div>
                )}
              </div>
            </section>

            {/* Preparing */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-bold text-[var(--foreground)] flex items-center gap-2">
                  <Clock className="w-5 h-5 text-orange-500" />
                  قيد التحضير
                </h2>
                <span className="bg-orange-500 text-white rounded-lg px-2.5 py-0.5 text-sm font-bold min-w-[28px] text-center">
                  {filteredPrepOrders.length}
                </span>
              </div>
              <div className="space-y-3">
                <AnimatePresence>
                  {filteredPrepOrders
                    .sort((a, b) => {
                      if (flaggedOrders.has(a.id) && !flaggedOrders.has(b.id))
                        return -1;
                      if (!flaggedOrders.has(a.id) && flaggedOrders.has(b.id))
                        return 1;
                      return (
                        new Date(a.created_at).getTime() -
                        new Date(b.created_at).getTime()
                      );
                    })
                    .map((o) => {
                      const mins = getElapsedMinutes(o.created_at);
                      const tc = getTimerColor(mins);
                      const isPaused = pausedOrders.has(o.id);
                      const isFlagged = flaggedOrders.has(o.id);
                      return (
                        <motion.div
                          key={o.id}
                          layout
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          className={`rounded-xl border-2 p-4 space-y-3 transition-all ${tc.bg} ${tc.border} ${isFlagged ? "ring-2 ring-amber-400" : ""} ${isPaused ? "opacity-60" : ""}`}
                        >
                          {/* Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {o.order_type === "delivery" ? (
                                <span className="bg-blue-100 text-blue-800 rounded-lg px-2.5 py-1 text-sm font-bold flex items-center gap-1.5 dark:bg-blue-900/30 dark:text-blue-300">
                                  <Bike className="w-4 h-4" />
                                  توصيل
                                </span>
                              ) : o.order_type === "takeaway" ? (
                                <span className="bg-emerald-100 text-emerald-800 rounded-lg px-2.5 py-1 text-sm font-bold flex items-center gap-1.5 dark:bg-emerald-900/30 dark:text-emerald-300">
                                  <UtensilsCrossed className="w-4 h-4" />
                                  سفري
                                </span>
                              ) : (
                                <span className="bg-orange-100 text-orange-800 rounded-lg px-2.5 py-1 text-sm font-bold dark:bg-orange-900/30 dark:text-orange-300">
                                  طاولة {o.table_number ?? "—"}
                                </span>
                              )}
                              {o.daily_number != null && (
                                <span className="text-[var(--muted-foreground)] font-mono text-sm">
                                  #{String(o.daily_number).padStart(3, "0")}
                                </span>
                              )}
                              {isFlagged && (
                                <Flag className="w-4 h-4 text-amber-500 fill-amber-500" />
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {o.chef_name && (
                                <span className="bg-orange-100 text-orange-800 rounded-lg px-2.5 py-1 text-xs font-bold flex items-center gap-1 dark:bg-orange-900/30 dark:text-orange-300">
                                  <ChefHat className="w-3.5 h-3.5" />
                                  {o.chef_name}
                                </span>
                              )}
                              <button
                                onClick={() => {
                                  setPausedOrders((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(o.id)) next.delete(o.id);
                                    else next.add(o.id);
                                    return next;
                                  });
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${isPaused ? "bg-yellow-100 text-yellow-600" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}
                              >
                                {isPaused ? (
                                  <Play className="w-4 h-4" />
                                ) : (
                                  <Pause className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={() => {
                                  setFlaggedOrders((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(o.id)) next.delete(o.id);
                                    else next.add(o.id);
                                    return next;
                                  });
                                }}
                                className={`p-1.5 rounded-lg transition-colors ${isFlagged ? "bg-amber-100 text-amber-600" : "text-[var(--muted-foreground)] hover:bg-[var(--muted)]"}`}
                              >
                                <Flag
                                  className={`w-4 h-4 ${isFlagged ? "fill-amber-500" : ""}`}
                                />
                              </button>
                              <div
                                className={`flex items-center gap-1.5 ${tc.text} font-mono text-lg font-bold`}
                              >
                                <Clock className="w-4 h-4" />
                                {formatElapsed(o.created_at)}
                              </div>
                            </div>
                          </div>

                          {/* Customer Info (delivery) */}
                          {o.order_type === "delivery" && (
                            <div className="bg-[var(--muted)] rounded-lg p-2.5 space-y-1 text-sm">
                              <div className="font-bold text-[var(--foreground)]">
                                {o.customer_name ?? "—"}
                              </div>
                              {o.customer_phone && (
                                <div className="flex items-center gap-1.5 text-[var(--muted-foreground)]">
                                  <Phone className="w-3.5 h-3.5" />
                                  <a
                                    href={`tel:${o.customer_phone}`}
                                    dir="ltr"
                                    className="font-mono"
                                  >
                                    {o.customer_phone}
                                  </a>
                                </div>
                              )}
                              {o.customer_address && (
                                <div className="flex items-start gap-1.5 text-[var(--muted-foreground)]">
                                  <MapPin className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                                  <span className="break-words">
                                    {o.customer_address}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Items */}
                          <ul className="space-y-1.5">
                            {o.items.map((it, idx) => (
                              <li key={idx} className="flex items-center gap-3">
                                {it.image_url && (
                                  <img
                                    src={it.image_url}
                                    alt={it.name}
                                    className="w-10 h-10 rounded-lg object-cover shrink-0"
                                  />
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-baseline gap-2">
                                    <span className="text-orange-600 font-bold text-lg">
                                      ×{it.qty}
                                    </span>
                                    <span className="text-[var(--foreground)] font-bold text-base truncate">
                                      {it.name}
                                    </span>
                                  </div>
                                </div>
                              </li>
                            ))}
                          </ul>

                          {/* Notes */}
                          {o.notes && (
                            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-2.5 text-sm dark:bg-yellow-900/20 dark:border-yellow-800">
                              <div className="font-bold text-yellow-800 dark:text-yellow-300 mb-0.5 text-xs">
                                ملاحظات:
                              </div>
                              <div className="text-yellow-900 dark:text-yellow-200 whitespace-pre-wrap break-words">
                                {o.notes}
                              </div>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex gap-2">
                            <Button
                              onClick={() => onReady(o)}
                              disabled={busy === o.id || isPaused}
                              className="flex-1 h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl"
                            >
                              {busy === o.id ? (
                                <Loader2 className="w-5 h-5 animate-spin ms-2" />
                              ) : (
                                <span className="flex items-center gap-2">
                                  <CheckCircle2 className="w-5 h-5" />
                                  جاهز للتقديم
                                </span>
                              )}
                            </Button>
                          </div>
                        </motion.div>
                      );
                    })}
                </AnimatePresence>
                {filteredPrepOrders.length === 0 && (
                  <div className="text-center text-[var(--muted-foreground)] py-12">
                    <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">لا توجد طلبات قيد التحضير</p>
                  </div>
                )}
              </div>
            </section>
          </div>
        </main>

        {/* All-Day Sidebar */}
        {showSidebar && (
          <aside className="w-64 bg-[var(--card)] border-r border-[var(--border)] p-4 overflow-y-auto hidden md:block">
            <h3 className="text-sm font-bold text-[var(--foreground)] mb-3 flex items-center gap-2">
              <UtensilsCrossed className="w-4 h-4 text-[var(--primary)]" />
              ملخص الأصناف (كل الطلبات)
            </h3>
            <div className="space-y-1.5">
              {sortedAllDay.length === 0 ? (
                <p className="text-[var(--muted-foreground)] text-xs">
                  لا توجد أصناف
                </p>
              ) : (
                sortedAllDay.map(([name, qty]) => (
                  <div
                    key={name}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-all cursor-pointer ${
                      highlightItem === name
                        ? "bg-[var(--primary)]/10 border border-[var(--primary)]/30"
                        : "bg-[var(--muted)] hover:bg-[var(--muted)]/80"
                    }`}
                    onClick={() =>
                      setHighlightItem(highlightItem === name ? null : name)
                    }
                  >
                    <span className="text-[var(--foreground)] truncate">
                      {name}
                    </span>
                    <span className="font-bold text-[var(--foreground)] bg-[var(--card)] border border-[var(--border)] rounded-md px-2 py-0.5 text-xs min-w-[24px] text-center">
                      {qty}
                    </span>
                  </div>
                ))
              )}
            </div>

            {/* Completed Orders */}
            <div className="mt-6 pt-4 border-t border-[var(--border)]">
              <button
                onClick={() => setShowCompleted((s) => !s)}
                className="flex items-center gap-2 text-sm font-bold text-[var(--foreground)] mb-3 w-full"
              >
                <History className="w-4 h-4 text-emerald-500" />
                الطلبات المكتملة ({completedOrders.length})
              </button>
              {showCompleted && (
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {completedOrders.length === 0 ? (
                    <p className="text-[var(--muted-foreground)] text-xs">
                      لا توجد طلبات مكتملة
                    </p>
                  ) : (
                    completedOrders.map((o) => (
                      <div
                        key={o.id}
                        className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 text-xs dark:bg-emerald-900/20 dark:border-emerald-800"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-emerald-700 dark:text-emerald-300">
                            #{o.daily_number ?? o.id.slice(0, 4)}
                          </span>
                          <span className="text-emerald-600 dark:text-emerald-400">
                            {o.order_type === "delivery"
                              ? "توصيل"
                              : o.order_type === "takeaway"
                                ? "سفري"
                                : `طاولة ${o.table_number}`}
                          </span>
                        </div>
                        <div className="text-emerald-600 dark:text-emerald-400 mt-1">
                          {o.items
                            .map((it) => `${it.qty}x ${it.name}`)
                            .join(", ")}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Summary stats */}
            <div className="mt-6 pt-4 border-t border-[var(--border)] space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">
                  إجمالي الطلبات
                </span>
                <span className="font-bold text-[var(--foreground)]">
                  {orders.length}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">
                  إجمالي الأصناف
                </span>
                <span className="font-bold text-[var(--foreground)]">
                  {Object.values(allDayCounts).reduce((a, b) => a + b, 0)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--muted-foreground)]">
                  أقدم طلبية
                </span>
                <span className="font-bold text-[var(--foreground)]">
                  {orders.length > 0
                    ? `${getElapsedMinutes(orders.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0].created_at)} د`
                    : "—"}
                </span>
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* Chef selection for starting an order on the shared kitchen computer */}
      <Dialog
        open={!!pendingOrder}
        onOpenChange={(open) => !open && setPendingOrder(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">اختر الطاهي المسؤول</DialogTitle>
            <DialogDescription>
              {pendingOrder
                ? `طلبية #${String(pendingOrder.daily_number ?? 0).padStart(3, "0")} — من يبدأ تحضير هذه الطلبية؟`
                : "من يبدأ تحضير هذه الطلبية؟"}
            </DialogDescription>
          </DialogHeader>
          {chefs.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 py-2">
              {chefs.map((c) => {
                const active = selectedChef?.id === c.id;
                return (
                  <button
                    key={c.id}
                    onClick={() => setSelectedChefId(c.id)}
                    className={`flex items-center gap-2.5 rounded-xl border-2 px-4 py-4 text-base font-bold transition-all ${
                      active
                        ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                        : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)]/50"
                    }`}
                  >
                    <ChefHat
                      className={`w-6 h-6 ${active ? "text-[var(--primary)]" : "text-[var(--muted-foreground)]"}`}
                    />
                    {c.name}
                    {active && (
                      <span className="ms-auto text-xs font-bold bg-[var(--primary)] text-[var(--primary-foreground)] rounded-md px-2 py-0.5">
                        مختار
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted-foreground)] py-4 text-center">
              لا توجد حسابات طهاة نشطة
            </p>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setPendingOrder(null)}
              className="h-12 flex-1 text-base"
            >
              إلغاء
            </Button>
            <Button
              onClick={confirmStart}
              disabled={!selectedChef || busy === pendingOrder?.id}
              className="h-12 flex-1 text-base font-bold bg-[var(--primary)] hover:bg-[var(--primary)]/90 text-[var(--primary-foreground)]"
            >
              {busy === pendingOrder?.id ? (
                <Loader2 className="w-5 h-5 animate-spin ms-2" />
              ) : (
                "تأكيد البدء"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
