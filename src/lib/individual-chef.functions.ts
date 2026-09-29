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
  documentId,
} from "firebase/firestore";
import {
  ROLE_KITCHEN,
  makeStaffSessionToken,
  generateUniqueSerial,
  resolveStaffFromToken,
  staffSessionExpiry,
  effectiveStaffPermissions,
} from "@/lib/staff-core";
import { normalizeRoleLabel } from "@/lib/staff-permissions";
import { requireRestaurantId } from "@/lib/server-staff-auth";
import { resolveKitchenId } from "@/lib/kitchens";
import { recordStaffActionAttendance } from "@/lib/attendance.functions";

/**
 * True when a staff row can work a kitchen terminal: the `kitchen` permission
 * grants it, and the legacy `role` label is accepted as a fallback for rows
 * created before permissions existed. Mirrors the kitchen-screen auth check so
 * the settings page lists exactly the people who can actually log in.
 */
function hasKitchenAccess(s: any): boolean {
  const perms = Array.isArray(s?.permissions) ? s.permissions : [];
  if (perms.includes("kitchen")) return true;
  return normalizeRoleLabel(s?.role) === ROLE_KITCHEN;
}

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

/** DB logic: resolve chef context from session token. */
export async function getIndividualChefContextCore(token: string) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  if (!staffRow.permissions?.includes("kitchen"))
    throw new Error("هذا الحساب لا يملك صلاحية المطبخ");

  const db = getFirebaseDb();
  let rest: any = { id: restaurantId, name: "", logo_url: null };
  if (db) {
    const restSnap = await getDoc(doc(db, "restaurants", restaurantId));
    if (restSnap.exists()) {
      rest = { id: restSnap.id, ...restSnap.data() };
    }
  }

  return {
    chefName: staffRow.name as string,
    chefId: staffRow.id as string,
    /** Kitchen this terminal serves; the default kitchen when unassigned. */
    kitchenId: resolveKitchenId(staffRow.kitchen_id),
    restaurant: rest,
  };
}

export const getIndividualChefContext = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return getIndividualChefContextCore(token);
  });

/** Every distinct kitchen that has at least one line of the given order. */
async function kitchensOfOrderCore(
  db: any,
  orderId: string,
): Promise<string[]> {
  const itemsSnap = await getDocs(
    query(collection(db, "order_items"), where("order_id", "==", orderId)),
  );
  const ids = new Set<string>();
  for (const d of itemsSnap.docs) {
    ids.add(resolveKitchenId((d.data() as any).kitchen_id));
  }
  return [...ids];
}

/** DB logic: list active orders (new + preparing) for the chef's restaurant.
 *
 * The list is scoped to the chef's own kitchen: an order only surfaces here if
 * at least one of its lines was routed to that kitchen, and the chef only sees
 * the lines of their kitchen — never the other stations' dishes. */
export async function individualChefListActiveCore(token: string) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const kitchenId = resolveKitchenId(staffRow.kitchen_id);

  const snap = await getDocs(
    query(collection(db, "orders"), where("restaurant_id", "==", restaurantId)),
  );
  const orderRows = snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((o: any) => o.status === "new" || o.status === "preparing");
  if (!orderRows.length) return { orders: [], kitchenId };

  const ids = orderRows.map((o: any) => o.id as string);
  const tableIds = orderRows
    .map((o: any) => o.table_id)
    .filter(Boolean) as string[];

  const [itemsSnap, tablesSnap] = await Promise.all([
    getDocs(query(collection(db, "order_items"), where("order_id", "in", ids))),
    tableIds.length
      ? getDocs(
          query(collection(db, "tables"), where(documentId(), "in", tableIds)),
        )
      : Promise.resolve({ docs: [] } as any),
  ]);

  const itemsByOrder = new Map<string, any[]>();
  for (const d of itemsSnap.docs) {
    const it = { ...d.data(), id: d.id } as any;
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push(it);
    itemsByOrder.set(it.order_id, arr);
  }

  const tableMap = new Map<string, number>();
  for (const d of tablesSnap.docs) {
    const t = d.data() as any;
    tableMap.set(d.id, t.table_number);
  }

  const orders = [];
  for (const o of orderRows as any[]) {
    const allItems = (itemsByOrder.get(o.id) ?? []) as any[];
    // Keep only this kitchen's lines, then drop the order entirely when none
    // of its lines belong here — that station has nothing to cook.
    const myItems = allItems.filter(
      (it) => resolveKitchenId(it.kitchen_id) === kitchenId,
    );
    if (!myItems.length) continue;

    orders.push({
      id: o.id,
      status: o.status as string,
      created_at: o.created_at as string,
      acknowledged: (o.acknowledged as boolean) ?? false,
      table_number: o.table_id ? (tableMap.get(o.table_id) ?? null) : null,
      notes: (o.notes as string) ?? null,
      order_type: (o.order_type as string) ?? "dine_in",
      customer_name: (o.customer_name as string) ?? null,
      customer_phone: (o.customer_phone as string) ?? null,
      customer_address: (o.customer_address as string) ?? null,
      daily_number: (o.daily_number as number) ?? null,
      total: (o.total as number) ?? 0,
      chef_id: (o.chef_id as string) ?? null,
      chef_name: (o.chef_name as string) ?? null,
      started_at: (o.started_at as string) ?? null,
      items: myItems.map((it: any) => ({
        name: it.name_snapshot as string,
        qty: it.quantity as number,
        note: (it.note as string) ?? null,
        options: it.options_snapshot ? safeParseOptions(it.options_snapshot) : [],
      })),
    });
  }

  return { orders, kitchenId };
}

export const individualChefListActive = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    return individualChefListActiveCore(token);
  });

/** DB logic: chef starts preparing an order with the chef selected on the
 * shared kitchen computer. The chosen chef is verified to belong to the same
 * restaurant and to have kitchen permission before attribution is written. */
export async function individualChefStartPreparingCore(
  token: string,
  orderId: string,
  chefId: string,
) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");
  const kitchenId = resolveKitchenId(staffRow.kitchen_id);

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلبية غير موجودة");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");
  if (data.status !== "new" && data.status !== "preparing")
    throw new Error(`حالة الطلبية "${data.status}" — لا يمكن بدء التحضير`);

  // Refuse when the order holds no line for this kitchen, so a station can
  // never claim someone else's ticket.
  const involved = await kitchensOfOrderCore(db, orderId);
  if (!involved.includes(kitchenId))
    throw new Error("هذه الطلبية لا تحتوي أصنافاً خاصة بمطبخك");

  const chefSnap = await getDoc(doc(db, "staff", chefId));
  if (!chefSnap.exists()) throw new Error("الطاهي غير موجود");
  const chefRow = { id: chefSnap.id, ...chefSnap.data() } as any;
  if (chefRow.restaurant_id !== restaurantId)
    throw new Error("الطاهي مملوك لمطعم آخر");
  if (chefRow.frozen) throw new Error("حساب الطاهي مجمّد");
  if (!effectiveStaffPermissions(chefRow).includes("kitchen"))
    throw new Error("هذا الحساب ليس له صلاحية المطبخ");

  // Per-kitchen progress so a two-station order is not released by one chef.
  const kitchenStatus: Record<string, string> = {
    ...((data.kitchen_status as Record<string, string>) ?? {}),
  };
  if (kitchenStatus[kitchenId] !== "ready") {
    kitchenStatus[kitchenId] = "preparing";
  }

  await updateDoc(orderRef, {
    status: "preparing",
    acknowledged: true,
    chef_id: chefRow.id as string,
    chef_name: (chefRow.name as string) ?? null,
    started_at: data.started_at ?? new Date().toISOString(),
    kitchen_status: kitchenStatus,
  });

  // Calculate dishes prepared by chef and record confirmed attendance
  try {
    const itemsSnap = await getDocs(
      query(collection(db, "order_items"), where("order_id", "==", orderId)),
    );
    let dishesCount = 0;
    for (const d of itemsSnap.docs) {
      const it = d.data();
      if (!it.kitchen_id || it.kitchen_id === kitchenId) {
        dishesCount += Math.max(1, Number(it.quantity) || 1);
      }
    }
    if (dishesCount === 0 && itemsSnap.docs.length > 0) {
      dishesCount = itemsSnap.docs.reduce(
        (s, d) => s + Math.max(1, Number(d.data().quantity) || 1),
        0,
      );
    }
    await recordStaffActionAttendance(restaurantId, chefRow.id as string, {
      dishes: dishesCount || 1,
      orders: 1,
    });
  } catch (err) {
    console.error("[chef] Failed to record attendance action:", err);
  }

  return { ok: true };
}

export const individualChefStartPreparing = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string; chefId: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId, chefId } = data as {
      token: string;
      orderId: string;
      chefId: string;
    };
    return individualChefStartPreparingCore(token, orderId, chefId);
  });

/** DB logic: chef marks their kitchen's slice as ready. The order itself only
 * flips to `ready` once every kitchen involved in it has finished, otherwise a
 * waiter would collect a half-cooked ticket. */
export async function individualChefMarkReadyCore(
  token: string,
  orderId: string,
) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");
  const kitchenId = resolveKitchenId(staffRow.kitchen_id);

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلبية غير موجودة");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");
  if (data.status !== "preparing")
    throw new Error(`حالة الطلبية "${data.status}" — لا يمكن وضعها كجاهزة`);

  const involved = await kitchensOfOrderCore(db, orderId);
  if (!involved.includes(kitchenId))
    throw new Error("هذه الطلبية لا تحتوي أصنافاً خاصة بمطبخك");

  const kitchenStatus: Record<string, string> = {
    ...((data.kitchen_status as Record<string, string>) ?? {}),
  };
  kitchenStatus[kitchenId] = "ready";

  const allReady = involved.every((k) => kitchenStatus[k] === "ready");

  await updateDoc(orderRef, {
    status: allReady ? "ready" : "preparing",
    kitchen_status: kitchenStatus,
    ...(allReady ? { ready_at: new Date().toISOString() } : {}),
  });
  return { ok: true, allReady };
}

export const individualChefMarkReady = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId } = data as { token: string; orderId: string };
    return individualChefMarkReadyCore(token, orderId);
  });

export const individualChefLogout = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async () => ({ ok: true }));

/** Public (login-page) list of active kitchen staff for a restaurant. */
export async function getPublicChefListCore(restaurantId: string) {
  const db = getFirebaseDb();
  if (!db)
    return {
      found: false,
      name: "",
      logo_url: null as string | null,
      chefs: [],
    };

  const restSnap = await getDoc(doc(db, "restaurants", restaurantId));
  if (!restSnap.exists())
    return {
      found: false,
      name: "",
      logo_url: null as string | null,
      chefs: [],
    };

  const restData = restSnap.data() as Record<string, any>;

  const staffSnap = await getDocs(
    query(collection(db, "staff"), where("restaurant_id", "==", restaurantId)),
  );

  return {
    found: true,
    name: (restData.name as string) ?? "",
    logo_url: (restData.logo_url as string | null) ?? null,
    chefs: staffSnap.docs
      .filter(
        (d) =>
          (d.data() as any).frozen !== true &&
          effectiveStaffPermissions(d.data() as any).includes("kitchen"),
      )
      .map((d) => ({ id: d.id, name: (d.data() as any).name })),
  };
}

export const getPublicChefList = createServerFn({ method: "GET" })
  .validator((d: { restaurantId: string }) => d)
  .handler(async ({ data }) => {
    const { restaurantId } = data as { restaurantId: string };
    return getPublicChefListCore(restaurantId);
  });

/** DB logic without the HTTP layer — also used by tests. */
export async function verifyIndividualChefPinCore(chefId: string, pin: string) {
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const staffSnap = await getDoc(doc(db, "staff", chefId));
  if (!staffSnap.exists()) throw new Error("الحساب غير موجود");
  const staffRow = { id: staffSnap.id, ...staffSnap.data() } as any;

  if (staffRow.frozen) {
    throw new Error(
      staffRow.freeze_reason
        ? `تم تجميد حسابك: ${staffRow.freeze_reason}`
        : "تم تجميد حسابك — راجع الإدارة",
    );
  }
  if (!effectiveStaffPermissions(staffRow).includes("kitchen"))
    throw new Error("هذا الحساب لم يعد حساب مطبخ");
  if (String(staffRow.pin ?? "") !== pin.trim())
    throw new Error("رمز PIN غير صحيح");

  let restaurant: any = {
    id: staffRow.restaurant_id,
    name: "",
    logo_url: null,
  };
  const restSnap = await getDoc(doc(db, "restaurants", staffRow.restaurant_id));
  if (restSnap.exists()) {
    restaurant = { id: restSnap.id, ...restSnap.data() };
  }

  return {
    token: await makeStaffSessionToken(staffRow.id),
    expiresAt: staffSessionExpiry(),
    chefName: staffRow.name as string,
    chefId: staffRow.id as string,
    kitchenId: resolveKitchenId(staffRow.kitchen_id),
    restaurant,
  };
}

/** Verifies a kitchen-staff PIN against the `staff` collection; enforces freeze. */
export const verifyIndividualChefPin = createServerFn({ method: "POST" })
  .validator((d: { chefId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return verifyIndividualChefPinCore(data.chefId, data.pin);
  });

// ─── Owner-facing CRUD (settings panel) ────────────────────────

export type ChefListRow = {
  id: string;
  name: string;
  is_active: boolean;
  employee_id: string | null;
  created_at: string | null;
  /** Kitchen this chef's terminal is bound to. */
  kitchen_id: string;
};

async function assertOwnedKitchenStaff(
  rid: string,
  staffId: string,
): Promise<any> {
  const row = await supabase
    .from("staff")
    .select("*")
    .eq("id", staffId)
    .single();
  const staffRow = row.data as any;
  if (!staffRow || staffRow.restaurant_id !== rid)
    throw new Error("الحساب غير موجود");
  return staffRow;
}

/** DB logic without the HTTP layer — also used by tests. */
export async function listIndividualChefsCore(rid: string) {
  const rows = await supabase
    .from("staff")
    .select("*")
    .eq("restaurant_id", rid);
  // `permissions` is the source of truth. The legacy `role` label is written
  // from permission *labels* ("المطبخ") while ROLE_KITCHEN is bare ("مطبخ"),
  // so a strict role filter would hide every staff added through the
  // permissions UI. Fall back to the role for rows that predate permissions.
  const chefs: ChefListRow[] = (rows.data ?? [])
    .filter((s: any) => hasKitchenAccess(s))
    .map((s: any) => ({
      id: s.id,
      name: s.name,
      is_active: !s.frozen,
      employee_id: s.serial ?? null,
      created_at: s.created_at ?? null,
      kitchen_id: resolveKitchenId(s.kitchen_id),
    }));
  chefs.sort((a, b) => String(a.name).localeCompare(String(b.name), "ar"));
  return { chefs };
}

export async function addIndividualChefCore(
  rid: string,
  rawName: string,
  rawPin: string,
  rawKitchenId?: string | null,
) {
  if (!rawName?.trim()) throw new Error("اكتب اسم الطاهي");
  const cleanPin = rawPin?.trim() ?? "";
  if (!/^\d{4,6}$/.test(cleanPin)) throw new Error("PIN من 4 إلى 6 أرقام");
  const serial = await generateUniqueSerial();
  const { error } = await supabase.from("staff").insert({
    restaurant_id: rid,
    name: rawName.trim(),
    role: ROLE_KITCHEN,
    serial,
    pin: cleanPin,
    pin_changed: false,
    frozen: false,
    freeze_reason: null,
    kitchen_id: resolveKitchenId(rawKitchenId),
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** Binds (or unbinds) a chef's terminal to a kitchen. */
export async function setIndividualChefKitchenCore(
  rid: string,
  chefId: string,
  rawKitchenId?: string | null,
) {
  await assertOwnedKitchenStaff(rid, chefId);
  const { error } = await supabase
    .from("staff")
    .update({ kitchen_id: resolveKitchenId(rawKitchenId) })
    .eq("id", chefId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function updateIndividualChefPinCore(
  rid: string,
  chefId: string,
  rawPin: string,
) {
  const cleanPin = rawPin?.trim() ?? "";
  if (!/^\d{4,6}$/.test(cleanPin)) throw new Error("PIN من 4 إلى 6 أرقام");
  await assertOwnedKitchenStaff(rid, chefId);
  const { error } = await supabase
    .from("staff")
    .update({ pin: cleanPin })
    .eq("id", chefId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function toggleIndividualChefCore(
  rid: string,
  chefId: string,
  isActive: boolean,
) {
  await assertOwnedKitchenStaff(rid, chefId);
  const payload = isActive
    ? { frozen: false, freeze_reason: null }
    : {
        frozen: true,
        freeze_reason: "تم إيقاف هذا الحساب من الإعدادات",
        frozen_at: new Date().toISOString(),
      };
  const { error } = await supabase
    .from("staff")
    .update(payload)
    .eq("id", chefId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteIndividualChefCore(rid: string, chefId: string) {
  await assertOwnedKitchenStaff(rid, chefId);
  const { error } = await supabase.from("staff").delete().eq("id", chefId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const listIndividualChefs = createServerFn({ method: "GET" }).handler(
  async () => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return listIndividualChefsCore(rid);
  },
);

export const addIndividualChef = createServerFn({ method: "POST" })
  .validator(
    (d: { name: string; pin: string; kitchen_id?: string | null }) => d,
  )
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return addIndividualChefCore(rid, data.name, data.pin, data.kitchen_id);
  });

export const setIndividualChefKitchen = createServerFn({ method: "POST" })
  .validator((d: { chefId: string; kitchen_id?: string | null }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return setIndividualChefKitchenCore(rid, data.chefId, data.kitchen_id);
  });

export const updateIndividualChefPin = createServerFn({ method: "POST" })
  .validator((d: { chefId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return updateIndividualChefPinCore(rid, data.chefId, data.pin);
  });

export const toggleIndividualChef = createServerFn({ method: "POST" })
  .validator((d: { chefId: string; is_active: boolean }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return toggleIndividualChefCore(rid, data.chefId, data.is_active);
  });

export const deleteIndividualChef = createServerFn({ method: "POST" })
  .validator((d: { chefId: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return deleteIndividualChefCore(rid, data.chefId);
  });
