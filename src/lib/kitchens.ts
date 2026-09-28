import { supabase } from "@/integrations/supabase/client";

// ─── Kitchens (المطابخ) + print routing ──────────────────────────
//
// A restaurant owns any number of kitchens (مطبخ البيتزا، مطبخ الحلويات، مطبخ
// الشواية…). Every menu category points at exactly one kitchen, so when the
// cashier sends an order the app can split it per kitchen and each kitchen
// terminal prints its own slice on its own printer.
//
// Data model
//   `kitchens` { restaurant_id, name, code, display_order, is_active,
//                printer_name, copies, auto_print, created_at }
//
// Routing chain
//   category.kitchen_id  → default destination for every item in the category
//   menu_item.kitchen_id → optional per-item override, wins over the category
//   order_item.kitchen_id → the RESOLVED value, snapshotted when the order is
//                           created so later menu edits never rewrite history
//
// A kitchen with `printer_name === null` prints to the system default printer,
// which is the common case: each kitchen terminal owns exactly one printer.

/** Synthetic kitchen that owns every category with no explicit assignment. */
export const DEFAULT_KITCHEN_ID = "default";
export const DEFAULT_KITCHEN_NAME = "المطبخ الرئيسي";

export type Kitchen = {
  id: string;
  restaurant_id: string;
  name: string;
  /** Short stable label used on tickets, e.g. "PIZZA". */
  code: string;
  display_order: number;
  is_active: boolean;
  /** null = print to the operating system default printer. */
  printer_name: string | null;
  /** How many copies the terminal prints per ticket. */
  copies: number;
  /** Whether the terminal auto-prints without asking the chef. */
  auto_print: boolean;
};

export type KitchensSnapshot = {
  kitchens: Kitchen[];
  /** True when the restaurant never configured any kitchen. */
  is_empty: boolean;
};

/** The single fallback kitchen used when a restaurant has none configured. */
export function defaultKitchen(): Kitchen {
  return {
    id: DEFAULT_KITCHEN_ID,
    restaurant_id: "",
    name: DEFAULT_KITCHEN_NAME,
    code: "MAIN",
    display_order: 0,
    is_active: true,
    printer_name: null,
    copies: 1,
    auto_print: true,
  };
}

/** True for the synthetic kitchen id that is not a real Firestore document. */
export function isSyntheticKitchen(id: string | null | undefined): boolean {
  return !id || id === DEFAULT_KITCHEN_ID;
}

/**
 * Normalizes a kitchen id coming from Firestore. Rows written before the
 * kitchens feature, and the synthetic default, all resolve to
 * `DEFAULT_KITCHEN_ID` so every kitchen screen has a valid target.
 */
export function resolveKitchenId(raw: unknown): string {
  const id = String(raw ?? "").trim();
  return id || DEFAULT_KITCHEN_ID;
}

/**
 * Resolves where a single order line must be prepared and printed.
 *
 * The per-item override wins, because a restaurant can legitimately send one
 * dish from the "mains" category to the grill while the rest of that category
 * goes to the main kitchen.
 */
export function resolveLineKitchen(input: {
  item_kitchen_id?: unknown;
  category_kitchen_id?: unknown;
}): string {
  const item = String(input.item_kitchen_id ?? "").trim();
  if (item) return item;
  return resolveKitchenId(input.category_kitchen_id);
}

/**
 * Groups order lines by the kitchen that must handle them, preserving the
 * original line order inside each group so tickets read like the order.
 */
export function groupLinesByKitchen<T extends { kitchen_id?: string | null }>(
  lines: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const key = resolveKitchenId(line.kitchen_id);
    const bucket = groups.get(key);
    if (bucket) bucket.push(line);
    else groups.set(key, [line]);
  }
  return groups;
}

function byOrder(a: Kitchen, b: Kitchen) {
  const d = (a.display_order ?? 0) - (b.display_order ?? 0);
  if (d !== 0) return d;
  return String(a.name).localeCompare(String(b.name), "ar");
}

/**
 * Loads every kitchen of a restaurant. When none exist, a single synthetic
 * default kitchen is returned so the settings page, the category editor and
 * the kitchen terminal all have something valid to bind to without a
 * migration step.
 */
export async function loadKitchensSnapshot(
  restaurantId: string,
): Promise<KitchensSnapshot> {
  const { data, error } = await supabase
    .from("kitchens")
    .select(
      "id,restaurant_id,name,code,display_order,is_active,printer_name,copies,auto_print",
    )
    .eq("restaurant_id", restaurantId);

  if (error) throw new Error(error.message);

  const rows = ((data ?? []) as unknown as Kitchen[]).sort(byOrder);
  if (!rows.length) {
    return { kitchens: [defaultKitchen()], is_empty: true };
  }
  return { kitchens: rows, is_empty: false };
}

/** Kitchen map keyed by id, for cheap lookups while resolving order lines. */
export function kitchenMap(kitchens: Kitchen[]): Map<string, Kitchen> {
  const map = new Map<string, Kitchen>();
  for (const k of kitchens) map.set(k.id, k);
  return map;
}

/**
 * Bulk-loads the routing fields for a menu so the order composer can resolve
 * every line to a kitchen without an extra query per item.
 */
export async function loadMenuRouting(
  restaurantId: string,
): Promise<{
  categoryToKitchen: Map<string, string>;
  itemToKitchen: Map<string, string>;
}> {
  const [catRes, itemRes] = await Promise.all([
    supabase
      .from("categories")
      .select("id,kitchen_id")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("menu_items")
      .select("id,category_id,kitchen_id")
      .eq("restaurant_id", restaurantId),
  ]);

  if (catRes.error) throw new Error(catRes.error.message);
  if (itemRes.error) throw new Error(itemRes.error.message);

  const categoryToKitchen = new Map<string, string>();
  for (const c of (catRes.data ?? []) as {
    id: string;
    kitchen_id?: string | null;
  }[]) {
    if (c.kitchen_id) categoryToKitchen.set(c.id, c.kitchen_id);
  }

  const itemToKitchen = new Map<string, string>();
  for (const i of (itemRes.data ?? []) as {
    id: string;
    category_id?: string | null;
    kitchen_id?: string | null;
  }[]) {
    const resolved = resolveLineKitchen({
      item_kitchen_id: i.kitchen_id,
      category_kitchen_id: categoryToKitchen.get(i.category_id ?? ""),
    });
    itemToKitchen.set(i.id, resolved);
  }

  return { categoryToKitchen, itemToKitchen };
}

/** The next `display_order` value for a restaurant, used when creating. */
export function nextDisplayOrder(existing: Kitchen[]): number {
  return existing.reduce((m, k) => Math.max(m, Number(k.display_order ?? 0) + 1), 0) || 0;
}
