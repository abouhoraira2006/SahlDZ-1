import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  LogOut,
  Search,
  CheckCircle2,
  Loader2,
  Calculator,
  Receipt,
  Printer,
  FileBarChart,
  X,
  Plus,
  ShoppingCart,
  Minus,
  UtensilsCrossed,
  Send,
  Trash2,
  Timer,
  LayoutGrid,
  ChevronLeft,
  Bike,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useServerFn } from "@tanstack/react-start";
import {
  getCashierContext,
  cashierLookupTable,
  cashierMarkPaid,
  cashierLogout,
  cashierListReady,
  cashierListActiveOrders,
  cashierZReport,
  cashierGetMenu,
  cashierCreateOrder,
  type ZReport,
  type CashierPaymentMode,
  type CashierPaymentInput,
  type CashierMenuItem,
  type CashierCategory,
  type CashierTableInfo,
  type CashierHallInfo,
  type CashierNewOrderLine,
  type ReadyOrder,
  type CashierPaymentOutcome,
} from "@/lib/cashier.functions";
import { type MenuOption } from "@/lib/menu-options.functions";
import { buildDefaultCashierMenu } from "@/lib/default-menu";
import { MAIN_HALL_ID, MAIN_HALL_NAME } from "@/lib/halls";
import { formatDZD } from "@/lib/restaurant";
import { isPreviewToken, PREVIEW_RESTAURANT } from "@/lib/preview-mode";
import { tx } from "@/lib/ops-tx";
import { clearKioskRole } from "@/lib/kiosk-session";
import {
  hasUnifiedStaffSessionEver,
  loadUnifiedStaffSession,
} from "@/lib/staff-session";
import { StaffTabs } from "@/components/staff-tabs";

export const Route = createFileRoute("/cashier")({
  component: Page,
});

type Restaurant = { id: string; name: string; logo_url: string | null };

/** Bounce target after a failed session check: unified login when a unified
 * session was ever started here, else the legacy cashier login. */
function cashierFailPath(rid: string): {
  to: string;
  search: { rid: string } | { r: string };
} {
  return hasUnifiedStaffSessionEver()
    ? { to: "/staff-login", search: { rid } }
    : { to: "/cashier-login", search: { r: rid } };
}

function fmtOrderNo(n: number | null | undefined): string {
  return n != null ? String(n).padStart(3, "0") : "—";
}

type LocalSale = {
  daily_number: number | null;
  table_number: number | null;
  order_type: string;
  mode: string;
  total: number;
  paid: number;
  debt: number;
  discount: number;
  at: string;
};

function localSalesKey(): string {
  const d = new Date();
  const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `sahlz_cashier_sales_${k}`;
}

function loadLocalSales(): LocalSale[] {
  try {
    return JSON.parse(
      localStorage.getItem(localSalesKey()) ?? "[]",
    ) as LocalSale[];
  } catch {
    return [];
  }
}

function recordLocalSale(o: ReadyOrder, out: CashierPaymentOutcome) {
  const arr = loadLocalSales();
  arr.push({
    daily_number: o.daily_number,
    table_number: o.table_number,
    order_type: o.order_type ?? "dine_in",
    mode: out.mode,
    total: o.total,
    paid: out.paid,
    debt: out.debt,
    discount: out.discount,
    at: new Date().toISOString(),
  });
  localStorage.setItem(localSalesKey(), JSON.stringify(arr));
}

function buildLocalZReport(): ZReport {
  const sales = loadLocalSales();
  const byType: ZReport["byType"] = {
    dine_in: { count: 0, revenue: 0 },
    takeaway: { count: 0, revenue: 0 },
    delivery: { count: 0, revenue: 0 },
  };
  let totalRevenue = 0;
  let totalOrders = 0;
  for (const s of sales) {
    const t = (s.order_type as keyof ZReport["byType"]) ?? "dine_in";
    totalRevenue += s.paid;
    totalOrders++;
    if (byType[t]) {
      byType[t].count++;
      byType[t].revenue += s.paid;
    }
  }
  return {
    dayKey: localSalesKey().replace("sahlz_cashier_sales_", ""),
    totalRevenue,
    totalOrders,
    avgTicket: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    byType,
    unpaidCount: 0,
    unpaidTotal: 0,
  };
}

const MOCK_READY_ORDERS: ReadyOrder[] = [
  {
    id: "mock-r1",
    total: 2500,
    created_at: new Date().toISOString(),
    table_number: 5,
    daily_number: 1,
    order_type: "dine_in",
    items: [
      { name: "شاورما لحم", qty: 2, price: 800 },
      { name: "فرينش فرايز", qty: 1, price: 450 },
      { name: "شاي بالنعناع", qty: 2, price: 150 },
    ],
  },
];

function Page() {
  const navigate = useNavigate();
  const ctxFn = useServerFn(getCashierContext);
  const lookupFn = useServerFn(cashierLookupTable);
  const markFn = useServerFn(cashierMarkPaid);
  const logoutFn = useServerFn(cashierLogout);
  const listReadyFn = useServerFn(cashierListReady);
  const listActiveFn = useServerFn(cashierListActiveOrders);

  const [token, setToken] = useState<string | null>(null);
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null);
  const [readyOrders, setReadyOrders] = useState<ReadyOrder[]>([]);
  const [activeOrders, setActiveOrders] = useState<ReadyOrder[]>([]);
  const [view, setView] = useState<"pos" | "tracking">("pos");
  const [searchTable, setSearchTable] = useState("");
  const [searching, setSearching] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    amount: number;
    table: number | null;
    payment?: CashierPaymentOutcome;
  } | null>(null);
  const [lastPaid, setLastPaid] = useState<ReadyOrder | null>(null);
  const [payTarget, setPayTarget] = useState<ReadyOrder | null>(null);
  const [payMode, setPayMode] = useState<CashierPaymentMode>("full");
  const [payAmount, setPayAmount] = useState("");
  const [payRemainder, setPayRemainder] = useState<"debt" | "discount">("debt");
  const zFn = useServerFn(cashierZReport);
  const [zReport, setZReport] = useState<ZReport | null>(null);
  const [zLoading, setZLoading] = useState(false);
  const [showReady, setShowReady] = useState(false);
  // "all" | "delivery" | `table:<table_number>` — delivery orders have no table.
  const [payScope, setPayScope] = useState<string>("all");

  const readyTableNumbers = [
    ...new Set(readyOrders.map((o) => o.table_number).filter(Boolean)),
  ] as number[];
  const readyDeliveryCount = readyOrders.filter(
    (o) => o.order_type === "delivery",
  ).length;
  const filteredPayOrders =
    payScope === "all"
      ? readyOrders
      : payScope === "delivery"
        ? readyOrders.filter((o) => o.order_type === "delivery")
        : readyOrders.filter(
            (o) => o.table_number === Number(payScope.replace("table:", "")),
          );

  const prevReadyCount = useRef(readyOrders.length);
  const skipRefreshUntil = useRef(0);
  useEffect(() => {
    if (readyOrders.length > prevReadyCount.current) {
      const newOrders = readyOrders.slice(
        0,
        readyOrders.length - prevReadyCount.current,
      );
      newOrders.forEach((o) => {
        toast.success(
          `${o.order_type === "delivery" ? tx("توصيل") : tx("طاولة")} ${
            o.order_type === "delivery"
              ? o.customer_name || tx("عميل توصيل")
              : `${o.hall_name ? o.hall_name + " / " : ""}${o.table_number ?? "—"}`
          } — ${tx("الطلب")} ${fmtOrderNo(o.daily_number)} ${tx("جاهز للتسليم!")}`,
          { duration: 6000 },
        );
      });
    }
    prevReadyCount.current = readyOrders.length;
  }, [readyOrders]);

  async function openZReport() {
    if (!token) return;
    setZLoading(true);
    try {
      if (isPreviewToken(token)) {
        setZReport(buildLocalZReport());
      } else {
        const r = await zFn({ data: { token } });
        setZReport(r);
      }
    } catch (e) {
      toast.error((e as Error).message || tx("cashierScreen.closeDayFailed"));
    } finally {
      setZLoading(false);
    }
  }

  useEffect(() => {
    const t = localStorage.getItem("cashier_token");
    const exp = localStorage.getItem("cashier_expires");
    if (!t || !exp || new Date(exp) < new Date()) {
      const r = localStorage.getItem("cashier_restaurant");
      const rid = r ? (JSON.parse(r) as Restaurant).id : "";
      localStorage.removeItem("cashier_token");
      localStorage.removeItem("cashier_expires");
      navigate(cashierFailPath(rid));
      return;
    }
    setToken(t);
    if (isPreviewToken(t)) {
      setRestaurant(PREVIEW_RESTAURANT);
      return;
    }
    ctxFn({ data: { token: t } })
      .then((res) => setRestaurant(res.restaurant))
      .catch(() => {
        localStorage.removeItem("cashier_token");
        const r = localStorage.getItem("cashier_restaurant");
        const rid = r ? (JSON.parse(r) as Restaurant).id : "";
        navigate(cashierFailPath(rid));
      });
  }, [ctxFn, navigate]);

  const refresh = useCallback(async () => {
    if (!token) return;
    if (Date.now() < skipRefreshUntil.current) return;
    if (isPreviewToken(token)) {
      setReadyOrders(MOCK_READY_ORDERS);
      return;
    }
    try {
      const [readyRes, activeRes] = await Promise.all([
        listReadyFn({ data: { token } }),
        listActiveFn({ data: { token } }),
      ]);
      setReadyOrders(readyRes.orders);
      setActiveOrders(activeRes.orders);
    } catch {
      // silent
    }
  }, [token, listReadyFn, listActiveFn]);

  useEffect(() => {
    if (!token || !restaurant) return;
    refresh();
    const poll = setInterval(refresh, 3000);
    return () => clearInterval(poll);
  }, [token, restaurant, refresh]);

  useEffect(() => {
    if (!token || isPreviewToken(token)) return;
    const id = setInterval(() => {
      const exp = localStorage.getItem("cashier_expires");
      if (!exp || new Date(exp) < new Date()) {
        localStorage.removeItem("cashier_token");
        localStorage.removeItem("cashier_expires");
        const r = localStorage.getItem("cashier_restaurant");
        const rid = r ? (JSON.parse(r) as Restaurant).id : "";
        navigate(cashierFailPath(rid));
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [token]);

  async function onSearch() {
    const num = Number(searchTable);
    if (!num || num < 1 || !token) {
      toast.error(tx("cashierScreen.invalidTableNumber"));
      return;
    }
    setSearching(true);
    try {
      const res = await lookupFn({ data: { token, tableNumber: num } });
      if (!res.orders.length) {
        toast.error(`${tx("cashierScreen.noActiveOrderForTable")} ${num}`);
      } else {
        const match = res.orders.find((o) =>
          document.getElementById(`order-${o.id}`),
        );
        if (match) {
          const el = document.getElementById(`order-${match.id}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            el.classList.add("ring-4", "ring-primary");
            setTimeout(
              () => el.classList.remove("ring-4", "ring-primary"),
              2500,
            );
          }
        } else {
          toast(
            `${tx("cashierScreen.tableLabel")} ${num}: ${res.orders.length} ${tx("cashierScreen.tablePreparing")}`,
          );
        }
      }
      setSearchTable("");
    } catch (e) {
      toast.error((e as Error).message || tx("cashierScreen.searchFailed"));
    } finally {
      setSearching(false);
    }
  }

  function openPayment(order: ReadyOrder) {
    setPayTarget(order);
    setPayMode("full");
    setPayAmount("");
    setPayRemainder("debt");
  }

  async function submitPayment() {
    if (!payTarget || !token) return;
    const order = payTarget;
    const mode = payMode;
    let payment: CashierPaymentInput = { mode };

    if (mode === "partial") {
      const amount = Number(payAmount);
      if (!Number.isFinite(amount) || amount <= 0) {
        toast.error(tx("cashierScreen.partialAmountInvalid"));
        return;
      }
      if (amount >= order.total) {
        toast.error(tx("cashierScreen.partialAmountTooHigh"));
        return;
      }
      payment = { mode, paidAmount: amount, remainderKind: payRemainder };
    }

    setPaying(order.id);
    skipRefreshUntil.current = Date.now() + 6000;
    try {
      let outcome: CashierPaymentOutcome | undefined;
      if (isPreviewToken(token)) {
        const total = order.total;
        let paid = total;
        let debt = 0;
        let discount = 0;
        if (mode === "partial") {
          paid = Number(payAmount);
          const remainder = total - paid;
          if (payRemainder === "debt") debt = remainder;
          else discount = remainder;
        } else if (mode === "debt") {
          paid = 0;
          debt = total;
        } else if (mode === "gift") {
          paid = 0;
          discount = total;
        }
        outcome = { orderId: order.id, mode, paid, debt, discount };
      } else {
        const staffSession = loadUnifiedStaffSession();
        const res = await markFn({
          data: {
            token,
            orderIds: [order.id],
            payment,
            staffId: staffSession?.staffId || undefined,
          },
        });
        outcome = res.outcomes[0];
      }
      setSuccess({
        amount: outcome?.paid ?? order.total,
        table: order.table_number,
        payment: outcome,
      });
      setLastPaid(order);
      setPayTarget(null);
      setReadyOrders((prev) => prev.filter((o) => o.id !== order.id));
      if (outcome) recordLocalSale(order, outcome);
      printReceipt(order, outcome);
      setTimeout(() => setSuccess(null), 1800);
    } catch (e) {
      skipRefreshUntil.current = 0;
      toast.error((e as Error).message || tx("cashierScreen.paymentFailed"));
    } finally {
      setPaying(null);
    }
  }

  function printReceipt(order: ReadyOrder, payment?: CashierPaymentOutcome) {
    const date = new Date(order.created_at);
    const dateStr = date.toLocaleString("ar", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const orderNo = fmtOrderNo(order.daily_number);
    const itemsHtml = order.items
      .map(
        (it) => `
        <tr>
          <td style="padding:4px 0;">${escapeHtml(it.name)}</td>
          <td style="text-align:center; padding:4px 0;">×${it.qty}</td>
          <td style="text-align:left; padding:4px 0;">${(it.price * it.qty).toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</td>
        </tr>`,
      )
      .join("");
    const modeLabel =
      payment?.mode === "full"
        ? tx("cashierScreen.modeFull")
        : payment?.mode === "partial"
          ? tx("cashierScreen.modePartial")
          : payment?.mode === "debt"
            ? tx("cashierScreen.modeDebt")
            : payment?.mode === "gift"
              ? tx("cashierScreen.modeGift")
              : null;
    const payHtml = payment
      ? `
  <div class="total muted" style="font-size:14px;">
    <span>${tx("cashierScreen.receiptMode")}</span>
    <span>${modeLabel}</span>
  </div>
  <div class="total" style="font-size:14px;">
    <span>${tx("cashierScreen.receiptPaid")}</span>
    <span>${payment.paid.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span>
  </div>
  ${
    payment.debt > 0
      ? `<div class="total muted" style="font-size:13px;">
    <span>${tx("cashierScreen.receiptDebt")}</span>
    <span>${payment.debt.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span>
  </div>`
      : ""
  }
  ${
    payment.discount > 0
      ? `<div class="total muted" style="font-size:13px;">
    <span>${tx("cashierScreen.receiptDiscount")}</span>
    <span>${payment.discount.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span>
  </div>`
      : ""
  }
  ${payment.mode === "gift" ? `<div class="center muted" style="font-size:12px; margin-top:2px;">🎁 ${tx("cashierScreen.giftRecorded")}</div>` : ""}
`
      : "";
    const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${tx("cashierScreen.receiptTitle")} - ${orderNo}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Cairo', system-ui, sans-serif; width: 72mm; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .name { font-size: 18px; font-weight: 800; }
  .muted { color: #555; font-size: 12px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .total { font-size: 16px; font-weight: 800; display: flex; justify-content: space-between; }
  .thanks { margin-top: 10px; font-size: 12px; }
</style>
</head>
<body>
  <div class="center">
    <div class="name">${escapeHtml(restaurant?.name ?? "")}</div>
    <div class="muted">${tx("cashierScreen.receiptPaymentSlip")}</div>
  </div>
  <hr />
  <div class="muted">
    <div>${tx("cashierScreen.receiptOrderNumber")} <b>${orderNo}</b></div>
    ${order.table_number != null ? `<div>${tx("cashierScreen.receiptTable")} <b>${order.table_number}</b></div>` : ""}
    <div>${tx("cashierScreen.receiptDate")} ${dateStr}</div>
  </div>
  <hr />
  <table>
    <thead>
      <tr style="border-bottom:1px solid #000;">
        <th style="text-align:right; padding:4px 0;">${tx("cashierScreen.receiptItem")}</th>
        <th style="text-align:center; padding:4px 0;">${tx("cashierScreen.receiptQuantity")}</th>
        <th style="text-align:left; padding:4px 0;">${tx("cashierScreen.receiptPrice")}</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <hr />
  <div class="total">
    <span>${tx("cashierScreen.receiptTotal")}</span>
    <span>${order.total.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span>
  </div>
  ${payHtml}
  <hr />
  <div class="center thanks">${tx("cashierScreen.receiptThanks")}</div>
  <script>
    window.onload = function() {
      window.focus();
      window.print();
      setTimeout(function(){ window.close(); }, 300);
    };
  </script>
</body>
</html>`;
    printHtml(html);
  }

  async function onLogout() {
    if (token) {
      try {
        await logoutFn({ data: { token } });
      } catch {
        // ignore
      }
    }
    const r = localStorage.getItem("cashier_restaurant");
    const rid = r ? (JSON.parse(r) as Restaurant).id : "";
    localStorage.removeItem("cashier_token");
    localStorage.removeItem("cashier_expires");
    clearKioskRole("cashier");
    navigate(cashierFailPath(rid));
  }

  if (!restaurant) {
    return (
      <div className="min-h-screen flex items-center justify-center" dir="rtl">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-[var(--background)] flex flex-col"
      dir="rtl"
    >
      <StaffTabs />
      <header className="h-14 bg-[var(--card)] border-b border-[var(--border)] flex items-center justify-between gap-3 px-3 md:px-6 sticky top-0 z-20">
        <div className="flex items-center gap-2.5 min-w-0">
          {restaurant.logo_url ? (
            <img
              src={restaurant.logo_url}
              alt={restaurant.name}
              className="w-9 h-9 rounded-lg object-cover shrink-0"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-[var(--primary)] flex items-center justify-center text-[var(--primary-foreground)] font-bold text-sm shrink-0">
              {restaurant.name?.[0] ?? "م"}
            </div>
          )}
          <div className="leading-tight min-w-0">
            <div className="font-bold text-sm truncate text-[var(--foreground)]">
              {restaurant.name}
            </div>
            <div className="text-[11px] text-[var(--muted-foreground)] flex items-center gap-1">
              <Calculator className="w-3 h-3" />
              {tx("cashierScreen.cashierLabel")}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-1 max-w-xs">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="number"
              inputMode="numeric"
              value={searchTable}
              onChange={(e) => setSearchTable(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onSearch()}
              placeholder={tx("cashierScreen.tableNumberPlaceholder")}
              className="h-9 ps-3 pe-8 text-sm"
            />
          </div>
          <Button
            onClick={onSearch}
            disabled={searching || !searchTable}
            size="sm"
            className="h-9"
          >
            {searching ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              tx("cashierScreen.search")
            )}
          </Button>
        </div>

        <div className="flex items-center gap-1.5">
          {/* View Toggle */}
          <div className="flex bg-[var(--muted)] rounded-lg p-0.5">
            <button
              onClick={() => setView("pos")}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 ${
                view === "pos"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">POS</span>
            </button>
            <button
              onClick={() => setView("tracking")}
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors flex items-center gap-1.5 relative ${
                view === "tracking"
                  ? "bg-[var(--card)] text-[var(--foreground)] shadow-sm"
                  : "text-[var(--muted-foreground)]"
              }`}
            >
              <Timer className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">التتبع</span>
              {activeOrders.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-[var(--primary)] text-[var(--primary-foreground)] text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center">
                  {activeOrders.length}
                </span>
              )}
            </button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowReady(!showReady)}
            className="gap-1.5 h-9 relative"
          >
            <Receipt className="w-4 h-4" />
            <span className="hidden sm:inline">
              {tx("cashierScreen.tabReady")}
            </span>
            {readyOrders.length > 0 && (
              <span className="absolute -top-1.5 -left-1.5 bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                {readyOrders.length}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openZReport()}
            disabled={zLoading}
            className="gap-1.5 h-9"
          >
            {zLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <FileBarChart className="w-4 h-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="gap-1.5 h-9"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
      </header>

      {/* Ready Orders Panel — Table-Based Payment */}
      <AnimatePresence>
        {showReady && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden border-b border-[var(--border)] bg-[var(--card)]"
          >
            <div className="p-4 max-w-5xl mx-auto">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-bold flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-[var(--primary)]" />
                  الدفع — اختر الطاولة
                  <span className="text-xs font-normal text-[var(--muted-foreground)]">
                    ({readyOrders.length} طلب جاهز)
                  </span>
                </h2>
                <button
                  onClick={() => setShowReady(false)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {readyOrders.length === 0 ? (
                <p className="text-xs text-[var(--muted-foreground)] text-center py-4">
                  لا توجد طلبات جاهزة للدفع
                </p>
              ) : (
                <>
                  {/* Table + delivery chips */}
                  <div className="flex gap-2 flex-wrap mb-4">
                    <button
                      onClick={() => setPayScope("all")}
                      className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors ${
                        payScope === "all"
                          ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                          : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/60"
                      }`}
                    >
                      الكل ({readyOrders.length})
                    </button>
                    {readyDeliveryCount > 0 && (
                      <button
                        onClick={() => setPayScope("delivery")}
                        className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${
                          payScope === "delivery"
                            ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                            : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/60"
                        }`}
                      >
                        <Bike className="w-4 h-4" />
                        <span>{tx("cashierScreen.delivery")}</span>
                        <span className="text-[10px] opacity-80">
                          {readyDeliveryCount}
                        </span>
                        <span className="text-[10px] opacity-70 tabular-nums">
                          {formatDZD(
                            readyOrders
                              .filter((o) => o.order_type === "delivery")
                              .reduce((s, o) => s + o.total, 0),
                          )}
                        </span>
                      </button>
                    )}
                    {readyTableNumbers.map((tn) => {
                      const count = readyOrders.filter(
                        (o) => o.table_number === tn,
                      ).length;
                      const tableTotal = readyOrders
                        .filter((o) => o.table_number === tn)
                        .reduce((s, o) => s + o.total, 0);
                      const hall = readyOrders.find(
                        (o) => o.table_number === tn,
                      )?.hall_name;
                      return (
                        <button
                          key={tn}
                          onClick={() => setPayScope(`table:${tn}`)}
                          className={`px-3 py-2 rounded-xl text-sm font-bold border transition-colors flex items-center gap-2 ${
                            payScope === `table:${tn}`
                              ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                              : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/60"
                          }`}
                        >
                          <span>
                            {hall ? `${hall} · ` : ""}
                            {tx("cashierScreen.tableLabel")} {tn}
                          </span>
                          <span className="text-[10px] opacity-80">
                            {count} {count === 1 ? "طلب" : "طلبات"}
                          </span>
                          <span className="text-[10px] opacity-70 tabular-nums">
                            {formatDZD(tableTotal)}
                          </span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Orders for selected table */}
                  <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                    {filteredPayOrders.map((o) => (
                      <div
                        key={o.id}
                        className="bg-background rounded-xl border p-3 flex flex-col gap-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {o.order_type === "delivery" ? (
                              <>
                                <Bike className="w-4 h-4 text-primary" />
                                <span className="text-sm font-bold text-primary">
                                  {tx("cashierScreen.delivery")}
                                </span>
                              </>
                            ) : (
                              <>
                                <span className="text-lg font-bold text-primary">
                                  #{o.table_number ?? "—"}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {o.hall_name
                                    ? `${o.hall_name} · ${tx("cashierScreen.tableLabel")}`
                                    : tx("cashierScreen.tableLabel")}
                                </span>
                              </>
                            )}
                          </div>
                          <span className="text-xs font-bold bg-primary/10 text-primary px-2 py-0.5 rounded-full flex items-center gap-1">
                            {fmtOrderNo(o.daily_number)}
                            {o.status === "served" && (
                              <span className="text-[10px] bg-sky-500/15 text-sky-600 dark:text-sky-400 px-1.5 py-0.5 rounded-full">
                                {tx("cashierScreen.servedBadge")}
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Delivery customer details — the driver settles with the cashier */}
                        {o.order_type === "delivery" && (
                          <div className="text-[11px] bg-muted/40 rounded-lg p-2 space-y-0.5">
                            <div className="font-bold text-foreground">
                              {o.customer_name ||
                                tx("cashierScreen.noCustomer")}
                            </div>
                            {o.customer_phone && (
                              <div
                                dir="ltr"
                                className="text-right tabular-nums"
                              >
                                {o.customer_phone}
                              </div>
                            )}
                            {o.customer_address && (
                              <div className="text-muted-foreground">
                                {o.customer_address}
                              </div>
                            )}
                            {o.notes && (
                              <div className="text-muted-foreground italic">
                                {o.notes}
                              </div>
                            )}
                            <div className="pt-1 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                              {tx("cashierScreen.unpaidPending")}
                            </div>
                          </div>
                        )}

                        <ul className="space-y-0.5 text-xs">
                          {o.items.map((it, idx) => (
                            <li key={idx} className="flex justify-between">
                              <span>
                                <span className="font-bold">×{it.qty}</span>{" "}
                                {it.name}
                              </span>
                              <span className="text-muted-foreground">
                                {formatDZD(it.price * it.qty)}
                              </span>
                            </li>
                          ))}
                        </ul>
                        <div className="flex items-center justify-between pt-1.5 border-t">
                          <span className="text-sm font-extrabold text-primary">
                            {formatDZD(o.total)}
                          </span>
                          <div className="flex gap-1.5">
                            <Button
                              onClick={() => printReceipt(o)}
                              variant="outline"
                              size="sm"
                              className="h-8 text-xs"
                            >
                              <Printer className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              onClick={() => openPayment(o)}
                              size="sm"
                              className="h-8 text-xs gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {o.order_type === "delivery"
                                ? "تحديد الدفع"
                                : tx("cashierScreen.markPaid")}
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Z Report Modal */}
      {zReport && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setZReport(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-xl w-full max-w-md p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-sm flex items-center gap-2">
                <FileBarChart className="w-4 h-4 text-[var(--primary)]" />
                {tx("cashierScreen.zReportTitle")} — {zReport.dayKey}
              </h2>
              <button
                onClick={() => setZReport(null)}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="rounded-lg bg-[var(--primary)]/10 p-4 text-center">
              <div className="text-2xl font-extrabold text-[var(--primary)] tabular-nums">
                {formatDZD(zReport.totalRevenue)}
              </div>
              <div className="text-xs text-[var(--muted-foreground)] mt-1">
                {tx("cashierScreen.dailySalesTotal")}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center">
              <div className="rounded-lg border border-[var(--border)] p-2.5">
                <div className="font-bold text-sm tabular-nums">
                  {zReport.totalOrders}
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {tx("cashierScreen.paidOrders")}
                </div>
              </div>
              <div className="rounded-lg border border-[var(--border)] p-2.5">
                <div className="font-bold text-sm tabular-nums">
                  {formatDZD(zReport.avgTicket)}
                </div>
                <div className="text-[11px] text-[var(--muted-foreground)]">
                  {tx("cashierScreen.averageTicket")}
                </div>
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              {(
                [
                  ["dine_in", tx("cashierScreen.dineIn")],
                  ["delivery", tx("cashierScreen.delivery")],
                ] as const
              ).map(([k, label]) => (
                <div
                  key={k}
                  className="flex items-center justify-between border-b border-[var(--border)] pb-1.5 last:border-0"
                >
                  <span className="text-[var(--muted-foreground)]">
                    {label}
                  </span>
                  <span className="tabular-nums">
                    {zReport.byType[k].count} {tx("cashierScreen.orderLabel")} ·{" "}
                    {formatDZD(zReport.byType[k].revenue)}
                  </span>
                </div>
              ))}
            </div>
            {zReport.unpaidCount > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300">
                {zReport.unpaidCount} {tx("cashierScreen.unpaidOrders")}{" "}
                {formatDZD(zReport.unpaidTotal)}
              </div>
            )}
            <div className="flex gap-2">
              <Button
                className="flex-1 gap-1.5 h-9 text-xs"
                onClick={() => printZReport(zReport, restaurant.name)}
              >
                <Printer className="w-4 h-4" />
                {tx("cashierScreen.print")}
              </Button>
              <Button
                variant="outline"
                className="flex-1 h-9 text-xs"
                onClick={() => setZReport(null)}
              >
                {tx("cashierScreen.close")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Options Modal */}
      <AnimatePresence>
        {payTarget && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => paying === null && setPayTarget(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 8 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[var(--card)] border border-[var(--border)] rounded-xl w-full max-w-md p-5 space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-bold text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
                  {tx("cashierScreen.choosePaymentMethod")}
                </h2>
                <button
                  onClick={() => setPayTarget(null)}
                  className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="rounded-lg bg-[var(--primary)]/10 p-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-[var(--muted-foreground)]">
                    #{payTarget.table_number ?? "—"} ·{" "}
                    {tx("cashierScreen.receiptOrderNumber")}{" "}
                    {fmtOrderNo(payTarget.daily_number)}
                  </span>
                  <span className="font-extrabold text-[var(--primary)] tabular-nums">
                    {formatDZD(payTarget.total)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["full", tx("cashierScreen.paymentFull")],
                    ["partial", tx("cashierScreen.paymentPartial")],
                    ["debt", tx("cashierScreen.paymentDebt")],
                    ["gift", tx("cashierScreen.paymentGift")],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPayMode(key)}
                    className={`rounded-lg border p-3 text-start transition ${
                      payMode === key
                        ? "border-[var(--primary)] bg-[var(--primary)]/10"
                        : "border-[var(--border)] hover:border-[var(--primary)]/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-xs">{label}</span>
                      {payMode === key && (
                        <CheckCircle2 className="w-4 h-4 text-[var(--primary)]" />
                      )}
                    </div>
                    <div className="text-[11px] text-[var(--muted-foreground)] mt-1">
                      {key === "full" && tx("cashierScreen.paymentFullHint")}
                      {key === "partial" &&
                        tx("cashierScreen.paymentPartialHint")}
                      {key === "debt" && tx("cashierScreen.paymentDebtHint")}
                      {key === "gift" && tx("cashierScreen.paymentGiftHint")}
                    </div>
                  </button>
                ))}
              </div>

              {payMode === "partial" && (
                <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                  <div>
                    <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                      {tx("cashierScreen.paymentPaidAmount")}
                    </label>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      className="h-9 text-sm"
                      placeholder={tx("cashierScreen.paymentPaidPlaceholder")}
                      value={payAmount}
                      onChange={(e) => setPayAmount(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--muted-foreground)] mb-1">
                      {tx("cashierScreen.paymentRemainderAs")}
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(["debt", "discount"] as const).map((kind) => (
                        <button
                          key={kind}
                          type="button"
                          onClick={() => setPayRemainder(kind)}
                          className={`rounded-lg border px-3 py-2 text-xs font-bold transition ${
                            payRemainder === kind
                              ? "border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--primary)]"
                              : "border-[var(--border)] text-[var(--muted-foreground)]"
                          }`}
                        >
                          {kind === "debt"
                            ? tx("cashierScreen.remainderDebt")
                            : tx("cashierScreen.remainderDiscount")}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <Button
                  onClick={submitPayment}
                  disabled={paying !== null}
                  className="flex-1 gap-1.5 h-10 text-sm"
                >
                  {paying !== null ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {tx("cashierScreen.paymentConfirm")}
                </Button>
                <Button
                  variant="outline"
                  className="h-10 text-sm"
                  onClick={() => setPayTarget(null)}
                  disabled={paying !== null}
                >
                  {tx("cashierScreen.paymentCancel")}
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 p-3 md:p-4">
        <div className="max-w-6xl mx-auto">
          {view === "pos" ? (
            <NewOrderView
              token={token}
              restaurantName={restaurant.name}
              onCreated={() => {
                skipRefreshUntil.current = Date.now() + 6000;
                refresh();
              }}
            />
          ) : (
            <OrderTrackingView token={token} orders={activeOrders} />
          )}
        </div>
      </main>

      {/* Success Overlay */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          >
            <motion.div
              initial={{ scale: 0.8, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-background rounded-3xl p-8 text-center space-y-3 shadow-2xl"
            >
              <div className="mx-auto w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle2 className="w-12 h-12 text-green-600" />
              </div>
              <h2 className="text-2xl font-bold text-green-700">
                {tx("cashierScreen.paymentSuccess")}
              </h2>
              <p className="text-lg font-bold">
                {success.table != null && (
                  <>
                    {tx("cashierScreen.tableLabel")} {success.table} -{" "}
                  </>
                )}
                {formatDZD(success.amount)}
              </p>
              {success.payment && success.payment.mode !== "full" && (
                <div className="text-sm font-bold text-[var(--primary)]">
                  {success.payment.mode === "partial" &&
                    (success.payment.debt > 0
                      ? tx("cashierScreen.debtRecorded")
                      : tx("cashierScreen.discountRecorded"))}
                  {success.payment.mode === "debt" &&
                    tx("cashierScreen.debtRecorded")}
                  {success.payment.mode === "gift" &&
                    tx("cashierScreen.giftRecorded")}
                </div>
              )}
              {success.payment && success.payment.debt > 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">
                  {tx("cashierScreen.receiptDebt")}{" "}
                  {formatDZD(success.payment.debt)}
                </p>
              )}
              {success.payment && success.payment.discount > 0 && (
                <p className="text-sm text-[var(--muted-foreground)]">
                  {tx("cashierScreen.receiptDiscount")}{" "}
                  {formatDZD(success.payment.discount)}
                </p>
              )}
              {lastPaid && (
                <Button
                  onClick={() => printReceipt(lastPaid, success.payment)}
                  className="w-full h-11 mt-2"
                >
                  <Printer className="w-4 h-4 ms-2" />
                  {tx("cashierScreen.printReceiptForCustomer")}
                </Button>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type NewOrderTicket = {
  orderNo: number;
  total: number;
  created_at: string;
  order_type: string;
  table_number: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_address: string | null;
  notes: string | null;
  lines: CashierNewOrderLine[];
};

function printOrderTicket(
  t: NewOrderTicket,
  restaurantName: string,
  title: string,
) {
  const date = new Date(t.created_at);
  const dateStr = date.toLocaleString("ar", {
    dateStyle: "short",
    timeStyle: "short",
  });
  const orderNo = String(t.orderNo).padStart(3, "0");
  const itemsHtml = t.lines
    .map(
      (it) => `
        <tr>
          <td style="padding:4px 0;">
            <div>${escapeHtml(it.name)}</div>
            ${(it.options ?? []).map((o) => `<div style="font-size:11px;color:#555;">+ ${escapeHtml(o.label)}: ${escapeHtml(o.choice)}${o.price_delta ? ` (${o.price_delta.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")})` : ""}</div>`).join("")}
            ${it.note ? `<div style="font-size:11px;color:#555;">◈ ${escapeHtml(it.note)}</div>` : ""}
          </td>
          <td style="text-align:center; padding:4px 0;">×${it.quantity}</td>
          <td style="text-align:left; padding:4px 0;">${((it.price + (it.options ?? []).reduce((s, o) => s + o.price_delta, 0)) * it.quantity).toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</td>
        </tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${title} - ${orderNo}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Cairo', system-ui, sans-serif; width: 72mm; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .name { font-size: 18px; font-weight: 800; }
  .muted { color: #555; font-size: 12px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .total { font-size: 16px; font-weight: 800; display: flex; justify-content: space-between; }
  .thanks { margin-top: 10px; font-size: 12px; }
  .note { border: 1px dashed #000; padding: 6px; font-size: 12px; margin: 6px 0; }
</style>
</head>
<body>
  <div class="center">
    <div class="name">${escapeHtml(restaurantName)}</div>
    <div class="muted">${title}</div>
  </div>
  <hr />
  <div class="muted">
    <div>${tx("cashierScreen.receiptOrderNumber")} <b>${orderNo}</b></div>
    ${t.table_number != null ? `<div>${tx("cashierScreen.newOrderTableLabel")} <b>${t.table_number}</b></div>` : ""}
    ${t.customer_name ? `<div>${tx("cashierScreen.newOrderCustomerName")} <b>${escapeHtml(t.customer_name)}</b></div>` : ""}
    ${t.customer_phone ? `<div>${tx("cashierScreen.newOrderCustomerPhone")} <b>${escapeHtml(t.customer_phone)}</b></div>` : ""}
    ${t.customer_address ? `<div>${tx("cashierScreen.newOrderCustomerAddress")} <b>${escapeHtml(t.customer_address)}</b></div>` : ""}
    <div>${tx("cashierScreen.receiptDate")} ${dateStr}</div>
  </div>
  <hr />
  <table>
    <thead>
      <tr style="border-bottom:1px solid #000;">
        <th style="text-align:right; padding:4px 0;">${tx("cashierScreen.receiptItem")}</th>
        <th style="text-align:center; padding:4px 0;">${tx("cashierScreen.receiptQuantity")}</th>
        <th style="text-align:left; padding:4px 0;">${tx("cashierScreen.receiptPrice")}</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  ${t.notes ? `<div class="note">${tx("cashierScreen.newOrderOrderNotes")}: ${escapeHtml(t.notes)}</div>` : ""}
  <hr />
  <div class="total">
    <span>${tx("cashierScreen.receiptTotal")}</span>
    <span>${t.total.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span>
  </div>
  <hr />
  <div class="center thanks">${tx("cashierScreen.receiptThanks")}</div>
  <script>
    window.onload = function() {
      window.focus();
      window.print();
      setTimeout(function(){ window.close(); }, 300);
    };
  </script>
</body>
</html>`;
  printHtml(html);
}

/* ═══════════════════════════════════════════════════════════════
   HALL + TABLE PICKER — unlimited tables, grouped by hall
   ═══════════════════════════════════════════════════════════════ */
function HallTablePicker({
  halls,
  tables,
  hallId,
  onHallChange,
  value,
  onChange,
  tx,
}: {
  halls: CashierHallInfo[];
  tables: CashierTableInfo[];
  hallId: string;
  onHallChange: (id: string) => void;
  value: string;
  onChange: (v: string) => void;
  tx: (k: string) => string;
}) {
  const [query, setQuery] = useState("");

  // No halls configured (older data): fall back to one implicit group.
  const groups: CashierHallInfo[] = halls.length
    ? halls
    : [{ id: MAIN_HALL_ID, name: MAIN_HALL_NAME, table_count: tables.length }];

  const activeHall = groups.find((h) => h.id === hallId) ?? groups[0];
  const hallTables = tables.filter(
    (t) => (t.hall_id ?? MAIN_HALL_ID) === activeHall.id,
  );
  // A hall can be configured but empty; only then fall back to every table.
  const pool = hallTables.length
    ? hallTables
    : activeHall.table_count
      ? hallTables
      : tables;
  const q = query.trim();
  const shown = q
    ? pool.filter((t) => String(t.table_number).includes(q))
    : pool;
  const lots = pool.length > 24;

  return (
    <div className="flex items-start gap-2 flex-1 min-w-0">
      {/* Hall switcher — only shown when the restaurant has real halls */}
      {groups.length > 1 && (
        <div className="flex flex-col gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground font-bold">
            القاعة
          </span>
          <div className="flex flex-wrap gap-1 max-w-[150px]">
            {groups.map((h) => (
              <button
                key={h.id}
                onClick={() => onHallChange(h.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                  activeHall.id === h.id
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)]"
                    : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/50"
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

      {/* Tables of the active hall */}
      <div className="flex flex-col gap-1 flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground font-bold">
            الطاولة
          </span>
          {lots && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="رقم…"
              inputMode="numeric"
              className="h-7 w-16 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 text-xs text-[var(--foreground)]"
            />
          )}
          {value && (
            <button
              onClick={() => onChange("")}
              className="text-[10px] text-[var(--primary)] hover:underline"
            >
              {tx("cashierScreen.newOrderChangeTable")}
            </button>
          )}
        </div>

        {shown.length === 0 ? (
          <p className="text-[11px] text-muted-foreground py-1">
            {tables.length === 0
              ? "لا توجد طاولات — أضفها من إعدادات القاعات والطاولات"
              : q
                ? "لا يوجد رقم بهذا"
                : "لا توجد طاولات في هذه القاعة"}
          </p>
        ) : (
          <div
            className={`flex gap-1.5 ${lots ? "flex-wrap max-h-[104px] overflow-y-auto pr-1" : "flex-wrap"}`}
          >
            {shown.map((t) => (
              <button
                key={t.id}
                onClick={() => onChange(String(t.table_number))}
                className={`w-9 h-9 rounded-xl text-sm font-bold border transition-all shrink-0 ${
                  value === String(t.table_number)
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] shadow-md"
                    : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/60 hover:text-[var(--foreground)]"
                }`}
              >
                {t.table_number}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════   POS NEW ORDER VIEW — professional layout
   Left: categories + items grid | Right: cart + controls
   ═══════════════════════════════════════════════════════════════ */
function NewOrderView({
  token,
  restaurantName,
  onCreated,
}: {
  token: string | null;
  restaurantName: string;
  onCreated: () => void;
}) {
  const menuFn = useServerFn(cashierGetMenu);
  const createFn = useServerFn(cashierCreateOrder);

  const [categories, setCategories] = useState<CashierCategory[]>([]);
  const [items, setItems] = useState<CashierMenuItem[]>([]);
  const [tables, setTables] = useState<CashierTableInfo[]>([]);
  const [halls, setHalls] = useState<CashierHallInfo[]>([]);
  const [hallId, setHallId] = useState<string>("");
  const [optionsByItem, setOptionsByItem] = useState<
    Record<string, MenuOption[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<CashierNewOrderLine[]>([]);
  const [orderType, setOrderType] = useState<"dine_in" | "delivery">("dine_in");
  const [tableNo, setTableNo] = useState("");
  const [custName, setCustName] = useState("");
  const [custPhone, setCustPhone] = useState("");
  const [custAddr, setCustAddr] = useState("");
  const [orderNotes, setOrderNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [lastTicket, setLastTicket] = useState<NewOrderTicket | null>(null);
  const [showCart, setShowCart] = useState(false);

  const [modalItem, setModalItem] = useState<CashierMenuItem | null>(null);
  const [modalSelections, setModalSelections] = useState<
    Record<string, string[]>
  >({});

  const isPreview = token ? isPreviewToken(token) : false;

  useEffect(() => {
    if (isPreview) {
      const d = buildDefaultCashierMenu();
      setCategories(d.categories);
      setItems(d.items);
      setTables(d.tables);
      setHalls(d.halls);
      setOptionsByItem(d.options);
      setLoading(false);
      return;
    }
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    menuFn({ data: { token } })
      .then((res) => {
        setCategories(res.categories);
        setItems(res.items.filter((i) => i.is_available !== false));
        setTables(res.tables);
        setHalls(res.halls);
        setOptionsByItem(res.optionsByItem);
      })
      .catch((e) =>
        toast.error((e as Error).message || tx("cashierScreen.searchFailed")),
      )
      .finally(() => setLoading(false));
  }, [token, isPreview, menuFn]);

  // Default the hall selection to whichever hall holds the most tables so the
  // picker never opens on an empty hall.
  useEffect(() => {
    if (!halls.length) return;
    setHallId((cur) => {
      if (cur && halls.some((h) => h.id === cur)) return cur;
      const best = halls
        .slice()
        .sort((a, b) => b.table_count - a.table_count)[0];
      return best?.id ?? "";
    });
  }, [halls]);

  const visibleItems =
    activeCat === "all"
      ? items
      : items.filter((i) => i.category_id === activeCat);

  const total = cart.reduce(
    (s, l) => s + lineUnitTotal(l) * (l.quantity || 1),
    0,
  );
  const totalItems = cart.reduce((s, l) => s + l.quantity, 0);

  function lineUnitTotal(l: CashierNewOrderLine): number {
    const optTotal = (l.options ?? []).reduce(
      (a, o) => a + (o.price_delta || 0),
      0,
    );
    return (l.price || 0) + optTotal;
  }

  function getItemQtyInCart(itemId: string): number {
    return cart
      .filter((l) => l.menu_item_id === itemId)
      .reduce((s, l) => s + l.quantity, 0);
  }

  function quickAdd(item: CashierMenuItem) {
    const opts = optionsByItem[item.id] ?? [];
    if (opts.length > 0) {
      openConfigure(item);
      return;
    }
    setCart((prev) => {
      const existing = prev.find(
        (l) => l.menu_item_id === item.id && !l.note && !l.options?.length,
      );
      if (existing) {
        return prev.map((l) =>
          l.menu_item_id === item.id && !l.note && !l.options?.length
            ? { ...l, quantity: l.quantity + 1 }
            : l,
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

  function openConfigure(item: CashierMenuItem) {
    const opts = optionsByItem[item.id] ?? [];
    if (opts.length === 0) return quickAdd(item);
    setModalItem(item);
    const init: Record<string, string[]> = {};
    opts.forEach((o) => {
      if (!o.multi && o.choices.length > 0) {
        init[o.id] = [o.choices[0].id];
      } else {
        init[o.id] = [];
      }
    });
    setModalSelections(init);
  }

  function toggleChoice(optionId: string, choiceId: string, multi: boolean) {
    setModalSelections((prev) => {
      const cur = prev[optionId] ?? [];
      if (!multi) return { ...prev, [optionId]: [choiceId] };
      const has = cur.includes(choiceId);
      return {
        ...prev,
        [optionId]: has
          ? cur.filter((c) => c !== choiceId)
          : [...cur, choiceId],
      };
    });
  }

  function confirmConfigure() {
    if (!modalItem) return;
    const opts = optionsByItem[modalItem.id] ?? [];
    const lines: Array<{ label: string; choice: string; price_delta: number }> =
      [];
    for (const o of opts) {
      const chosen = modalSelections[o.id] ?? [];
      for (const choiceId of chosen) {
        const c = o.choices.find((x) => x.id === choiceId);
        if (c) {
          lines.push({
            label: o.name,
            choice: c.name,
            price_delta: c.price_delta ?? 0,
          });
        }
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
      prev.map((l, i) => {
        if (i !== idx) return l;
        const q = l.quantity + delta;
        return q <= 0 ? l : { ...l, quantity: q };
      }),
    );
  }

  function setNote(idx: number, note: string) {
    setCart((prev) => prev.map((l, i) => (i === idx ? { ...l, note } : l)));
  }

  function removeLine(idx: number) {
    setCart((prev) => prev.filter((_, i) => i !== idx));
  }

  async function sendToKitchen() {
    if (!cart.length) {
      toast.error(tx("cashierScreen.newOrderEmpty"));
      return;
    }
    if (orderType === "dine_in" && !tableNo) {
      toast.error(tx("cashierScreen.newOrderSelectTable"));
      return;
    }
    setSending(true);
    try {
      let orderNo = Math.floor(Math.random() * 900) + 100;
      let finalTotal = total;

      if (!isPreview && token) {
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
            notes: orderNotes || undefined,
            lines: cart,
          },
        });
        orderNo = res.dailyNumber;
        finalTotal = res.total;
      }

      const ticketData: NewOrderTicket = {
        orderNo,
        total: finalTotal,
        created_at: new Date().toISOString(),
        order_type: orderType,
        table_number: orderType === "dine_in" ? Number(tableNo) : null,
        customer_name: orderType === "delivery" ? custName : null,
        customer_phone: orderType === "delivery" ? custPhone : null,
        customer_address: orderType === "delivery" ? custAddr : null,
        notes: orderNotes || null,
        lines: cart,
      };

      const ticket: NewOrderTicket = ticketData;
      setLastTicket(ticket);
      toast.success(tx("cashierScreen.newOrderSent"));
      setCart([]);
      setOrderNotes("");
      setTableNo("");
      setCustName("");
      setCustPhone("");
      setCustAddr("");
      onCreated();
    } catch (e) {
      toast.error((e as Error).message || tx("cashierScreen.paymentFailed"));
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-12 text-center">
        <div className="mx-auto w-14 h-14 rounded-lg bg-[var(--muted)] flex items-center justify-center mb-3">
          <UtensilsCrossed className="w-7 h-7 text-[var(--muted-foreground)]" />
        </div>
        <p className="text-sm font-medium text-[var(--foreground)]">
          {tx("cashierScreen.newOrderNotFound")}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid lg:grid-cols-[1fr_380px] gap-4 items-start">
        {/* ═══ Menu Column ═══ */}
        <div className="space-y-3 min-w-0">
          {/* Order Type + Table Chips */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex bg-[var(--muted)] border border-[var(--border)] rounded-xl p-1">
              {(
                [
                  ["dine_in", tx("cashierScreen.newOrderDineIn")],
                  ["delivery", tx("cashierScreen.newOrderDelivery")],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setOrderType(k)}
                  className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                    orderType === k
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)] shadow-md"
                      : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--card)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {orderType === "dine_in" && (
              <HallTablePicker
                halls={halls}
                tables={tables}
                hallId={hallId}
                onHallChange={(id) => {
                  setHallId(id);
                  setTableNo("");
                }}
                value={tableNo}
                onChange={setTableNo}
                tx={tx}
              />
            )}

            {orderType === "delivery" && (
              <div className="flex items-center gap-1.5 flex-1">
                <Input
                  value={custName}
                  onChange={(e) => setCustName(e.target.value)}
                  placeholder={tx("cashierScreen.newOrderCustomerName")}
                  className="h-8 text-xs flex-1"
                />
                <Input
                  value={custPhone}
                  onChange={(e) => setCustPhone(e.target.value)}
                  placeholder={tx("cashierScreen.newOrderCustomerPhone")}
                  className="h-8 text-xs flex-1"
                />
                <Input
                  value={custAddr}
                  onChange={(e) => setCustAddr(e.target.value)}
                  placeholder={tx("cashierScreen.newOrderCustomerAddress")}
                  className="h-8 text-xs flex-1"
                />
              </div>
            )}
          </div>

          {/* Category Chips */}
          <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-hide">
            <button
              onClick={() => setActiveCat("all")}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border whitespace-nowrap ${
                activeCat === "all"
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] shadow-md"
                  : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
              }`}
            >
              {tx("cashierScreen.newOrderAll")}
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`px-4 py-2 rounded-xl text-sm font-bold transition-all border whitespace-nowrap ${
                  activeCat === c.id
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)] border-[var(--primary)] shadow-md"
                    : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:border-[var(--primary)]/40 hover:text-[var(--foreground)]"
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>

          {/* Menu Items Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {visibleItems.map((item) => {
              const qty = getItemQtyInCart(item.id);
              const hasOptions = (optionsByItem[item.id] ?? []).length > 0;
              return (
                <button
                  key={item.id}
                  onClick={() => quickAdd(item)}
                  className="text-right bg-[var(--card)] border rounded-2xl overflow-hidden transition-all active:scale-[0.97] hover:shadow-lg hover:border-[var(--primary)]/30 relative group"
                  style={{
                    borderColor:
                      qty > 0 ? "hsl(var(--primary))" : "hsl(var(--border))",
                  }}
                >
                  {/* Qty badge */}
                  {qty > 0 && (
                    <span className="absolute top-2 left-2 bg-[var(--primary)] text-[var(--primary-foreground)] text-xs font-bold w-7 h-7 rounded-full flex items-center justify-center z-10 shadow-md">
                      {qty}
                    </span>
                  )}
                  <div className="relative h-28 w-full bg-[var(--muted)] overflow-hidden">
                    {item.image_url ? (
                      <img
                        src={item.image_url}
                        alt={item.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <UtensilsCrossed className="w-8 h-8 text-[var(--muted-foreground)] opacity-30" />
                      </div>
                    )}
                    {item.is_available === false && (
                      <span className="absolute inset-0 bg-black/60 flex items-center justify-center text-xs font-bold text-white backdrop-blur-sm">
                        {tx("cashierScreen.newOrderDiscontinued")}
                      </span>
                    )}
                    {hasOptions && (
                      <span className="absolute bottom-2 right-2 text-[10px] font-bold bg-black/70 text-white rounded-lg px-2 py-1 backdrop-blur-sm">
                        {tx("cashierScreen.newOrderConfigureOptions")}
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="font-bold text-sm text-[var(--foreground)] line-clamp-1 leading-tight">
                      {item.name}
                    </div>
                    <div className="mt-1 font-extrabold text-[var(--primary)] text-sm tabular-nums">
                      {formatDZD(item.price)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ═══ Cart Column ═══ */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-5 space-y-4 lg:sticky lg:top-16 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold flex items-center gap-2">
              <ShoppingCart className="w-5 h-5 text-[var(--primary)]" />
              {tx("cashierScreen.newOrderCart")}
              {totalItems > 0 && (
                <span className="text-sm font-normal text-[var(--muted-foreground)]">
                  ({totalItems})
                </span>
              )}
            </h2>
            {cart.length > 0 && (
              <button
                onClick={() => {
                  setCart([]);
                  setOrderNotes("");
                }}
                className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] transition-colors p-1.5 rounded-lg hover:bg-[var(--destructive)]/10"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {cart.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)] py-12 text-center">
              {tx("cashierScreen.newOrderEmptyCart")}
            </p>
          ) : (
            <div className="space-y-2 max-h-[40vh] lg:max-h-[50vh] overflow-y-auto pe-1">
              {cart.map((l, idx) => (
                <div
                  key={idx}
                  className="border border-[var(--border)] rounded-xl p-3 space-y-2 bg-[var(--background)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-bold text-[var(--foreground)] line-clamp-1 flex-1">
                      {l.name}
                    </span>
                    <button
                      onClick={() => removeLine(idx)}
                      className="text-[var(--muted-foreground)] hover:text-[var(--destructive)] shrink-0"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  {l.options && l.options.length > 0 && (
                    <div className="space-y-0.5">
                      {l.options.map((o, oi) => (
                        <div
                          key={oi}
                          className="flex items-center justify-between text-[10px] text-[var(--muted-foreground)]"
                        >
                          <span className="line-clamp-1">
                            + {o.label}: {o.choice}
                          </span>
                          {o.price_delta > 0 && (
                            <span className="tabular-nums shrink-0">
                              +{formatDZD(o.price_delta)}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => changeQty(idx, -1)}
                        className="w-7 h-7 rounded-md border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="w-7 text-center text-sm font-bold tabular-nums">
                        {l.quantity}
                      </span>
                      <button
                        onClick={() => changeQty(idx, 1)}
                        className="w-7 h-7 rounded-md border border-[var(--border)] flex items-center justify-center text-[var(--muted-foreground)] hover:bg-[var(--muted)]"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <span className="font-bold text-sm tabular-nums text-[var(--primary)]">
                      {formatDZD(lineUnitTotal(l) * l.quantity)}
                    </span>
                  </div>
                  <Input
                    value={l.note ?? ""}
                    onChange={(e) => setNote(idx, e.target.value)}
                    placeholder={tx("cashierScreen.newOrderNotePlaceholder")}
                    className="h-7 text-[11px]"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Order Notes */}
          <Input
            value={orderNotes}
            onChange={(e) => setOrderNotes(e.target.value)}
            placeholder={tx("cashierScreen.newOrderOrderNotesPlaceholder")}
            className="h-8 text-xs"
          />

          {/* Total + Send */}
          <div className="pt-2 border-t border-[var(--border)] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">
                {tx("cashierScreen.newOrderTotal")}
              </span>
              <span className="text-xl font-extrabold text-[var(--primary)] tabular-nums">
                {formatDZD(total)}
              </span>
            </div>
            <Button
              onClick={() => void sendToKitchen()}
              disabled={sending || cart.length === 0}
              className="w-full h-12 text-base gap-2"
            >
              {sending ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
              {sending
                ? tx("cashierScreen.newOrderSending")
                : tx("cashierScreen.newOrderSend")}
            </Button>
            {lastTicket && (
              <Button
                variant="outline"
                className="w-full h-9 text-xs gap-2"
                onClick={() =>
                  printOrderTicket(
                    lastTicket,
                    restaurantName,
                    tx("cashierScreen.newOrderCustomerTicket"),
                  )
                }
              >
                <Printer className="w-3.5 h-3.5" />
                {tx("cashierScreen.newOrderPrint")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Options Modal ═══ */}
      {modalItem && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setModalItem(null)}
        >
          <div
            className="bg-[var(--card)] border border-[var(--border)] rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-5 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm flex items-center gap-2">
                <UtensilsCrossed className="w-4 h-4 text-[var(--primary)]" />
                {modalItem.name} — {formatDZD(modalItem.price)}
              </h3>
              <button
                onClick={() => setModalItem(null)}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {(optionsByItem[modalItem.id] ?? []).map((opt) => (
              <div key={opt.id}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className="text-xs font-bold text-[var(--foreground)]">
                    {opt.name}
                  </span>
                  <span
                    className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                      opt.required
                        ? "bg-[var(--destructive)]/10 text-[var(--destructive)]"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                    }`}
                  >
                    {opt.required
                      ? tx("cashierScreen.newOrderRequired")
                      : tx("cashierScreen.newOrderOptional")}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {opt.choices.map((c) => {
                    const chosen = (modalSelections[opt.id] ?? []).includes(
                      c.id,
                    );
                    return (
                      <button
                        key={c.id}
                        onClick={() => toggleChoice(opt.id, c.id, !!opt.multi)}
                        className={`w-full flex items-center justify-between rounded-lg border px-3 py-2 text-sm transition-colors ${
                          chosen
                            ? "bg-[var(--primary)]/10 border-[var(--primary)] text-[var(--foreground)]"
                            : "bg-[var(--card)] border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)]/50"
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          {!opt.multi && (
                            <span
                              className={`w-3 h-3 rounded-full border ${
                                chosen
                                  ? "bg-[var(--primary)] border-[var(--primary)]"
                                  : "border-[var(--muted-foreground)]"
                              }`}
                            />
                          )}
                          {opt.multi && (
                            <span
                              className={`w-3 h-3 rounded border ${
                                chosen
                                  ? "bg-[var(--primary)] border-[var(--primary)]"
                                  : "border-[var(--muted-foreground)]"
                              }`}
                            />
                          )}
                          <span>{c.name}</span>
                        </span>
                        {c.price_delta > 0 && (
                          <span className="tabular-nums text-[var(--primary)] font-bold text-xs">
                            +{formatDZD(c.price_delta)}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            <Button
              onClick={confirmConfigure}
              className="w-full h-11 text-sm gap-2"
            >
              <Plus className="w-4 h-4" />
              {tx("cashierScreen.newOrderConfirm")}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ Mobile Cart FAB ═══ */}
      {cart.length > 0 && (
        <div className="lg:hidden fixed bottom-4 left-4 right-4 z-40">
          <button
            onClick={() => setShowCart(!showCart)}
            className="w-full bg-[var(--primary)] text-[var(--primary-foreground)] rounded-2xl px-4 py-3 flex items-center justify-between shadow-lg"
          >
            <div className="flex items-center gap-2">
              <ShoppingCart className="w-5 h-5" />
              <span className="font-bold text-sm">
                {totalItems} {tx("cashierScreen.newOrderCart")}
              </span>
            </div>
            <span className="font-extrabold text-lg tabular-nums">
              {formatDZD(total)}
            </span>
          </button>
        </div>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   ORDER TRACKING VIEW — live timers + table grid
   Creative POS monitoring dashboard
   ═══════════════════════════════════════════════════════════════ */
function OrderTrackingView({
  orders,
}: {
  token: string | null;
  orders: ReadyOrder[];
}) {
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<
    "all" | "new" | "preparing" | "ready" | "served"
  >("all");
  const [selectedOrder, setSelectedOrder] = useState<ReadyOrder | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const filtered =
    filter === "all" ? orders : orders.filter((o) => o.status === filter);

  const stats = {
    new: orders.filter((o) => o.status === "new").length,
    preparing: orders.filter((o) => o.status === "preparing").length,
    ready: orders.filter((o) => o.status === "ready").length,
    served: orders.filter((o) => o.status === "served").length,
  };

  function elapsed(createdAt: string): number {
    return Math.max(
      0,
      Math.floor((now - new Date(createdAt).getTime()) / 1000),
    );
  }

  function fmtElapsed(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function timeColor(sec: number): string {
    if (sec < 300) return "text-green-600 bg-green-50 border-green-200";
    if (sec < 600) return "text-amber-600 bg-amber-50 border-amber-200";
    if (sec < 900) return "text-orange-600 bg-orange-50 border-orange-200";
    return "text-red-600 bg-red-50 border-red-200";
  }

  function timeDot(sec: number): string {
    if (sec < 300) return "#22c55e";
    if (sec < 600) return "#f59e0b";
    if (sec < 900) return "#f97316";
    return "#ef4444";
  }

  function statusLabel(s: string): string {
    if (s === "new") return "جديد";
    if (s === "preparing") return "جاري التحضير";
    if (s === "ready") return "جاهز";
    if (s === "served") return "مُسلَّم — بالطاولة";
    return s;
  }

  function statusColor(s: string): string {
    if (s === "new") return "bg-blue-100 text-blue-700";
    if (s === "preparing") return "bg-amber-100 text-amber-700";
    if (s === "ready") return "bg-green-100 text-green-700";
    if (s === "served") return "bg-sky-100 text-sky-700";
    return "bg-gray-100 text-gray-700";
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-16 space-y-4">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-[var(--muted)] flex items-center justify-center">
          <Timer className="w-10 h-10 text-[var(--muted-foreground)] opacity-50" />
        </div>
        <div>
          <p className="text-base font-bold text-[var(--foreground)]">
            لا توجد طلبات نشطة
          </p>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            ستظهر الطلبات هنا فور إرسالها
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filter + Clock */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex bg-[var(--card)] border border-[var(--border)] rounded-xl p-1">
          {(
            [
              ["all", "الكل", orders.length],
              ["new", "جديد", stats.new],
              ["preparing", "قيد التحضير", stats.preparing],
              ["ready", "جاهز", stats.ready],
              ["served", "مُسلَّم", stats.served],
            ] as const
          ).map(([key, label, count]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                filter === key
                  ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              }`}
            >
              {label}
              <span className="ms-1 opacity-70">{count}</span>
            </button>
          ))}
        </div>
        <div className="mr-auto text-xs text-[var(--muted-foreground)] tabular-nums">
          {new Date().toLocaleTimeString("ar", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      </div>

      {/* Table Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {filtered.map((order) => {
          const sec = elapsed(order.created_at);
          const st = order.status ?? "new";
          return (
            <motion.div
              key={order.id}
              layout
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`relative bg-[var(--card)] border rounded-2xl p-3 cursor-pointer transition-all hover:shadow-lg ${
                selectedOrder?.id === order.id
                  ? "ring-2 ring-[var(--primary)]"
                  : ""
              }`}
              style={{
                borderColor:
                  sec >= 900
                    ? "hsl(0 84% 60%)"
                    : sec >= 600
                      ? "hsl(25 95% 53%)"
                      : sec >= 300
                        ? "hsl(45 93% 47%)"
                        : undefined,
              }}
              onClick={() =>
                setSelectedOrder(selectedOrder?.id === order.id ? null : order)
              }
            >
              {/* Timer */}
              <div
                className={`absolute top-2 left-2 px-2 py-0.5 rounded-full text-[10px] font-bold border ${timeColor(sec)}`}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full me-1 align-middle"
                  style={{ backgroundColor: timeDot(sec) }}
                />
                {fmtElapsed(sec)}
              </div>

              {/* Table */}
              <div className="text-center mb-2">
                <div className="text-3xl font-extrabold text-[var(--foreground)] leading-none">
                  {order.table_number ?? "—"}
                </div>
                <div className="text-[10px] text-[var(--muted-foreground)] mt-0.5">
                  طاولة
                </div>
              </div>

              {/* Status */}
              <div className="flex justify-center mb-2">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor(st)}`}
                >
                  {statusLabel(st)}
                </span>
              </div>

              {/* Summary */}
              <div className="text-center space-y-1">
                <div className="text-xs text-[var(--muted-foreground)]">
                  {order.items.length} أصناف ·{" "}
                  {order.items.reduce((s, i) => s + i.qty, 0)} قطعة
                </div>
                <div className="text-sm font-extrabold text-[var(--primary)] tabular-nums">
                  {formatDZD(order.total)}
                </div>
              </div>

              {/* Ready indicator */}
              {st === "ready" && (
                <div className="mt-2 w-full py-1.5 rounded-lg text-[11px] font-bold bg-green-100 text-green-700 text-center">
                  <CheckCircle2 className="w-3.5 h-3.5 inline ms-1" />
                  جاهز للتسليم
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Detail Panel */}
      <AnimatePresence>
        {selectedOrder && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="bg-[var(--card)] border border-[var(--border)] rounded-2xl p-4 space-y-3"
          >
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
              >
                <ChevronLeft className="w-5 h-5 rotate-180" />
              </button>
              <h3 className="font-bold text-sm">
                طاولة {selectedOrder.table_number ?? "—"} — الطلب{" "}
                {fmtOrderNo(selectedOrder.daily_number)}
              </h3>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusColor(selectedOrder.status ?? "new")}`}
              >
                {statusLabel(selectedOrder.status ?? "new")}
              </span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${timeColor(elapsed(selectedOrder.created_at))}`}
              >
                {fmtElapsed(elapsed(selectedOrder.created_at))}
              </span>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                {selectedOrder.items.map((it, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between text-sm bg-[var(--muted)]/50 rounded-lg px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-bold text-[var(--primary)]">
                        ×{it.qty}
                      </span>
                      <span>{it.name}</span>
                    </span>
                    <span className="text-[var(--muted-foreground)] tabular-nums">
                      {formatDZD(it.price * it.qty)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">النوع:</span>
                  <span className="font-bold">
                    {selectedOrder.order_type === "dine_in"
                      ? "inside المطعم"
                      : selectedOrder.order_type === "delivery"
                        ? "توصيل"
                        : selectedOrder.order_type}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">
                    وقت الإنشاء:
                  </span>
                  <span className="font-bold tabular-nums">
                    {new Date(selectedOrder.created_at).toLocaleTimeString(
                      "ar",
                      { hour: "2-digit", minute: "2-digit" },
                    )}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--muted-foreground)]">المدة:</span>
                  <span className="font-bold tabular-nums">
                    {fmtElapsed(elapsed(selectedOrder.created_at))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[var(--muted-foreground)]">
                    المجموع:
                  </span>
                  <span className="font-extrabold text-[var(--primary)] text-base">
                    {formatDZD(selectedOrder.total)}
                  </span>
                </div>
                {selectedOrder.notes && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-amber-800">
                    <span className="font-bold">ملاحظة:</span>{" "}
                    {selectedOrder.notes}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function printZReport(z: ZReport, restaurantName: string) {
  const typeRows = (
    [
      [tx("cashierScreen.dineIn"), z.byType.dine_in],
      [tx("cashierScreen.takeaway"), z.byType.takeaway],
      [tx("cashierScreen.delivery"), z.byType.delivery],
    ] as const
  )
    .map(
      ([label, v]) => `
      <tr>
        <td style="padding:4px 0;">${label}</td>
        <td style="text-align:center; padding:4px 0;">${v.count}</td>
        <td style="text-align:left; padding:4px 0;">${v.revenue.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</td>
      </tr>`,
    )
    .join("");
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>${tx("cashierScreen.zReportTitle")} - ${z.dayKey}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  body { font-family: 'Cairo', system-ui, sans-serif; width: 72mm; margin: 0 auto; color: #000; }
  .center { text-align: center; }
  .name { font-size: 18px; font-weight: 800; }
  .muted { color: #555; font-size: 12px; }
  hr { border: none; border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .total { font-size: 16px; font-weight: 800; display: flex; justify-content: space-between; }
  .row { font-size: 13px; display: flex; justify-content: space-between; padding: 2px 0; }
</style>
</head>
<body>
  <div class="center">
    <div class="name">${escapeHtml(restaurantName)}</div>
    <div class="muted">${tx("cashierScreen.zReportSubtitle")}</div>
    <div class="muted">${z.dayKey} — ${tx("cashierScreen.zReportPrinted")} ${new Date().toLocaleTimeString("ar-DZ", { hour: "2-digit", minute: "2-digit" })}</div>
  </div>
  <hr />
  <div class="total"><span>${tx("cashierScreen.zReportSalesTotal")}</span><span>${z.totalRevenue.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span></div>
  <div class="row"><span>${tx("cashierScreen.zReportPaidCount")}</span><span>${z.totalOrders}</span></div>
  <div class="row"><span>${tx("cashierScreen.zReportAverageTicket")}</span><span>${z.avgTicket.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span></div>
  <hr />
  <table>
    <thead>
      <tr style="border-bottom:1px solid #000;">
        <th style="text-align:right; padding:4px 0;">${tx("cashierScreen.zReportType")}</th>
        <th style="text-align:center; padding:4px 0;">${tx("cashierScreen.zReportOrders")}</th>
        <th style="text-align:left; padding:4px 0;">${tx("cashierScreen.zReportAmount")}</th>
      </tr>
    </thead>
    <tbody>${typeRows}</tbody>
  </table>
  ${
    z.unpaidCount > 0
      ? `<hr /><div class="row"><span>⚠️ ${tx("cashierScreen.zReportUnpaid")}</span><span>${z.unpaidCount} · ${z.unpaidTotal.toLocaleString("en-US")} ${tx("cashierScreen.receiptCurrency")}</span></div>`
      : ""
  }
  <hr />
  <div class="center muted">MenuFlow</div>
  <script>
    window.onload = function() {
      window.focus();
      window.print();
      setTimeout(function(){ window.close(); }, 300);
    };
  </script>
</body>
</html>`;
  printHtml(html);
}

function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  iframe.style.opacity = "0";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  iframe.contentWindow?.focus();
  iframe.contentWindow?.print();
  setTimeout(() => document.body.removeChild(iframe), 500);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
