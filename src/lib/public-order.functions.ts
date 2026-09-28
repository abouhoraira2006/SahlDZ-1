import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { getMenuOptionsForItemsCore } from "@/lib/menu-options.functions";
import type { MenuOption } from "@/lib/menu-options.functions";
import { loadMenuRouting, resolveLineKitchen } from "@/lib/kitchens";

export type PublicRestaurant = {
  id: string;
  name: string;
  logo_url: string | null;
};

export type PublicCategory = {
  id: string;
  name: string;
  display_order: number;
  /** Kitchen that prepares every item of this category. */
  kitchen_id?: string | null;
};

export type PublicMenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  /** Resolved kitchen for this item, used to split the order on write. */
  kitchen_id?: string | null;
  image_url: string | null;
  is_available: boolean | null;
};

export type PublicMenuData = {
  enabled: boolean;
  restaurant: PublicRestaurant | null;
  categories: PublicCategory[];
  items: PublicMenuItem[];
  optionsByItem: Record<string, MenuOption[]>;
  tableNumber?: number | null;
};

async function resolveRestaurantByTakeawayToken(token: string) {
  const { data: rest } = await supabase
    .from("restaurants")
    .select("id,name,logo_url,takeaway_enabled,takeaway_link_token")
    .eq("takeaway_link_token", token)
    .maybeSingle();
  const r = rest as any;
  if (!r) return null;
  return {
    id: r.id as string,
    name: (r.name as string) || "مطعم",
    logo_url: (r.logo_url as string | null) ?? null,
    enabled: r.takeaway_enabled === true,
  };
}

export const getTakeawayMenu = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb()) {
      return {
        enabled: false,
        restaurant: null as PublicRestaurant | null,
        categories: [] as PublicCategory[],
        items: [] as PublicMenuItem[],
        optionsByItem: {} as Record<string, MenuOption[]>,
      } satisfies PublicMenuData;
    }

    const restaurant = await resolveRestaurantByTakeawayToken(token);
    const empty: PublicMenuData = {
      enabled: false,
      restaurant: restaurant
        ? {
            id: restaurant.id,
            name: restaurant.name,
            logo_url: restaurant.logo_url,
          }
        : null,
      categories: [],
      items: [],
      optionsByItem: {},
    };
    if (!restaurant || !restaurant.enabled) return empty;

    const menu = await fetchMenu(restaurant.id);
    return {
      enabled: true,
      restaurant,
      ...menu,
    } satisfies PublicMenuData;
  });

async function fetchMenu(restaurantId: string) {
  const [catRes, itemRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id,name,display_order,kitchen_id")
      .eq("restaurant_id", restaurantId)
      .order("display_order", { ascending: true }),
    supabase
      .from("menu_items")
      .select("id,name,description,price,category_id,kitchen_id,image_url,is_available")
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: true }),
  ]);
  if (catRes.error) throw new Error(catRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);
  const categories = (catRes.data ?? []) as PublicCategory[];

  // Resolve routing once so a public order is split per kitchen exactly like
  // a cashier order is.
  const catKitchen = new Map<string, string>();
  for (const c of categories) {
    if (c.kitchen_id) catKitchen.set(c.id, c.kitchen_id);
  }
  const items = (itemRes.data ?? []) as PublicMenuItem[];
  for (const i of items) {
    i.kitchen_id = resolveLineKitchen({
      item_kitchen_id: i.kitchen_id,
      category_kitchen_id: catKitchen.get(i.category_id ?? ""),
    });
  }
  const { optionsByItem } = await getMenuOptionsForItemsCore(
    items.map((i) => i.id),
  );
  return {
    categories,
    items,
    optionsByItem,
  };
}

export type TableMenuData = PublicMenuData & { tableNumber: number | null };

export const getTableMenu = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb()) {
      return {
        enabled: false,
        restaurant: null as PublicRestaurant | null,
        categories: [] as PublicCategory[],
        items: [] as PublicMenuItem[],
        optionsByItem: {} as Record<string, MenuOption[]>,
        tableNumber: null,
      } satisfies TableMenuData;
    }

    const { data: tableRow } = await supabase
      .from("tables")
      .select("id,restaurant_id,table_number,qr_token")
      .eq("qr_token", token)
      .maybeSingle();
    const t = tableRow as any;
    if (!t) {
      return {
        enabled: false,
        restaurant: null,
        categories: [],
        items: [],
        optionsByItem: {},
        tableNumber: null,
      } satisfies TableMenuData;
    }

    const { data: rest } = await supabase
      .from("restaurants")
      .select("id,name,logo_url")
      .eq("id", t.restaurant_id)
      .maybeSingle();
    const r = rest as any;
    if (!r) {
      return {
        enabled: false,
        restaurant: null,
        categories: [],
        items: [],
        optionsByItem: {},
        tableNumber: t.table_number,
      } satisfies TableMenuData;
    }

    const menu = await fetchMenu(r.id);
    return {
      enabled: true,
      restaurant: {
        id: r.id,
        name: (r.name as string) || "مطعم",
        logo_url: (r.logo_url as string | null) ?? null,
      },
      ...menu,
      tableNumber: t.table_number as number,
    } satisfies TableMenuData;
  });

export type PublicOrderOptionSelection = {
  label: string;
  choice: string;
  price_delta: number;
};

export type PublicOrderLine = {
  menu_item_id: string;
  name: string;
  quantity: number;
  price: number;
  note?: string | null;
  options?: PublicOrderOptionSelection[] | null;
  /** Where the line was added from, so the order can be split per kitchen. */
  category_id?: string | null;
};

type PlaceOrderContext = {
  restaurantId: string;
  orderType: "takeaway" | "dine_in";
  tableId?: string | null;
  tableNumber?: number | null;
};

async function createPublicOrderCore(
  ctx: PlaceOrderContext,
  name: string,
  phone: string | null,
  lines: PublicOrderLine[],
) {
  if (!lines?.length) throw new Error("أضف صنفاً واحداً على الأقل");
  if (!name) throw new Error("اكتب اسمك ليتم تجهيز طلبك");

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const { data: lastOrder } = await supabase
    .from("orders")
    .select("daily_number")
    .eq("restaurant_id", ctx.restaurantId)
    .gte("created_at", startOfDay.toISOString())
    .order("daily_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  const dailyNumber = ((lastOrder?.daily_number as number) ?? 0) + 1;

  const total = lines.reduce((sum, l) => {
    const optionTotal = (l.options ?? []).reduce(
      (s, o) => s + (o.price_delta || 0),
      0,
    );
    return sum + ((l.price || 0) + optionTotal) * (l.quantity || 1);
  }, 0);

  const now = new Date().toISOString();
  const { data: created, error } = await supabase
    .from("orders")
    .insert({
      restaurant_id: ctx.restaurantId,
      table_id: ctx.tableId ?? null,
      status: "new",
      acknowledged: false,
      stock_decremented: false,
      total,
      order_type: ctx.orderType,
      customer_name: name,
      customer_phone: phone,
      customer_address: null,
      notes: null,
      daily_number: dailyNumber,
      created_at: now,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  const orderId = (created as any).id;

  // Same server-side routing snapshot as the cashier path: resolved from the
  // live menu, never from the client, so historic tickets stay correct.
  const { categoryToKitchen, itemToKitchen } = await loadMenuRouting(
    ctx.restaurantId,
  );

  const itemRows = lines.map((l) => ({
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
      resolveLineKitchen({
        category_kitchen_id: categoryToKitchen.get(l.category_id ?? ""),
      }),
  }));
  const { error: itemsErr } = await supabase
    .from("order_items")
    .insert(itemRows);
  if (itemsErr) throw new Error(itemsErr.message);

  return {
    orderId,
    dailyNumber,
    total,
    created_at: now,
    table_number: ctx.tableNumber ?? null,
  };
}

export type PlaceTakeawayOrderInput = {
  token: string;
  customer_name: string;
  customer_phone?: string | null;
  lines: PublicOrderLine[];
};

export const placeTakeawayOrder = createServerFn({ method: "POST" })
  .validator((d: PlaceTakeawayOrderInput) => d)
  .handler(async ({ data }) => {
    const input = data as PlaceTakeawayOrderInput;
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يُرجى تكوين الاتصال");

    const restaurant = await resolveRestaurantByTakeawayToken(input.token);
    if (!restaurant || !restaurant.enabled)
      throw new Error("الرابط غير صالح أو الطلب السريع معطّل");

    return createPublicOrderCore(
      {
        restaurantId: restaurant.id,
        orderType: "takeaway",
        tableId: null,
        tableNumber: null,
      },
      input.customer_name?.trim() ?? "",
      input.customer_phone?.trim() || null,
      input.lines,
    );
  });

export type PlaceTableOrderInput = {
  token: string;
  lines: PublicOrderLine[];
};

export const placeTableOrder = createServerFn({ method: "POST" })
  .validator((d: PlaceTableOrderInput) => d)
  .handler(async ({ data }) => {
    const input = data as PlaceTableOrderInput;
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يُرجى تكوين الاتصال");

    const { data: tableRow } = await supabase
      .from("tables")
      .select("id,restaurant_id,table_number")
      .eq("qr_token", input.token)
      .maybeSingle();
    const t = tableRow as any;
    if (!t) throw new Error("الرابط غير صالح");

    return createPublicOrderCore(
      {
        restaurantId: t.restaurant_id as string,
        orderType: "dine_in",
        tableId: t.id as string,
        tableNumber: t.table_number as number,
      },
      "طاولة",
      null,
      input.lines,
    );
  });

export const PUBLIC_ORDER_STATES = [
  "new",
  "preparing",
  "ready",
  "served",
  "paid",
] as const;
export type PublicOrderStatus = (typeof PUBLIC_ORDER_STATES)[number];

export type PublicOrderTrackResult = {
  found: boolean;
  status: PublicOrderStatus | null;
  dailyNumber: number | null;
  ready: boolean;
  delivered: boolean;
};

export const getPublicOrderStatus = createServerFn({ method: "GET" })
  .validator((d: { orderId: string }) => d)
  .handler(async ({ data }) => {
    const { orderId } = data as { orderId: string };
    const db = getFirebaseDb();
    if (!db)
      return {
        found: false,
        status: null,
        dailyNumber: null,
        ready: false,
        delivered: false,
      } satisfies PublicOrderTrackResult;

    const { getDoc, doc } = await import("firebase/firestore");
    const snap = await getDoc(doc(db, "orders", orderId));
    if (!snap.exists()) {
      return {
        found: false,
        status: null,
        dailyNumber: null,
        ready: false,
        delivered: false,
      } satisfies PublicOrderTrackResult;
    }

    const o = snap.data() as any;
    const status = (o.status as string) ?? "new";
    return {
      found: true,
      status: (PUBLIC_ORDER_STATES.includes(status as any)
        ? status
        : null) as PublicOrderStatus | null,
      dailyNumber: (o.daily_number as number) ?? null,
      ready: status === "ready",
      delivered: status === "served" || status === "paid",
    } satisfies PublicOrderTrackResult;
  });
