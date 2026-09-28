import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  where,
} from "firebase/firestore";
import { requireRestaurantId } from "@/lib/server-staff-auth";
import { hmacSign, hmacVerify, STAFF_SESSION_TTL_MS } from "@/lib/staff-core";
import { DEFAULT_CATEGORIES, DEFAULT_MENU_ITEMS } from "@/lib/default-menu";
import {
  fetchMenuForRestaurantCore,
  createOrderForRestaurantCore,
  type NewOrderInput,
} from "@/lib/order-create";

export type {
  OrderMenuItem as CashierMenuItem,
  OrderCategory as CashierCategory,
  OrderTableInfo as CashierTableInfo,
  OrderHallInfo as CashierHallInfo,
  NewOrderLine as CashierNewOrderLine,
} from "@/lib/order-create";
import { MAIN_HALL_ID } from "@/lib/halls";

export type ReadyOrderLine = {
  name: string;
  qty: number;
  price: number;
  note?: string | null;
  options?: Array<{ label: string; choice: string; price_delta: number }>;
};

export type ReadyOrder = {
  id: string;
  total: number;
  created_at: string;
  table_number: number | null;
  /** Name of the hall the table belongs to, for disambiguated display. */
  hall_name?: string | null;
  daily_number: number | null;
  order_type?: string;
  status?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  customer_address?: string | null;
  notes?: string | null;
  items: ReadyOrderLine[];
};

function safeParseOptions(
  raw: any,
): Array<{ label: string; choice: string; price_delta: number }> {
  try {
    const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
    return Array.isArray(arr)
      ? arr.map((o: any) => ({
          label: String(o?.label ?? ""),
          choice: String(o?.choice ?? ""),
          price_delta: Number(o?.price_delta) || 0,
        }))
      : [];
  } catch {
    return [];
  }
}

export type ZReport = {
  dayKey: string;
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  byType: Record<
    "dine_in" | "takeaway" | "delivery",
    { count: number; revenue: number }
  >;
  unpaidCount: number;
  unpaidTotal: number;
};

/** Parse a cashier session token `csh.<restaurantId>.<expiryEpochMs>.<hmac>`. */
async function parseCashierToken(
  token: string,
): Promise<{ restaurantId: string; expiresAt: number } | null> {
  if (!token.startsWith("csh.")) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt)) return null;
  const payload = `csh.${parts[1]}.${parts[2]}`;
  const valid = await hmacVerify(payload, parts[3]);
  if (!valid) return null;
  return { restaurantId: parts[1], expiresAt };
}

/** Resolve restaurant ID from cashier token, with expiry check. */
async function resolveCashierRestaurantId(token: string): Promise<string> {
  const parsed = await parseCashierToken(token);
  if (!parsed) throw new Error("جلسة الكاشير منتهية — سجّل دخولك من جديد");
  if (parsed.expiresAt <= Date.now())
    throw new Error("جلسة الكاشير منتهية — سجّل دخولك من جديد");
  return parsed.restaurantId;
}

/** Batch-fetch order items + table numbers for a set of orders. */
async function enrichOrders(orderRows: any[]): Promise<ReadyOrder[]> {
  if (!orderRows.length) return [];

  const ids = orderRows.map((o: any) => o.id as string);

  const [itemsRes, tablesRes] = await Promise.all([
    supabase.from("order_items").select("*").in("order_id", ids),
    supabase
      .from("tables")
      .select("id,table_number,hall_id")
      .in("id", orderRows.map((o: any) => o.table_id).filter(Boolean)),
  ]);

  if (itemsRes.error) throw new Error(itemsRes.error.message);
  if (tablesRes.error) throw new Error(tablesRes.error.message);

  const itemsByOrder = new Map<string, any[]>();
  for (const it of itemsRes.data ?? []) {
    const arr = itemsByOrder.get((it as any).order_id) ?? [];
    arr.push(it);
    itemsByOrder.set((it as any).order_id, arr);
  }

  const tableMap = new Map<string, number>();
  const tableHall = new Map<string, string | null>();
  for (const t of tablesRes.data ?? []) {
    tableMap.set((t as any).id, (t as any).table_number);
    tableHall.set((t as any).id, (t as any).hall_id ?? null);
  }

  // Halls are optional metadata — resolve names only for the halls in play.
  const hallIds = [
    ...new Set([...tableHall.values()].filter(Boolean)),
  ] as string[];
  let hallName = new Map<string, string>();
  if (hallIds.length) {
    const { data: hallRows } = await supabase
      .from("halls")
      .select("id,name")
      .in("id", hallIds);
    hallName = new Map(
      ((hallRows ?? []) as { id: string; name: string }[]).map((h) => [
        h.id,
        h.name,
      ]),
    );
  }

  return orderRows.map((o: any) => {
    const items = (itemsByOrder.get(o.id) ?? []).map((it: any) => ({
      name: it.name_snapshot as string,
      qty: it.quantity as number,
      price: it.price_snapshot as number,
      note: (it.note as string) ?? null,
      options: it.options_snapshot ? safeParseOptions(it.options_snapshot) : [],
    }));
    return {
      id: o.id,
      total: o.total as number,
      created_at: o.created_at as string,
      table_number: o.table_id ? (tableMap.get(o.table_id) ?? null) : null,
      hall_name: o.table_id
        ? (hallName.get(tableHall.get(o.table_id) ?? "") ?? null)
        : null,
      daily_number: (o.daily_number as number) ?? null,
      status: (o.status as string) ?? "new",
      order_type: (o.order_type as string) ?? "dine_in",
      customer_name: (o.customer_name as string) ?? null,
      customer_phone: (o.customer_phone as string) ?? null,
      customer_address: (o.customer_address as string) ?? null,
      notes: (o.notes as string) ?? null,
      items,
    };
  });
}

/** DB logic: get cashier restaurant context. */
export async function getCashierContextCore(token: string) {
  const restaurantId = await resolveCashierRestaurantId(token);
  const { data: rest } = await supabase
    .from("restaurants")
    .select("id,name,logo_url")
    .eq("id", restaurantId)
    .maybeSingle();
  return {
    restaurant: (rest as any) ?? { id: restaurantId, name: "", logo_url: null },
  };
}

export const getCashierContext = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return getCashierContextCore(token);
  });

/** DB logic: list orders with status = 'ready' (ready for payment). */
export async function cashierListReadyCore(token: string) {
  const restaurantId = await resolveCashierRestaurantId(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const snap = await getDocs(
    query(collection(db, "orders"), where("restaurant_id", "==", restaurantId)),
  );
  const orderRows = snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((o: any) => ["ready", "served"].includes(o.status));
  return { orders: await enrichOrders(orderRows ?? []) };
}

export const cashierListReady = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    return cashierListReadyCore(token);
  });

/** DB logic: list ALL active orders (new, preparing, ready, served) for tracking. */
export async function cashierListActiveOrdersCore(token: string) {
  const restaurantId = await resolveCashierRestaurantId(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const snap = await getDocs(
    query(collection(db, "orders"), where("restaurant_id", "==", restaurantId)),
  );
  const orderRows = snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((o: any) =>
      ["new", "preparing", "ready", "served"].includes(o.status),
    );
  return { orders: await enrichOrders(orderRows ?? []) };
}

export const cashierListActiveOrders = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    return cashierListActiveOrdersCore(token);
  });

/** DB logic: update an order's status (new → preparing → ready). */
export async function cashierUpdateOrderStatusCore(
  token: string,
  orderId: string,
  status: string,
) {
  const restaurantId = await resolveCashierRestaurantId(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلبية غير موجودة");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");

  const update: Record<string, any> = { status };
  if (status === "ready") update.ready_at = new Date().toISOString();
  await updateDoc(orderRef, update);
  return { ok: true };
}

export const cashierUpdateOrderStatus = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string; status: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId, status } = data as {
      token: string;
      orderId: string;
      status: string;
    };
    return cashierUpdateOrderStatusCore(token, orderId, status);
  });

/** DB logic: lookup orders for a specific table, optionally within a hall. */
export async function cashierLookupTableCore(
  token: string,
  tableNumber: number,
  hallId?: string | null,
) {
  const restaurantId = await resolveCashierRestaurantId(token);

  // The same number may exist in several halls, so read the candidates and
  // narrow in JS — the adapter cannot express "hall_id is null" as a filter.
  const { data: rows } = await supabase
    .from("tables")
    .select("id,hall_id")
    .eq("restaurant_id", restaurantId)
    .eq("table_number", tableNumber);
  const candidates = (rows ?? []) as { id: string; hall_id: string | null }[];
  if (!candidates.length) return { orders: [] as ReadyOrder[] };

  let match: { id: string; hall_id: string | null } | undefined;
  if (hallId === undefined) {
    match = candidates.length === 1 ? candidates[0] : undefined;
  } else {
    const wanted = hallId === MAIN_HALL_ID ? null : hallId;
    match = candidates.find((t) => (t.hall_id ?? null) === wanted);
  }
  // Ambiguous and unfiltered: return the orders of every matching table.
  const tableIds = match ? [match.id] : candidates.map((t) => t.id);
  if (!tableIds.length) return { orders: [] as ReadyOrder[] };

  const { data: orderRows } = await supabase
    .from("orders")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .in("table_id", tableIds)
    .in("status", ["new", "preparing", "ready"])
    .order("created_at", { ascending: false });

  return { orders: await enrichOrders(orderRows ?? []) };
}

export const cashierLookupTable = createServerFn({ method: "GET" })
  .validator(
    (d: { token: string; tableNumber: number; hallId?: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const { token, tableNumber, hallId } = data as {
      token: string;
      tableNumber: number;
      hallId?: string | null;
    };
    return cashierLookupTableCore(token, tableNumber, hallId);
  });

export type CashierPaymentMode = "full" | "partial" | "debt" | "gift";

export type CashierPaymentInput = {
  mode: CashierPaymentMode;
  paidAmount?: number;
  remainderKind?: "debt" | "discount";
};

export type CashierPaymentOutcome = {
  orderId?: string;
  mode: CashierPaymentMode;
  paid: number;
  debt: number;
  discount: number;
};

function buildPaymentBreakdown(
  total: number,
  payment?: CashierPaymentInput,
): CashierPaymentOutcome | null {
  const mode: CashierPaymentMode = payment?.mode ?? "full";
  const fmt = (n: number) => Math.round(n * 100) / 100;

  if (mode === "full") {
    return { mode, paid: fmt(total), debt: 0, discount: 0 };
  }

  if (mode === "debt") {
    return { mode, paid: 0, debt: fmt(total), discount: 0 };
  }

  if (mode === "gift") {
    return { mode, paid: 0, debt: 0, discount: fmt(total) };
  }

  // partial
  const paid = Number(payment?.paidAmount);
  if (!Number.isFinite(paid) || paid <= 0)
    throw new Error("حدد مبلغ الدفع الجزئي قبل التأكيد");
  if (paid >= total)
    throw new Error("المبلغ المدفوع يجب أن يكون أقل من إجمالي الطلب");
  const remainder = fmt(total - paid);
  const remainderKind = payment?.remainderKind ?? "debt";
  return {
    mode,
    paid: fmt(paid),
    debt: remainderKind === "debt" ? remainder : 0,
    discount: remainderKind === "discount" ? remainder : 0,
  };
}

/** DB logic: mark orders as paid with a payment breakdown. */
export async function cashierMarkPaidCore(
  token: string,
  orderIds: string[],
  payment?: CashierPaymentInput,
): Promise<{ ok: true; outcomes: CashierPaymentOutcome[] }> {
  const restaurantId = await resolveCashierRestaurantId(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");
  const now = new Date().toISOString();
  const outcomes: CashierPaymentOutcome[] = [];

  for (const orderId of orderIds) {
    const orderRef = doc(db, "orders", orderId);
    const snap = await getDoc(orderRef);
    if (!snap.exists()) continue;
    const data = snap.data();
    if (data.restaurant_id !== restaurantId) continue;
    if (data.status !== "ready" && data.status !== "served") continue;
    const total = Number(data.total) || 0;
    const breakdown = buildPaymentBreakdown(total, payment);
    await updateDoc(orderRef, {
      status: "paid",
      payment_status: "paid",
      served_at: now,
      payment_mode: breakdown!.mode,
      paid_amount: breakdown!.paid,
      debt_amount: breakdown!.debt,
      discount_amount: breakdown!.discount,
    });
    outcomes.push({ orderId, ...breakdown! });
  }
  return { ok: true, outcomes };
}

export const cashierMarkPaid = createServerFn({ method: "POST" })
  .validator(
    (d: { token: string; orderIds: string[]; payment?: CashierPaymentInput }) =>
      d,
  )
  .handler(async ({ data }) => {
    const { token, orderIds, payment } = data as {
      token: string;
      orderIds: string[];
      payment?: CashierPaymentInput;
    };
    return cashierMarkPaidCore(token, orderIds, payment);
  });

export const cashierLogout = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async () => ({ ok: true }));

/** DB logic: generate Z-report (end-of-day) for the cashier's restaurant. */
export async function cashierZReportCore(token: string): Promise<ZReport> {
  const restaurantId = await resolveCashierRestaurantId(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayKey = now.toISOString().slice(0, 10);
  const startIso = startOfDay.toISOString();

  const snap = await getDocs(
    query(collection(db, "orders"), where("restaurant_id", "==", restaurantId)),
  );
  const orderRows = snap.docs.map((d) => ({ ...d.data(), id: d.id }));

  const paidOrders = orderRows.filter((o: any) => {
    if (o.status !== "paid") return false;
    const created = firestoreDateToIso(o.created_at);
    return created >= startIso;
  });
  const unpaidOrders = orderRows.filter((o: any) =>
    ["new", "preparing", "ready", "served"].includes(o.status),
  );

  const byType: ZReport["byType"] = {
    dine_in: { count: 0, revenue: 0 },
    takeaway: { count: 0, revenue: 0 },
    delivery: { count: 0, revenue: 0 },
  };

  let totalRevenue = 0;
  let totalOrders = 0;

  for (const o of paidOrders) {
    const t = ((o as any).order_type as keyof ZReport["byType"]) ?? "dine_in";
    const rev = Number((o as any).paid_amount) || Number((o as any).total) || 0;
    totalRevenue += rev;
    totalOrders++;
    if (byType[t]) {
      byType[t].count++;
      byType[t].revenue += rev;
    }
  }

  const unpaidTotal = unpaidOrders.reduce(
    (s: number, o: any) => s + ((o.total as number) ?? 0),
    0,
  );

  return {
    dayKey,
    totalRevenue,
    totalOrders,
    avgTicket: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
    byType,
    unpaidCount: unpaidOrders.length,
    unpaidTotal,
  };
}

/** Normalize a Firestore timestamp-or-string into an ISO string. */
function firestoreDateToIso(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof (v as any)?.toDate === "function") {
    try {
      return (v as any).toDate().toISOString();
    } catch {
      return "";
    }
  }
  try {
    return new Date(v).toISOString();
  } catch {
    return "";
  }
}

export const cashierZReport = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }): Promise<ZReport> => {
    const { token } = data as { token: string };
    return cashierZReportCore(token);
  });

async function loadCashierConfig(restaurantId: string) {
  const rest = await supabase
    .from("restaurants")
    .select("id,name,logo_url,cashier_pin,cashier_enabled")
    .eq("id", restaurantId)
    .maybeSingle();
  return rest.data as any; // null when not found (also in preview mode)
}

/** DB logic without the HTTP layer — also used by tests. */
export async function getPublicCashierLoginInfoCore(restaurantId: string) {
  const rest = await loadCashierConfig(restaurantId);
  if (!rest) return { found: false, name: "", enabled: false };
  return {
    found: true,
    name: (rest.name as string) ?? "",
    enabled: rest.cashier_enabled === true && !!rest.cashier_pin,
  };
}

/** Public (login-page): whether the shared cashier system is enabled for a restaurant. */
export const getPublicCashierLoginInfo = createServerFn({ method: "GET" })
  .validator((d: { restaurantId: string }) => d)
  .handler(async ({ data }) => {
    return getPublicCashierLoginInfoCore(
      (data as { restaurantId: string }).restaurantId,
    );
  });

/** DB logic without the HTTP layer — also used by tests. */
export async function verifyCashierPinCore(restaurantId: string, pin: string) {
  const rest = await loadCashierConfig(restaurantId);
  if (!rest) throw new Error("المطعم غير موجود");
  if (rest.cashier_enabled !== true || !rest.cashier_pin) {
    throw new Error("نظام الكاشير غير مفعّل — فعّله من الإعدادات");
  }
  if (String(rest.cashier_pin) !== pin.trim())
    throw new Error("رمز PIN غير صحيح");

  const expiresAt = new Date(Date.now() + STAFF_SESSION_TTL_MS).getTime();
  const payload = `csh.${rest.id}.${expiresAt}`;
  const sig = await hmacSign(payload);
  return {
    token: `${payload}.${sig}`,
    expiresAt: new Date(expiresAt).toISOString(),
    restaurant: {
      id: rest.id as string,
      name: (rest.name as string) ?? "",
      logo_url: (rest.logo_url as string | null) ?? null,
    },
  };
}

/** Verifies the shared restaurant-wide cashier PIN stored on the restaurant doc. */
export const verifyCashierPin = createServerFn({ method: "POST" })
  .validator((d: { restaurantId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return verifyCashierPinCore(data.restaurantId, data.pin);
  });

// ─── Owner-facing management (settings panel) ──────────────────

/** DB logic without the HTTP layer — also used by tests. */
export async function setCashierPinCore(rid: string, rawPin: string) {
  const cleanPin = rawPin?.trim() ?? "";
  if (!/^\d{4}$/.test(cleanPin)) throw new Error("يجب أن يكون الرمز 4 أرقام");
  const { error } = await supabase
    .from("restaurants")
    .update({ cashier_pin: cleanPin, cashier_enabled: true })
    .eq("id", rid);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function disableCashierCore(rid: string) {
  const { error } = await supabase
    .from("restaurants")
    .update({ cashier_enabled: false, cashier_pin: null })
    .eq("id", rid);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function getCashierStatusCore(rid: string) {
  const rest = await loadCashierConfig(rid);
  return { enabled: !!rest?.cashier_enabled && !!rest?.cashier_pin };
}

export const setCashierPin = createServerFn({ method: "POST" })
  .validator((d: { pin: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return setCashierPinCore(rid, data.pin);
  });

export const disableCashier = createServerFn({ method: "POST" }).handler(
  async () => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return disableCashierCore(rid);
  },
);

export const getCashierStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return getCashierStatusCore(rid);
  },
);

// ─── Cashier self-service ordering (create new orders from menu) ──

/** Cashier create-order input: shared order payload + cashier token. */
export type CashierNewOrderInput = NewOrderInput & { token: string };

/** DB logic: fetch categories + available menu items + tables for the cashier menu. */
export async function cashierGetMenuCore(token: string) {
  const restaurantId = await resolveCashierRestaurantId(token);
  return fetchMenuForRestaurantCore(restaurantId);
}

export const cashierGetMenu = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return cashierGetMenuCore(token);
  });

/** DB logic: create a new order (status 'new') + its order_items, then return for printing. */
export async function cashierCreateOrderCore(input: CashierNewOrderInput) {
  const restaurantId = await resolveCashierRestaurantId(input.token);
  const { token: _token, ...orderInput } = input;
  return createOrderForRestaurantCore(restaurantId, orderInput);
}

export const cashierCreateOrder = createServerFn({ method: "POST" })
  .validator((d: CashierNewOrderInput) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return cashierCreateOrderCore(data);
  });

// ─── Seed the default demo menu into the restaurant's database ──
// Lets the owner fill an empty menu (categories + items + structured
// options + tables) so the real cashier screen shows the demo dishes.

/** DB logic: idempotently insert the default menu + tables for a restaurant. */
export async function seedCashierMenuCore(rid: string) {
  // Categories (skip existing ids)
  const { data: existingCats } = await supabase
    .from("categories")
    .select("id")
    .eq("restaurant_id", rid);
  const existingCatIds = new Set(
    (existingCats ?? []).map((c: any) => c.id as string),
  );
  const missingCats = DEFAULT_CATEGORIES.filter(
    (c) => !existingCatIds.has(c.id),
  );
  const catRows = missingCats.map((c) => ({
    id: c.id,
    restaurant_id: rid,
    name: c.name,
    display_order: c.display_order,
  }));
  if (catRows.length) {
    const { error } = await supabase.from("categories").insert(catRows);
    if (error) throw new Error(error.message);
  }

  // Items (skip existing ids) + their options
  const { data: existingItems } = await supabase
    .from("menu_items")
    .select("id")
    .eq("restaurant_id", rid);
  const existingItemIds = new Set(
    (existingItems ?? []).map((i: any) => i.id as string),
  );
  const missingItems = DEFAULT_MENU_ITEMS.filter(
    (i) => !existingItemIds.has(i.id),
  );

  for (const item of missingItems) {
    const { error } = await supabase.from("menu_items").insert({
      id: item.id,
      restaurant_id: rid,
      name: item.name,
      description: item.description,
      price: item.price,
      category_id: item.category_id,
      image_url: item.image_url,
      is_available: item.is_available,
    });
    if (error) throw new Error(error.message);

    if (item.options.length) {
      let order = 0;
      for (const opt of item.options) {
        const { data: optRow, error: optErr } = await supabase
          .from("menu_item_options")
          .insert({
            restaurant_id: rid,
            menu_item_id: item.id,
            name: opt.name,
            required: opt.required,
            multi: opt.multi,
            display_order: order,
          })
          .select("id")
          .single();
        if (optErr) throw new Error(optErr.message);
        let cOrder = 0;
        for (const ch of opt.choices) {
          const { error: chErr } = await supabase
            .from("menu_item_option_choices")
            .insert({
              option_id: (optRow as any).id,
              name: ch.name,
              price_delta: ch.price_delta,
              display_order: cOrder,
            });
          if (chErr) throw new Error(chErr.message);
          cOrder++;
        }
        order++;
      }
    }
  }

  // Tables (if none exist)
  const { data: existingTables } = await supabase
    .from("tables")
    .select("id")
    .eq("restaurant_id", rid);
  if (!(existingTables ?? []).length) {
    const tableRows = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      restaurant_id: rid,
      table_number: n,
    }));
    const { error } = await supabase.from("tables").insert(tableRows);
    if (error) throw new Error(error.message);
  }

  return {
    insertedCategories: catRows.length,
    insertedItems: missingItems.length,
  };
}

export const seedCashierMenu = createServerFn({ method: "POST" }).handler(
  async () => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return seedCashierMenuCore(rid);
  },
);
