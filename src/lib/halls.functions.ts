import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { requireRestaurantId } from "@/lib/server-staff-auth";
import {
  buildTableRows,
  loadHallsSnapshot,
  newQrToken,
  pickFreeNumbers,
  usedTableNumbers,
  type HallsSnapshot,
} from "@/lib/halls";

// ─── Halls + tables management (settings surface) ────────────────
// Every handler is owner/staff scoped through `requireRestaurantId`.
// Without a configured backend the calls return an empty snapshot so the
// settings page still renders in backend-free preview mode.

const EMPTY: HallsSnapshot = { halls: [], tables: [] };

/** Reads every hall + table of the caller's restaurant. */
export const hallsLoad = createServerFn({ method: "GET" }).handler(
  async (): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return loadHallsSnapshot(rid);
  },
);

type HallInput = {
  name: string;
  tableCount: number;
  startNumber: number;
};

function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

/** Creates a hall plus `tableCount` tables numbered from `startNumber`. */
export const hallsCreate = createServerFn({ method: "POST" })
  .validator((d: HallInput) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const name = cleanName(data.name);
    if (!name) throw new Error("اسم القاعة مطلوب");

    const count = Math.max(0, Math.floor(Number(data.tableCount) || 0));
    const start = Math.max(1, Math.floor(Number(data.startNumber) || 1));

    // Hall names are unique per restaurant so the cashier picker stays clear.
    const { data: existingHalls } = await supabase
      .from("halls")
      .select("id,name,display_order")
      .eq("restaurant_id", rid);
    const clash = ((existingHalls ?? []) as { name: string }[]).some(
      (h) => h.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new Error("يوجد قاعة بنفس الاسم");

    const displayOrder =
      ((existingHalls ?? []) as { display_order?: number }[]).reduce(
        (m, h) => Math.max(m, Number(h.display_order ?? 0) + 1),
        0,
      ) || 0;

    const { data: hall, error: hallErr } = await supabase
      .from("halls")
      .insert({ restaurant_id: rid, name, display_order: displayOrder })
      .select("id")
      .single();
    if (hallErr) throw new Error(hallErr.message);
    const hallId = (hall as any).id as string;

    if (count > 0) {
      const used = await usedTableNumbers(rid, hallId);
      const numbers = pickFreeNumbers(used, count, start);
      const { error } = await supabase
        .from("tables")
        .insert(buildTableRows(rid, hallId, numbers));
      if (error) throw new Error(error.message);
    }

    return loadHallsSnapshot(rid);
  });

/** Renames a hall. */
export const hallsRename = createServerFn({ method: "POST" })
  .validator((d: { hallId: string; name: string }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const name = cleanName(data.name);
    if (!name) throw new Error("اسم القاعة مطلوب");
    if (data.hallId === "main")
      throw new Error("لا يمكن تعديل القاعة الرئيسية");

    const { data: existingHalls } = await supabase
      .from("halls")
      .select("id,name")
      .eq("restaurant_id", rid);
    const clash = (
      (existingHalls ?? []) as { id: string; name: string }[]
    ).some(
      (h) =>
        h.id !== data.hallId &&
        h.name.trim().toLowerCase() === name.toLowerCase(),
    );
    if (clash) throw new Error("يوجد قاعة بنفس الاسم");

    const { error } = await supabase
      .from("halls")
      .update({ name })
      .eq("id", data.hallId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadHallsSnapshot(rid);
  });

/**
 * Deletes a hall. Its tables are reassigned to the main hall by default so
 * historic orders keep resolving; pass `deleteTables` to remove them too.
 */
export const hallsDelete = createServerFn({ method: "POST" })
  .validator((d: { hallId: string; deleteTables: boolean }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    if (data.hallId === "main") throw new Error("لا يمكن حذف القاعة الرئيسية");

    const { data: rows } = await supabase
      .from("tables")
      .select("id")
      .eq("restaurant_id", rid)
      .eq("hall_id", data.hallId);
    const ids = ((rows ?? []) as { id: string }[]).map((r) => r.id);

    if (data.deleteTables && ids.length) {
      // Never orphan orders: clear the table reference on historic orders.
      for (const id of ids) {
        await supabase
          .from("orders")
          .update({ table_id: null })
          .eq("table_id", id);
      }
      for (const id of ids) {
        await supabase.from("tables").delete().eq("id", id);
      }
    } else if (ids.length) {
      const { error } = await supabase
        .from("tables")
        .update({ hall_id: null })
        .eq("restaurant_id", rid)
        .eq("hall_id", data.hallId);
      if (error) throw new Error(error.message);
    }

    const { error: hallErr } = await supabase
      .from("halls")
      .delete()
      .eq("id", data.hallId)
      .eq("restaurant_id", rid);
    if (hallErr) throw new Error(hallErr.message);

    return loadHallsSnapshot(rid);
  });

/** Appends tables to a hall. Pass `hallId: "main"` for the legacy hall. */
export const hallsAddTables = createServerFn({ method: "POST" })
  .validator((d: { hallId: string; count: number; startNumber: number }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const count = Math.floor(Number(data.count) || 0);
    if (!Number.isInteger(count) || count < 1)
      throw new Error("أدخل عدداً صحيحاً أكبر من صفر");

    const hallId = data.hallId === "main" ? null : data.hallId;
    if (hallId !== null) {
      const { data: hall } = await supabase
        .from("halls")
        .select("id")
        .eq("id", hallId)
        .eq("restaurant_id", rid)
        .maybeSingle();
      if (!hall) throw new Error("القاعة غير موجودة");
    }

    const used = await usedTableNumbers(rid, hallId);
    const start = Math.max(1, Math.floor(Number(data.startNumber) || 1));
    const numbers = pickFreeNumbers(used, count, start);
    if (!numbers.length) throw new Error("لا توجد أرقام متاحة");

    const { error } = await supabase
      .from("tables")
      .insert(buildTableRows(rid, hallId, numbers));
    if (error) throw new Error(error.message);

    return loadHallsSnapshot(rid);
  });

/** Changes a single table's number inside its hall. */
export const hallsRenameTable = createServerFn({ method: "POST" })
  .validator((d: { tableId: string; tableNumber: number }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const n = Math.floor(Number(data.tableNumber) || 0);
    if (!Number.isInteger(n) || n < 1) throw new Error("أدخل رقماً صحيحاً");

    const { data: table } = await supabase
      .from("tables")
      .select("id,hall_id,table_number")
      .eq("id", data.tableId)
      .eq("restaurant_id", rid)
      .maybeSingle();
    if (!table) throw new Error("الطاولة غير موجودة");

    const hallId = ((table as any).hall_id ?? null) as string | null;
    const used = await usedTableNumbers(rid, hallId);
    used.delete(Number((table as any).table_number));
    if (used.has(n)) throw new Error("الرقم مستخدم بالفعل في هذه القاعة");

    const { error } = await supabase
      .from("tables")
      .update({ table_number: n })
      .eq("id", data.tableId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadHallsSnapshot(rid);
  });

/** Deletes one table and unlinks it from historic orders. */
export const hallsDeleteTable = createServerFn({ method: "POST" })
  .validator((d: { tableId: string }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    await supabase
      .from("orders")
      .update({ table_id: null })
      .eq("table_id", data.tableId);
    const { error } = await supabase
      .from("tables")
      .delete()
      .eq("id", data.tableId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadHallsSnapshot(rid);
  });

/**
 * Issues a fresh QR token for one table, invalidating the previously printed
 * code for that table.
 */
export const hallsRegenerateTableQr = createServerFn({ method: "POST" })
  .validator((d: { tableId: string }) => d)
  .handler(async ({ data }): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const { error } = await supabase
      .from("tables")
      .update({ qr_token: newQrToken() })
      .eq("id", data.tableId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadHallsSnapshot(rid);
  });

/**
 * Backfills QR tokens for tables that never got one (e.g. rows created by the
 * cashier demo-menu seed) so every table can produce a working code.
 */
export const hallsBackfillQr = createServerFn({ method: "POST" }).handler(
  async (): Promise<HallsSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const { data: rows } = await supabase
      .from("tables")
      .select("id,qr_token")
      .eq("restaurant_id", rid);
    const missing = (
      (rows ?? []) as { id: string; qr_token?: string }[]
    ).filter((r) => !r.qr_token);
    for (const row of missing) {
      await supabase
        .from("tables")
        .update({ qr_token: newQrToken() })
        .eq("id", row.id);
    }

    return loadHallsSnapshot(rid);
  },
);
