import { createServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import {
  effectiveStaffPermissions,
  makeStaffSessionToken,
  staffSessionExpiry,
} from "@/lib/staff-core";
import { recordStaffLoginAttendance } from "@/lib/attendance.functions";

export type PublicStaffItem = {
  id: string;
  name: string;
};

/** DB logic — public list of all staff (any permissions), non-frozen. */
export async function getPublicStaffListCore(restaurantId: string) {
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
      staff: [] as PublicStaffItem[],
    };
  const rows = await supabase
    .from("staff")
    .select("id,name")
    .eq("restaurant_id", restaurantId)
    .eq("frozen", false);
  return {
    found: true,
    name: (rest.data as any).name ?? "",
    logo_url: ((rest.data as any).logo_url as string | null) ?? null,
    staff: (rows.data ?? [])
      .map((w: any) => ({ id: w.id, name: w.name }))
      .sort((a: { name: string }, b: { name: string }) =>
        String(a.name).localeCompare(String(b.name), "ar"),
      ),
  };
}

export const getPublicStaffList = createServerFn({ method: "GET" })
  .validator((d: { restaurantId: string }) => d)
  .handler(async ({ data }) => {
    const { restaurantId } = data as { restaurantId: string };
    if (!getFirebaseDb())
      return {
        found: true,
        name: "مطعم السهل",
        logo_url: null as string | null,
        staff: [
          { id: "s1", name: "أحمد بلحاج" },
          { id: "s2", name: "سمير حمداني" },
          { id: "s3", name: "ليلى بوعلام" },
        ] as PublicStaffItem[],
      };
    return getPublicStaffListCore(restaurantId);
  });

/** DB logic without the HTTP layer — also used by tests. */
export async function verifyStaffPinCore(staffId: string, pin: string) {
  const row = await supabase
    .from("staff")
    .select("*")
    .eq("id", staffId)
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
  if (String(staffRow.pin ?? "") !== pin.trim())
    throw new Error("رمز PIN غير صحيح");

  const permissions = effectiveStaffPermissions(staffRow);

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

  // Record initial login attendance for today
  await recordStaffLoginAttendance(
    staffRow.restaurant_id,
    staffRow.id,
    staffRow.name as string,
  );

  return {
    token: await makeStaffSessionToken(staffRow.id),
    expiresAt: staffSessionExpiry(),
    staffName: staffRow.name as string,
    staffId: staffRow.id as string,
    restaurant,
    permissions,
  };
}

/** Verifies any employee PIN (role-agnostic); enforces freeze. */
export const verifyStaffPin = createServerFn({ method: "POST" })
  .validator((d: { staffId: string; pin: string }) => d)
  .handler(async ({ data }) => {
    const { staffId, pin } = data as { staffId: string; pin: string };
    if (!getFirebaseDb())
      return {
        token: "mock_staff",
        expiresAt: staffSessionExpiry(),
        staffName: "أحمد بلحاج",
        staffId,
        restaurant: {
          id: "mock-restaurant-id",
          name: "مطعم السهل",
          logo_url: null,
        },
        permissions: ["kitchen", "cashier"],
      };
    return verifyStaffPinCore(staffId, pin);
  });
