import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { requireRestaurantId } from "@/lib/server-staff-auth";
import {
  DEFAULT_KITCHEN_ID,
  defaultKitchen,
  isSyntheticKitchen,
  loadKitchensSnapshot,
  nextDisplayOrder,
  type Kitchen,
  type KitchensSnapshot,
} from "@/lib/kitchens";

// ─── Kitchens management (settings surface) ───────────────────────
// Every handler is owner/staff scoped through `requireRestaurantId`.
// Without a configured backend the calls return an empty snapshot so the
// settings page still renders in backend-free preview mode.

const EMPTY: KitchensSnapshot = { kitchens: [], is_empty: true };

/** Reads every kitchen of the caller's restaurant. */
export const kitchensLoad = createServerFn({ method: "GET" }).handler(
  async (): Promise<KitchensSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return loadKitchensSnapshot(rid);
  },
);

function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

/** Short ticket label: Latin letters/digits only, so it survives any printer. */
function cleanCode(raw: unknown, fallback: string): string {
  const s = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-_]/g, "")
    .slice(0, 12);
  return s || fallback;
}

/** Printer names may contain spaces, so only strip and clamp the length. */
function cleanPrinter(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return s || null;
}

function cleanCopies(raw: unknown): number {
  const n = Math.floor(Number(raw) || 1);
  if (!Number.isFinite(n)) return 1;
  return Math.min(9, Math.max(1, n));
}

type KitchenInput = {
  name: string;
  code?: string;
  printer_name?: string | null;
  copies?: number;
  auto_print?: boolean;
  is_active?: boolean;
};

/** Throws when a name or code would collide with another kitchen. */
async function assertUnique(
  rid: string,
  name: string,
  code: string,
  exceptId?: string,
) {
  const { data } = await supabase
    .from("kitchens")
    .select("id,name,code")
    .eq("restaurant_id", rid);

  const clash = ((data ?? []) as { id: string; name: string; code: string }[]).find(
    (k) =>
      k.id !== exceptId &&
      (k.name.trim().toLowerCase() === name.toLowerCase() || k.code === code),
  );
  if (clash) throw new Error(`الاسم أو الرمز مستخدم من قبل (${clash.name})`);
}

/** Creates a kitchen. */
export const kitchensCreate = createServerFn({ method: "POST" })
  .validator((d: KitchenInput) => d)
  .handler(async ({ data }): Promise<KitchensSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));

    const name = cleanName(data.name);
    if (!name) throw new Error("اسم المطبخ مطلوب");
    const code = cleanCode(data.code, name.slice(0, 6).toUpperCase());
    await assertUnique(rid, name, code);

    const { data: existing } = await supabase
      .from("kitchens")
      .select("id,name,code,display_order,is_active,printer_name,copies,auto_print")
      .eq("restaurant_id", rid);

    const { data: created, error } = await supabase
      .from("kitchens")
      .insert({
        restaurant_id: rid,
        name,
        code,
        display_order: nextDisplayOrder((existing ?? []) as unknown as Kitchen[]),
        is_active: data.is_active !== false,
        printer_name: cleanPrinter(data.printer_name),
        copies: cleanCopies(data.copies),
        auto_print: data.auto_print !== false,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    void created;

    return loadKitchensSnapshot(rid);
  });

/** Updates a kitchen's name, code, printer or print options. */
export const kitchensUpdate = createServerFn({ method: "POST" })
  .validator((d: KitchenInput & { kitchenId: string }) => d)
  .handler(async ({ data }): Promise<KitchensSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    if (isSyntheticKitchen(data.kitchenId))
      throw new Error("لا يمكن تعديل المطبخ الرئيسي");

    const name = cleanName(data.name);
    if (!name) throw new Error("اسم المطبخ مطلوب");
    const code = cleanCode(data.code, name.slice(0, 6).toUpperCase());
    await assertUnique(rid, name, code, data.kitchenId);

    const { error } = await supabase
      .from("kitchens")
      .update({
        name,
        code,
        printer_name: cleanPrinter(data.printer_name),
        copies: cleanCopies(data.copies),
        auto_print: data.auto_print !== false,
        is_active: data.is_active !== false,
      })
      .eq("id", data.kitchenId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadKitchensSnapshot(rid);
  });

/**
 * Deletes a kitchen. Its categories fall back to the default kitchen and its
 * staff rows are unbound, so no order line is ever left without a destination.
 */
export const kitchensDelete = createServerFn({ method: "POST" })
  .validator((d: { kitchenId: string }) => d)
  .handler(async ({ data }): Promise<KitchensSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    if (isSyntheticKitchen(data.kitchenId))
      throw new Error("لا يمكن حذف المطبخ الرئيسي");

    // Reassign rather than orphan: order history must stay resolvable.
    await supabase
      .from("categories")
      .update({ kitchen_id: null })
      .eq("restaurant_id", rid)
      .eq("kitchen_id", data.kitchenId);
    await supabase
      .from("menu_items")
      .update({ kitchen_id: null })
      .eq("restaurant_id", rid)
      .eq("kitchen_id", data.kitchenId);
    await supabase
      .from("staff")
      .update({ kitchen_id: null })
      .eq("restaurant_id", rid)
      .eq("kitchen_id", data.kitchenId);

    const { error } = await supabase
      .from("kitchens")
      .delete()
      .eq("id", data.kitchenId)
      .eq("restaurant_id", rid);
    if (error) throw new Error(error.message);

    return loadKitchensSnapshot(rid);
  });

/**
 * Moves a kitchen up or down the display order. Neighbouring rows are
 * swapped so the settings list and the ticket order stay stable.
 */
export const kitchensReorder = createServerFn({ method: "POST" })
  .validator((d: { kitchenId: string; direction: "up" | "down" }) => d)
  .handler(async ({ data }): Promise<KitchensSnapshot> => {
    if (!getFirebaseDb()) return EMPTY;
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    if (isSyntheticKitchen(data.kitchenId)) return loadKitchensSnapshot(rid);

    const snap = await loadKitchensSnapshot(rid);
    const list = snap.kitchens.filter((k) => !isSyntheticKitchen(k.id));
    const idx = list.findIndex((k) => k.id === data.kitchenId);
    if (idx < 0) return snap;

    const swapWith = data.direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= list.length) return snap;

    const a = list[idx];
    const b = list[swapWith];
    const aOrder = Number(a.display_order ?? 0);
    const bOrder = Number(b.display_order ?? 0);
    if (aOrder === bOrder) {
      // Same order value (bad data): rewrite both explicitly.
      await supabase
        .from("kitchens")
        .update({ display_order: swapWith })
        .eq("id", a.id)
        .eq("restaurant_id", rid);
      await supabase
        .from("kitchens")
        .update({ display_order: idx })
        .eq("id", b.id)
        .eq("restaurant_id", rid);
    } else {
      await supabase
        .from("kitchens")
        .update({ display_order: bOrder })
        .eq("id", a.id)
        .eq("restaurant_id", rid);
      await supabase
        .from("kitchens")
        .update({ display_order: aOrder })
        .eq("id", b.id)
        .eq("restaurant_id", rid);
    }

    return loadKitchensSnapshot(rid);
  });

/** One kitchen, or null. Used by the kitchen terminal to resolve its binding. */
export const kitchensResolveOne = createServerFn({ method: "GET" })
  .validator((d: { kitchenId: string }) => d)
  .handler(async ({ data }): Promise<{ ok: boolean; kitchen: Kitchen | null }> => {
    if (!getFirebaseDb()) return { ok: true, kitchen: null };
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    const { kitchenId } = data as { kitchenId: string };

    if (isSyntheticKitchen(kitchenId)) {
      return { ok: true, kitchen: { ...defaultKitchen(), restaurant_id: rid } };
    }

    const { data: rows } = await supabase
      .from("kitchens")
      .select(
        "id,restaurant_id,name,code,display_order,is_active,printer_name,copies,auto_print",
      )
      .eq("id", kitchenId)
      .eq("restaurant_id", rid)
      .limit(1);
    const row = ((rows ?? []) as unknown as Kitchen[])[0];
    return { ok: true, kitchen: row ?? null };
  });
