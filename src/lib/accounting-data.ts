import { supabase } from "@/integrations/supabase/client";
import { summarizeByCategory } from "@/lib/expenses.functions";

export type AccountingPeriod = {
  from: string;
  to: string;
  label: string;
};

export type ChannelStat = {
  key: "dine_in" | "takeaway" | "delivery";
  count: number;
  revenue: number;
};

export type DailyRow = {
  date: string;
  revenue: number;
  cogs: number;
  expenses: number;
  net: number;
};

export type AccountingReport = {
  period: AccountingPeriod;
  revenue: number;
  ordersCount: number;
  avgOrder: number;
  byChannel: ChannelStat[];
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  expenses: {
    purchases: number;
    salaries: number;
    waste: number;
    other: number;
    total: number;
    /** Manual expense log total (rent, electricity, gas, maintenance, ...). */
    manual: number;
    manualByCategory: {
      category: string;
      label: string;
      amount: number;
      count: number;
    }[];
  };
  netProfit: number;
  netMarginPct: number;
  daily: DailyRow[];
};

const sum = (arr: Array<{ [k: string]: any }>, key: string) =>
  arr.reduce((s, x) => s + Number(x[key] ?? 0), 0);

export function periodBounds(
  preset: string,
  customFrom: string,
  customTo: string,
): AccountingPeriod {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let to = today;
  let from = today;
  let label = "";

  switch (preset) {
    case "today":
      label = "اليوم";
      break;
    case "week": {
      from = new Date(today);
      from.setDate(from.getDate() - 6);
      label = "آخر 7 أيام";
      break;
    }
    case "month": {
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      label = "هذا الشهر";
      break;
    }
    case "lastMonth": {
      from = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const lastDay = new Date(today.getFullYear(), today.getMonth(), 0);
      label = "الشهر الماضي";
      return {
        from: `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, "0")}-01`,
        to: `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, "0")}-${String(lastDay.getDate()).padStart(2, "0")}`,
        label,
      };
    }
    case "custom": {
      if (customFrom) from = new Date(customFrom + "T00:00:00");
      if (customTo) to = new Date(customTo + "T00:00:00");
      label = "فترة مخصصة";
      break;
    }
    default:
      label = "هذا الشهر";
  }

  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { from: fmt(from), to: fmt(to), label };
}

export async function resolveRestaurantId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  const userId = data.user?.id;
  if (userId) {
    const { data: owned } = await supabase
      .from("restaurants")
      .select("id")
      .eq("owner_id", userId)
      .maybeSingle();
    if (owned?.id) return owned.id;
    const { data: roles } = await supabase
      .from("user_roles")
      .select("restaurant_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (roles?.restaurant_id) return roles.restaurant_id;
  }
  const saved = localStorage.getItem("sahl_dz_restaurant");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed?.id) return String(parsed.id);
    } catch {
      /* ignore */
    }
  }
  return null;
}

const chunkIds = <T>(ids: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
};

async function safeFetch<T extends any[]>(
  builder: () => Promise<{ data: any; error: any }>,
): Promise<T> {
  try {
    const { data, error } = await builder();
    if (error) {
      console.warn("[accounting] query failed", error);
      return [] as unknown as T;
    }
    return (data ?? []) as T;
  } catch (e) {
    console.warn("[accounting] query threw", e);
    return [] as unknown as T;
  }
}

export async function loadAccountingReport(
  restaurantId: string,
  period: AccountingPeriod,
): Promise<AccountingReport> {
  const { from, to } = period;
  const fromIso = from + "T00:00:00";
  const toIso = to + "T23:59:59";

  const [
    orders,
    waste,
    purchaseTxs,
    purchasesFallback,
    salaryPayments,
    otherTxs,
    staffTx,
    manualExpenses,
  ] = await Promise.all([
    safeFetch<any[]>(() =>
      supabase
        .from("orders")
        .select("id,total,created_at,type,order_type,status")
        .eq("restaurant_id", restaurantId)
        .eq("status", "paid")
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("waste_logs")
        .select("cost")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("supplier_transactions")
        .select("amount,type")
        .eq("restaurant_id", restaurantId)
        .eq("type", "purchase")
        .gte("date", from)
        .lte("date", to),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("purchase_orders")
        .select("total")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", fromIso)
        .lte("created_at", toIso),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("employee_salary_payments")
        .select("net_salary")
        .eq("restaurant_id", restaurantId)
        .gte("paid_at", fromIso)
        .lte("paid_at", toIso),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("supplier_transactions")
        .select("amount,type")
        .eq("restaurant_id", restaurantId)
        .in("type", ["payment", "advance", "return"])
        .gte("date", from)
        .lte("date", to),
    ),
    safeFetch<any[]>(() =>
      supabase
        .from("staff_transactions")
        .select("amount,type")
        .eq("restaurant_id", restaurantId)
        .in("type", ["advance", "loan"])
        .gte("date", from)
        .lte("date", to),
    ),
    // Manual expense log (rent, electricity, gas, maintenance, ...) - the
    // catch-all costs that are not purchases, salaries or waste.
    safeFetch<any[]>(() =>
      supabase
        .from("expenses")
        .select("amount,category,date")
        .eq("restaurant_id", restaurantId)
        .gte("date", from)
        .lte("date", to),
    ),
  ]);

  const revenue = sum(orders, "total");
  const ordersCount = orders.length;
  const wasteCost = sum(waste, "cost");
  const purchases = sum(purchaseTxs, "amount");
  const purchasesFromPO = sum(purchasesFallback, "total");
  const salaries = sum(salaryPayments, "net_salary");
  const staffAdvances = sum(staffTx, "amount");
  const otherExpenses = sum(manualExpenses, "amount");
  const otherExpensesByCategory = summarizeByCategory(manualExpenses);

  let other = 0;
  for (const t of otherTxs) {
    if (t.type === "return") other -= Number(t.amount ?? 0);
    else other += Number(t.amount ?? 0);
  }

  // Channel split (paid orders)
  const byChannel: ChannelStat[] = ["dine_in", "takeaway", "delivery"].map(
    (key) => ({
      key: key as ChannelStat["key"],
      count: 0,
      revenue: 0,
    }),
  );
  for (const o of orders) {
    const t = (o.type ?? o.order_type ?? "dine_in") as ChannelStat["key"];
    const row = byChannel.find((c) => c.key === t);
    if (row) {
      row.count += 1;
      row.revenue += Number(o.total ?? 0);
    }
  }

  // COGS via recipes: order_items -> menu_item_recipes -> ingredients
  const orderIds = orders.map((o: any) => o.id).filter(Boolean);
  let orderItems: any[] = [];
  for (const ids of chunkIds(orderIds, 10)) {
    const rows = await safeFetch<any[]>(() =>
      supabase
        .from("order_items")
        .select("order_id,menu_item_id,quantity")
        .in("order_id", ids),
    );
    orderItems = orderItems.concat(rows);
  }

  const menuIds = [
    ...new Set(orderItems.map((i) => i.menu_item_id).filter(Boolean)),
  ];
  let recipes: any[] = [];
  for (const ids of chunkIds(menuIds, 10)) {
    const rows = await safeFetch<any[]>(() =>
      supabase
        .from("menu_item_recipes")
        .select("menu_item_id,ingredient_id,quantity")
        .in("menu_item_id", ids),
    );
    recipes = recipes.concat(rows);
  }

  const ingIds = [
    ...new Set(recipes.map((r) => r.ingredient_id).filter(Boolean)),
  ];
  let ingredients: any[] = [];
  for (const ids of chunkIds(ingIds, 10)) {
    const rows = await safeFetch<any[]>(() =>
      supabase.from("ingredients").select("id,cost_per_unit").in("id", ids),
    );
    ingredients = ingredients.concat(rows);
  }

  const ingCost = new Map(
    ingredients.map((g: any) => [g.id, Number(g.cost_per_unit ?? 0)]),
  );
  const itemCost = new Map<string, number>();
  for (const r of recipes) {
    const key = r.menu_item_id;
    itemCost.set(
      key,
      (itemCost.get(key) ?? 0) +
        Number(r.quantity ?? 0) * (ingCost.get(r.ingredient_id) ?? 0),
    );
  }

  const cogsByOrder = new Map<string, number>();
  for (const it of orderItems) {
    const cost = itemCost.get(it.menu_item_id) ?? 0;
    cogsByOrder.set(
      it.order_id,
      (cogsByOrder.get(it.order_id) ?? 0) + cost * Number(it.quantity ?? 0),
    );
  }
  const cogs = Array.from(cogsByOrder.values()).reduce((s, v) => s + v, 0);

  const grossProfit = revenue - cogs;
  const otherTotal = other + staffAdvances + otherExpenses;
  const expensesTotal =
    (purchases || purchasesFromPO) + salaries + wasteCost + otherTotal;
  const netProfit = revenue - expensesTotal;
  const pct = (n: number) =>
    revenue > 0 ? Math.round((n / revenue) * 100) : 0;

  // Daily breakdown
  const day = (iso: string) => (iso ? iso.slice(0, 10) : "");
  const revByDay = new Map<string, number>();
  for (const o of orders) {
    const k = day(o.created_at ?? "");
    if (k) revByDay.set(k, (revByDay.get(k) ?? 0) + Number(o.total ?? 0));
  }
  const cogsByDay = new Map<string, number>();
  for (const o of orders) {
    const k = day(o.created_at ?? "");
    if (!k) continue;
    const v = cogsByOrder.get(o.id) ?? 0;
    cogsByDay.set(k, (cogsByDay.get(k) ?? 0) + v);
  }
  const wasteByDay = new Map<string, number>();
  for (const w of waste) {
    const k = day(w.created_at ?? "");
    if (k) wasteByDay.set(k, (wasteByDay.get(k) ?? 0) + Number(w.cost ?? 0));
  }
  // Manual expenses use a plain YYYY-MM-DD `date`, already day-granular.
  const manualByDay = new Map<string, number>();
  for (const e of manualExpenses) {
    const k = day(String(e.date ?? ""));
    if (k)
      manualByDay.set(k, (manualByDay.get(k) ?? 0) + Number(e.amount ?? 0));
  }

  const dailyRows: DailyRow[] = [];
  const cur = new Date(from + "T00:00:00");
  const last = new Date(to + "T00:00:00");
  while (cur <= last) {
    const k = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    const rev = revByDay.get(k) ?? 0;
    const dayCogs = cogsByDay.get(k) ?? 0;
    const dayWaste = wasteByDay.get(k) ?? 0;
    const dayManual = manualByDay.get(k) ?? 0;
    const dayExpenses = dayWaste + dayManual;
    dailyRows.push({
      date: k,
      revenue: rev,
      cogs: dayCogs,
      expenses: dayExpenses,
      net: rev - dayCogs - dayExpenses,
    });
    cur.setDate(cur.getDate() + 1);
  }

  return {
    period,
    revenue,
    ordersCount,
    avgOrder: ordersCount ? Math.round(revenue / ordersCount) : 0,
    byChannel,
    cogs,
    grossProfit,
    grossMarginPct: pct(grossProfit),
    expenses: {
      purchases: purchases || purchasesFromPO,
      salaries,
      waste: wasteCost,
      other: otherTotal,
      total: expensesTotal,
      manual: otherExpenses,
      manualByCategory: otherExpensesByCategory,
    },
    netProfit,
    netMarginPct: pct(netProfit),
    daily: dailyRows,
  };
}
