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
import {
  ROLE_WAITER,
  makeStaffSessionToken,
  generateUniqueSerial,
  resolveStaffFromToken,
  staffSessionExpiry,
  effectiveStaffPermissions,
} from "@/lib/staff-core";
import { requireRestaurantId } from "@/lib/server-staff-auth";
import { recordStaffActionAttendance } from "@/lib/attendance.functions";
import {
  fetchMenuForRestaurantCore,
  createOrderForRestaurantCore,
  type NewOrderInput,
} from "@/lib/order-create";

/** DB logic: resolve waiter context from session token. */
export async function getWaiterContextCore(token: string) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  if (!staffRow.permissions?.includes("waiter"))
    throw new Error("هذا الحساب لا يملك صلاحية النادل");
  const { data: rest } = await supabase
    .from("restaurants")
    .select("id,name,logo_url")
    .eq("id", restaurantId)
    .maybeSingle();
  return {
    waiterName: staffRow.name as string,
    restaurant: (rest as any) ?? { id: restaurantId, name: "", logo_url: null },
  };
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

export const getWaiterContext = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return getWaiterContextCore(token);
  });

export const waiterLogout = createServerFn({ method: "POST" })
  .validator((d: { token: string }) => d)
  .handler(async () => ({ ok: true }));

// ─── Waiter self-service ordering (send a new order from the floor) ──

/** DB logic: menu + tables for the waiter's restaurant. */
export async function waiterGetMenuCore(token: string) {
  const { staffRow, restaurantId } = await resolveStaffFromToken(token);
  if (!staffRow.permissions?.includes("waiter"))
    throw new Error("هذا الحساب لا يملك صلاحية النادل");
  return fetchMenuForRestaurantCore(restaurantId);
}

export const waiterGetMenu = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return waiterGetMenuCore(token);
  });

/** DB logic: waiter creates a new order, pre-assigned to themselves. */
export async function waiterCreateOrderCore(
  token: string,
  input: Omit<NewOrderInput, "token">,
) {
  const { staffRow, staffId, restaurantId } =
    await resolveStaffFromToken(token);
  if (!staffRow.permissions?.includes("waiter"))
    throw new Error("هذا الحساب لا يملك صلاحية النادل");
  return createOrderForRestaurantCore(restaurantId, input, {
    servedBy: staffId,
    createdByRole: "waiter",
  });
}

export const waiterCreateOrder = createServerFn({ method: "POST" })
  .validator((d: { token: string } & Omit<NewOrderInput, "token">) => d)
  .handler(async ({ data }) => {
    const { token, ...input } = data as { token: string } & Omit<
      NewOrderInput,
      "token"
    >;
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return waiterCreateOrderCore(token, input);
  });

/** DB logic: list active orders for the waiter's restaurant. */
export async function waiterListOrdersCore(token: string) {
  const { staffId, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const snap = await getDocs(
    query(collection(db, "orders"), where("restaurant_id", "==", restaurantId)),
  );
  const orderRows = snap.docs
    .map((d) => ({ ...d.data(), id: d.id }))
    .filter((o: any) => ["new", "preparing", "ready"].includes(o.status));

  if (!orderRows.length) return { orders: [] };

  const ids = orderRows.map((o: any) => o.id as string);

  const tableIds = orderRows
    .map((o: any) => o.table_id)
    .filter(Boolean) as string[];

  const [itemsSnap, tablesSnap] = await Promise.all([
    getDocs(query(collection(db, "order_items"), where("order_id", "in", ids))),
    tableIds.length
      ? getDocs(query(collection(db, "tables"), where("id", "in", tableIds)))
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

  const orders = orderRows.map((o: any) => ({
    id: o.id,
    total: o.total as number,
    status: o.status as string,
    created_at: o.created_at as string,
    order_type: (o.order_type as string) ?? "dine_in",
    customer_name: (o.customer_name as string) ?? null,
    daily_number: (o.daily_number as number) ?? null,
    notes: (o.notes as string) ?? null,
    table_number: o.table_id ? (tableMap.get(o.table_id) ?? null) : null,
    is_mine: o.served_by === staffId,
    items: (itemsByOrder.get(o.id) ?? []).map((it: any) => ({
      name: it.name_snapshot as string,
      qty: it.quantity as number,
      note: (it.note as string) ?? null,
      options: it.options_snapshot ? safeParseOptions(it.options_snapshot) : [],
    })),
  }));

  return { orders };
}

export const waiterListReadyOrders = createServerFn({ method: "GET" })
  .validator((d: { token: string }) => d)
  .handler(async ({ data }) => {
    const { token } = data as { token: string };
    return waiterListOrdersCore(token);
  });

/** DB logic: waiter claims an order. */
export async function waiterClaimOrderCore(token: string, orderId: string) {
  const { staffId, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلب غير موجود");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");
  if (!["new", "preparing", "ready"].includes(data.status)) {
    throw new Error(`حالة الطلب "${data.status}" — لا يمكن استلامه`);
  }

  await updateDoc(orderRef, { served_by: staffId });
  return { ok: true };
}

export const waiterClaimOrder = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId } = data as { token: string; orderId: string };
    return waiterClaimOrderCore(token, orderId);
  });

/** DB logic: waiter releases a claimed order back to the pool. */
export async function waiterUnclaimOrderCore(token: string, orderId: string) {
  const { staffId, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلب غير موجود");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");
  if ((data.served_by ?? null) !== staffId)
    throw new Error("هذا الطلب غير مُسند إليك");
  if (!["new", "preparing"].includes(data.status)) {
    throw new Error("لا يمكن إلغاء استلام طلب جاهز للتسليم");
  }

  await updateDoc(orderRef, { served_by: null });
  return { ok: true };
}

export const waiterUnclaimOrder = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId } = data as { token: string; orderId: string };
    return waiterUnclaimOrderCore(token, orderId);
  });

/** DB logic: waiter marks order as served (delivered to table). It stays in
 * cashier's "ready for payment" list as "served" until the cashier confirms. */
export async function waiterMarkServedCore(token: string, orderId: string) {
  const { staffId, restaurantId } = await resolveStaffFromToken(token);
  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const orderRef = doc(db, "orders", orderId);
  const snap = await getDoc(orderRef);
  if (!snap.exists()) throw new Error("الطلب غير موجود");
  const data = snap.data();
  if (data.restaurant_id !== restaurantId)
    throw new Error("طلبية مملوكة لمطعم آخر");
  if (data.status !== "ready") throw new Error("الطلب ليس جاهزاً للتسليم");
  if (data.served_by && data.served_by !== staffId) {
    throw new Error("هذا الطلب مُسند لنادل آخر");
  }

  await updateDoc(orderRef, {
    served_by: staffId,
    served_at: new Date().toISOString(),
    status: "served",
  });

  try {
    const itemsSnap = await getDocs(
      query(collection(db, "order_items"), where("order_id", "==", orderId)),
    );
    const dishesCount = itemsSnap.docs.reduce(
      (s, d) => s + Math.max(1, Number(d.data().quantity) || 1),
      0,
    );
    await recordStaffActionAttendance(restaurantId, staffId, {
      dishes: dishesCount || 1,
      orders: 1,
    });
  } catch (err) {
    console.error("[waiter] Failed to record attendance action:", err);
  }

  return { ok: true };
}

export const waiterMarkServed = createServerFn({ method: "POST" })
  .validator((d: { token: string; orderId: string }) => d)
  .handler(async ({ data }) => {
    const { token, orderId } = data as { token: string; orderId: string };
    return waiterMarkServedCore(token, orderId);
  });

/** Public (login-page) list of active waiters for a restaurant. */
export async function getPublicWaiterListCore(restaurantId: string) {
  const rest = await supabase
    .from("restaurants")
    .select("name,logo_url")
    .eq("id", restaurantId)
    .maybeSingle();
  if (!rest.data)
    return {
      found: false,
      name: "",
      logo_url: null as string | null,
      waiters: [],
    };
  const rows = await supabase
    .from("staff")
    .select("id,name")
    .eq("restaurant_id", restaurantId)
    .eq("role", ROLE_WAITER)
    .eq("frozen", false);
  return {
    found: true,
    name: (rest.data as any).name ?? "",
    logo_url: ((rest.data as any).logo_url as string | null) ?? null,
    waiters: (rows.data ?? []).map((w: any) => ({ id: w.id, name: w.name })),
  };
}

export const getPublicWaiterList = createServerFn({ method: "GET" })
  .validator((d: { restaurantId: string }) => d)
  .handler(async ({ data }) => {
    const { restaurantId } = data as { restaurantId: string };
    return getPublicWaiterListCore(restaurantId);
  });

/** DB logic without the HTTP layer — also used by tests. */
export async function verifyWaiterPinCore(waiterId: string, pin: string) {
  const row = await supabase
    .from("staff")
    .select("*")
    .eq("id", waiterId)
    .maybeSingle();
  const staffRow = row.data as any;
  if (!staffRow) throw new Error("الحساب غير موجود");
  if (staffRow.frozen) {
    throw new Error(
      staffRow.freeze_reason
        ? `تم تجميد حسابك: ${staffRow.freeze_reason}`
        : "تم تجميد حسابك — راجع الإدارة",
    );
  }
  if (!effectiveStaffPermissions(staffRow).includes("waiter"))
    throw new Error("هذا الحساب لم يعد حساب نادل");
  if (String(staffRow.pin ?? "") !== pin.trim())
    throw new Error("رمز PIN غير صحيح");

  const rest = await supabase
    .from("restaurants")
    .select("id,name,logo_url")
    .eq("id", staffRow.restaurant_id)
    .maybeSingle();
  const restaurant = (rest.data as any) ?? {
    id: staffRow.restaurant_id,
    name: "",
    logo_url: null,
  };
  return {
    token: await makeStaffSessionToken(staffRow.id),
    expiresAt: staffSessionExpiry(),
    waiterName: staffRow.name as string,
    waiterId: staffRow.id as string,
    restaurant,
  };
}

/** Verifies a waiter PIN against the `staff` collection; enforces freeze. */
export const verifyWaiterPin = createServerFn({ method: "POST" })
  .validator((d: { waiterId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    if (!getFirebaseDb())
      throw new Error("Firebase غير مُعد — يرجى تكوين الاتصال");
    return verifyWaiterPinCore(data.waiterId, data.pin);
  });

// ─── Owner-facing CRUD (settings panel) ────────────────────────

export type WaiterListRow = {
  id: string;
  name: string;
  is_active: boolean;
  employee_id: string | null;
  created_at: string | null;
};

async function listStaffByRole(
  rid: string,
  role: string,
): Promise<WaiterListRow[]> {
  const rows = await supabase
    .from("staff")
    .select("*")
    .eq("restaurant_id", rid)
    .eq("role", role);
  const mapped: WaiterListRow[] = (rows.data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name,
    is_active: !s.frozen,
    employee_id: s.serial ?? null,
    created_at: s.created_at ?? null,
  }));
  return mapped.sort((a, b) =>
    String(a.name).localeCompare(String(b.name), "ar"),
  );
}

/** DB logic without the HTTP layer — also used by tests. */
export async function listWaitersCore(rid: string) {
  return { waiters: await listStaffByRole(rid, ROLE_WAITER) };
}

function validateStaffInput(name: string, pin: string) {
  if (!name?.trim()) throw new Error("اكتب الاسم");
  const cleanPin = pin?.trim() ?? "";
  if (!/^\d{4,6}$/.test(cleanPin)) throw new Error("PIN من 4 إلى 6 أرقام");
  return { name: name.trim(), pin: cleanPin };
}

export async function addWaiterCore(
  rid: string,
  rawName: string,
  rawPin: string,
) {
  const { name, pin } = validateStaffInput(rawName, rawPin);
  const serial = await generateUniqueSerial();
  const { error } = await supabase.from("staff").insert({
    restaurant_id: rid,
    name,
    role: ROLE_WAITER,
    serial,
    pin,
    pin_changed: false,
    frozen: false,
    freeze_reason: null,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return { ok: true };
}

async function assertOwnedStaff(rid: string, staffId: string): Promise<any> {
  const row = await supabase
    .from("staff")
    .select("*")
    .eq("id", staffId)
    .single();
  const staffRow = row.data as any;
  // Adapter returns data:null when not found.
  if (!staffRow || staffRow.restaurant_id !== rid)
    throw new Error("الحساب غير موجود");
  return staffRow;
}

export async function updateWaiterPinCore(
  rid: string,
  waiterId: string,
  rawPin: string,
) {
  const cleanPin = rawPin?.trim() ?? "";
  if (!/^\d{4,6}$/.test(cleanPin)) throw new Error("PIN من 4 إلى 6 أرقام");
  await assertOwnedStaff(rid, waiterId);
  const { error } = await supabase
    .from("staff")
    .update({ pin: cleanPin })
    .eq("id", waiterId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function toggleWaiterCore(
  rid: string,
  waiterId: string,
  isActive: boolean,
) {
  await assertOwnedStaff(rid, waiterId);
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
    .eq("id", waiterId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteWaiterCore(rid: string, waiterId: string) {
  await assertOwnedStaff(rid, waiterId);
  const { error } = await supabase.from("staff").delete().eq("id", waiterId);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export const listWaiters = createServerFn({ method: "GET" }).handler(
  async () => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return listWaitersCore(rid);
  },
);

export const addWaiter = createServerFn({ method: "POST" })
  .validator((d: { name: string; pin: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return addWaiterCore(rid, data.name, data.pin);
  });

export const updateWaiterPin = createServerFn({ method: "POST" })
  .validator((d: { waiterId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return updateWaiterPinCore(rid, data.waiterId, data.pin);
  });

export const toggleWaiter = createServerFn({ method: "POST" })
  .validator((d: { waiterId: string; is_active: boolean }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return toggleWaiterCore(rid, data.waiterId, data.is_active);
  });

export const deleteWaiter = createServerFn({ method: "POST" })
  .validator((d: { waiterId: string }) => d)
  .handler(async ({ data }) => {
    const rid = await requireRestaurantId(getRequestHeader("authorization"));
    return deleteWaiterCore(rid, data.waiterId);
  });
