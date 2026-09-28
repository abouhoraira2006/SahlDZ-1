import { supabase } from "@/integrations/supabase/client";
import { getMenuOptionsForItemsCore } from "@/lib/menu-options.functions";
import { notifyDriversForOrderCore } from "@/lib/delivery-drivers.functions";
import { MAIN_HALL_ID, MAIN_HALL_NAME } from "@/lib/halls";
import { resolveLineKitchen, loadMenuRouting } from "@/lib/kitchens";

// ─── Shared order creation / menu loading ──────────────────────
// Used by both the cashier (POS) and waiter web screens so an order
// created from either surface lands in the same `orders` collection.

export type OrderMenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  /** Optional per-item kitchen override; wins over the category's kitchen. */
  kitchen_id?: string | null;
  image_url: string | null;
  is_available: boolean;
  created_at?: string;
};

export type OrderCategory = {
  id: string;
  name: string;
  display_order: number;
  /** Kitchen that prepares every item of this category. */
  kitchen_id?: string | null;
};

export type OrderTableInfo = {
  id: string;
  table_number: number;
  hall_id: string | null;
  hall_name: string;
};

/** A hall the cashier can pick before choosing a table. */
export type OrderHallInfo = {
  id: string;
  name: string;
  table_count: number;
};

export type NewOrderLine = {
  menu_item_id: string;
  name: string;
  price: number;
  quantity: number;
  note?: string;
  options?: Array<{ label: string; choice: string; price_delta: number }>;
  /** Where this line was added from, so the order can be split per kitchen. */
  category_id?: string | null;
};

export type NewOrderInput = {
  order_type: "dine_in" | "takeaway" | "delivery";
  table_number?: number;
  /** Required when the same table number exists in more than one hall. */
  hall_id?: string | null;
  customer_name?: string;
  customer_phone?: string;
  customer_address?: string;
  notes?: string;
  lines: NewOrderLine[];
};

export async function fetchMenuForRestaurantCore(restaurantId: string) {
  const [catRes, itemRes, tableRes, hallRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id,name,display_order,kitchen_id")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("menu_items")
      .select("id,name,description,price,category_id,kitchen_id,image_url,is_available")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("tables")
      .select("id,table_number,hall_id")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("halls")
      .select("id,name,display_order")
      .eq("restaurant_id", restaurantId),
  ]);
  if (catRes.error) throw new Error(catRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);
  if (tableRes.error) throw new Error(tableRes.error.message);
  if (hallRes.error) throw new Error(hallRes.error.message);

  const categories = ((catRes.data ?? []) as OrderCategory[]).sort(
    (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
  );
  const items = ((itemRes.data ?? []) as OrderMenuItem[]).sort((a, b) =>
    String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  );

  // Resolve every item to its kitchen once, here, so the composer, the order
  // writer and the kitchen terminals all agree on the same routing.
  const categoryKitchen = new Map<string, string>();
  for (const c of categories) {
    if (c.kitchen_id) categoryKitchen.set(c.id, c.kitchen_id);
  }
  for (const i of items) {
    i.kitchen_id = resolveLineKitchen({
      item_kitchen_id: i.kitchen_id,
      category_kitchen_id: categoryKitchen.get(i.category_id ?? ""),
    });
  }

  // Halls are optional metadata: a restaurant with no `halls` rows still gets
  // a single synthetic main hall so every surface can render a hall picker.
  const rawHalls = (
    (hallRes.data ?? []) as {
      id: string;
      name: string;
      display_order?: number;
    }[]
  ).sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

  const hallName = new Map<string, string>();
  for (const h of rawHalls) hallName.set(h.id, h.name);
  const hasMain = rawHalls.some((h) => h.id === MAIN_HALL_ID);

  const rawTables = (tableRes.data ?? []) as {
    id: string;
    table_number: number;
    hall_id: string | null;
  }[];

  const tables: OrderTableInfo[] = rawTables
    .map((t) => {
      const legacy = !t.hall_id || !hallName.has(t.hall_id);
      return {
        id: t.id,
        table_number: t.table_number,
        hall_id: legacy ? null : t.hall_id,
        hall_name: legacy ? MAIN_HALL_NAME : hallName.get(t.hall_id!)!,
      };
    })
    .sort((a, b) => a.table_number - b.table_number);

  const halls: OrderHallInfo[] = rawHalls.map((h) => ({
    id: h.id,
    name: h.name,
    table_count: tables.filter((t) => t.hall_id === h.id).length,
  }));

  // Tables with no hall (or a dangling hall_id) belong to the synthetic main
  // hall. Add it when the owner has no explicit row for it.
  if (!hasMain) {
    const orphanCount = tables.filter((t) => t.hall_id === null).length;
    if (orphanCount) {
      halls.unshift({
        id: MAIN_HALL_ID,
        name: MAIN_HALL_NAME,
        table_count: orphanCount,
      });
    }
  }

  // Nothing configured at all — one empty main hall keeps the picker usable.
  if (!halls.length) {
    halls.push({ id: MAIN_HALL_ID, name: MAIN_HALL_NAME, table_count: 0 });
  }

  const { optionsByItem } = await getMenuOptionsForItemsCore(
    items.map((i) => i.id),
  );

  return { categories, items, tables, halls, optionsByItem };
}

/** DB logic: create a new order (status 'new') + its order_items. */
export async function createOrderForRestaurantCore(
  restaurantId: string,
  input: NewOrderInput,
  opts?: { servedBy?: string | null; createdByRole?: string | null },
) {
  if (!input.lines?.length) throw new Error("أضف صنفاً واحداً على الأقل");
  if (!["dine_in", "takeaway", "delivery"].includes(input.order_type))
    throw new Error("نوع الطلب غير صالح");

  // Resolve table id for dine_in
  let tableId: string | null = null;
  if (input.order_type === "dine_in") {
    if (!input.table_number) throw new Error("حدد رقم الطاولة");
    // The same number may exist in several halls, so the read is deliberately
    // multi-row: the caller narrows it by hall, and we fall back to a unique
    // match when the restaurant has only one table with that number.
    // "main" is the synthetic hall for hall-less tables.
    const { data: rows, error } = await supabase
      .from("tables")
      .select("id,hall_id")
      .eq("restaurant_id", restaurantId)
      .eq("table_number", input.table_number);
    if (error) throw new Error(error.message);
    const candidates = (rows ?? []) as { id: string; hall_id: string | null }[];
    if (!candidates.length) throw new Error("رقم الطاولة غير موجود");

    let match: { id: string; hall_id: string | null } | undefined;
    if (input.hall_id === undefined) {
      match = candidates.length === 1 ? candidates[0] : undefined;
    } else {
      const wanted =
        input.hall_id === MAIN_HALL_ID ? null : (input.hall_id ?? null);
      match = candidates.find((t) => (t.hall_id ?? null) === wanted);
    }
    if (!match)
      throw new Error(
        input.hall_id === undefined && candidates.length > 1
          ? "هذا الرقم موجود في أكثر من قاعة — حدد القاعة"
          : "رقم الطاولة غير موجود في هذه القاعة",
      );
    tableId = match.id;
  }

  // Determine the next per-day order number
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: lastOrder } = await supabase
    .from("orders")
    .select("daily_number")
    .eq("restaurant_id", restaurantId)
    .gte("created_at", startOfDay.toISOString())
    .order("daily_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const dailyNumber = (((lastOrder as any)?.daily_number as number) ?? 0) + 1;

  const total = input.lines.reduce((sum, l) => {
    const optionTotal = (l.options ?? []).reduce(
      (s, o) => s + (o.price_delta || 0),
      0,
    );
    const unitPrice = (l.price || 0) + optionTotal;
    return sum + unitPrice * (l.quantity || 1);
  }, 0);

  const now = new Date().toISOString();
  const orderPayload = {
    restaurant_id: restaurantId,
    table_id: tableId,
    status: "new",
    acknowledged: false,
    stock_decremented: false,
    total,
    order_type: input.order_type,
    customer_name: input.customer_name || null,
    customer_phone: input.customer_phone || null,
    customer_address: input.customer_address || null,
    notes: input.notes || null,
    daily_number: dailyNumber,
    served_by: opts?.servedBy ?? null,
    created_by_role: opts?.createdByRole ?? null,
    created_at: now,
  };

  const { data: created, error } = await supabase
    .from("orders")
    .insert(orderPayload)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const orderId = (created as any).id;

  // Kitchen routing is resolved server-side from the current menu, never from
  // whatever the client claimed, and then snapshotted onto the line. That way
  // a later menu edit can never rewrite which kitchen cooks a historic order.
  const { categoryToKitchen, itemToKitchen } =
    await loadMenuRouting(restaurantId);

  const itemRows = input.lines.map((l) => ({
    order_id: orderId,
    menu_item_id: l.menu_item_id,
    name_snapshot: l.name,
    quantity: l.quantity || 1,
    price_snapshot: l.price || 0,
    note: l.note || null,
    options_snapshot: l.options?.length ? JSON.stringify(l.options) : null,
    category_id: l.category_id ?? null,
    kitchen_id:
      itemToKitchen.get(l.menu_item_id) ??
      resolveLineKitchen({ category_kitchen_id: categoryToKitchen.get(l.category_id ?? "") }),
  }));
  const { error: itemsErr } = await supabase
    .from("order_items")
    .insert(itemRows);
  if (itemsErr) throw new Error(itemsErr.message);

  if (input.order_type === "delivery") {
    void notifyDriversForOrderCore({
      restaurantId,
      orderId,
      total,
      customerName: input.customer_name || null,
      customerPhone: input.customer_phone || null,
      customerAddress: input.customer_address || null,
      items: input.lines.map((l) => ({
        name: l.name,
        quantity: l.quantity || 1,
      })),
      dailyNumber,
    });
  }

  return {
    orderId,
    dailyNumber,
    total,
    created_at: now,
    order_type: input.order_type,
    table_number: input.table_number ?? null,
    customer_name: input.customer_name || null,
    customer_phone: input.customer_phone || null,
    customer_address: input.customer_address || null,
    notes: input.notes || null,
    lines: input.lines,
  };
}
