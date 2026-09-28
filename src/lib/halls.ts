import { supabase } from "@/integrations/supabase/client";

// ─── Halls (القاعات) + Tables (الطاولات) ─────────────────────────
//
// A restaurant owns any number of halls. Every hall owns any number of
// tables, and the owner picks the table numbers freely — nothing is capped
// and no numbering is enforced by the app.
//
// Data model
//   `halls`  { restaurant_id, name, display_order, created_at }
//   `tables` { restaurant_id, table_number, hall_id, qr_token, created_at }
//
// `hall_id` is the hall's Firestore document id, or `null` for tables that
// were created before halls existed. Those legacy rows are surfaced under the
// synthetic "main hall" below, so upgrading a live restaurant is seamless and
// requires no migration.

/** Synthetic hall used to group tables that predate the halls feature. */
export const MAIN_HALL_ID = "main";
export const MAIN_HALL_NAME = "القاعة الرئيسية";

export type Hall = {
  id: string;
  restaurant_id: string;
  name: string;
  display_order: number;
};

export type Table = {
  id: string;
  restaurant_id: string;
  table_number: number;
  /** Null for tables created before halls existed. */
  hall_id: string | null;
  qr_token: string | null;
};

/** A hall with its tables already attached and sorted. */
export type HallWithTables = {
  id: string;
  name: string;
  display_order: number;
  /** True for the synthetic hall that owns legacy tables (hall_id === null). */
  is_main: boolean;
  tables: Table[];
};

export type HallsSnapshot = {
  halls: HallWithTables[];
  /** Every table of the restaurant, flat. */
  tables: Table[];
};

/** Stable per-table QR token. Falls back to a random token when missing. */
export function newQrToken(): string {
  const g = globalThis.crypto as Crypto | undefined;
  if (g && typeof g.randomUUID === "function") return g.randomUUID();
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function byNumber(a: Table, b: Table) {
  const d = (a.table_number ?? 0) - (b.table_number ?? 0);
  if (d !== 0) return d;
  return String(a.id).localeCompare(String(b.id));
}

/**
 * Loads every hall and table for a restaurant and groups the tables under
 * their hall. Legacy tables (no `hall_id`) land in the synthetic main hall,
 * which is always returned first so the cashier picker has a sane default.
 */
export async function loadHallsSnapshot(
  restaurantId: string,
): Promise<HallsSnapshot> {
  const [hallRes, tableRes] = await Promise.all([
    supabase
      .from("halls")
      .select("id,restaurant_id,name,display_order")
      .eq("restaurant_id", restaurantId),
    supabase
      .from("tables")
      .select("id,restaurant_id,table_number,hall_id,qr_token")
      .eq("restaurant_id", restaurantId),
  ]);

  if (hallRes.error) throw new Error(hallRes.error.message);
  if (tableRes.error) throw new Error(tableRes.error.message);

  const rawHalls = (hallRes.data ?? []) as Hall[];
  const rawTables = ((tableRes.data ?? []) as Table[]).sort(byNumber);

  const groups = new Map<string, HallWithTables>();
  groups.set(MAIN_HALL_ID, {
    id: MAIN_HALL_ID,
    name: MAIN_HALL_NAME,
    display_order: -1,
    is_main: true,
    tables: [],
  });
  for (const h of rawHalls) {
    groups.set(h.id, {
      id: h.id,
      name: h.name,
      display_order: h.display_order ?? 0,
      is_main: false,
      tables: [],
    });
  }

  for (const t of rawTables) {
    const key = t.hall_id && groups.has(t.hall_id) ? t.hall_id : MAIN_HALL_ID;
    groups.get(key)!.tables.push(t);
  }

  const halls = [...groups.values()].sort((a, b) => {
    // The synthetic main hall leads so it stays the default selection.
    if (a.is_main !== b.is_main) return a.is_main ? -1 : 1;
    const d = (a.display_order ?? 0) - (b.display_order ?? 0);
    if (d !== 0) return d;
    return String(a.id).localeCompare(String(b.id));
  });

  // Drop the synthetic hall when it owns nothing and real halls exist.
  const main = groups.get(MAIN_HALL_ID)!;
  if (!main.tables.length && rawHalls.length) {
    const idx = halls.findIndex((h) => h.is_main);
    if (idx >= 0) halls.splice(idx, 1);
  }

  return { halls, tables: rawTables };
}

/** Table numbers already used inside a given hall (null hall = legacy/main). */
export async function usedTableNumbers(
  restaurantId: string,
  hallId: string | null,
): Promise<Set<number>> {
  const { data, error } = await supabase
    .from("tables")
    .select("table_number,hall_id")
    .eq("restaurant_id", restaurantId);
  if (error) throw new Error(error.message);
  const used = new Set<number>();
  for (const row of (data ?? []) as Table[]) {
    const rowHall = row.hall_id ?? null;
    if (rowHall === hallId) used.add(Number(row.table_number));
  }
  return used;
}

/**
 * Picks `count` unused table numbers for a hall, starting at `start` and
 * walking upward. `count` is intentionally unbounded by the app.
 */
export function pickFreeNumbers(
  used: Set<number>,
  count: number,
  start = 1,
): number[] {
  const taken = new Set(used);
  const out: number[] = [];
  let n = Math.max(1, Math.floor(start) || 1);
  while (out.length < count && n < 100000) {
    if (!taken.has(n)) {
      out.push(n);
      taken.add(n);
    }
    n++;
  }
  return out;
}

/** Build the `tables` rows for a hall, each with a fresh QR token. */
export function buildTableRows(
  restaurantId: string,
  hallId: string | null,
  numbers: number[],
) {
  return numbers.map((table_number) => ({
    restaurant_id: restaurantId,
    hall_id: hallId,
    table_number,
    qr_token: newQrToken(),
    created_at: new Date().toISOString(),
  }));
}
