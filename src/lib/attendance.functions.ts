import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";
import { requireRestaurantId } from "@/lib/server-staff-auth";

export type StaffAttendanceStatus = "checked_in" | "confirmed" | "absent";

export type StaffAttendanceRecord = {
  id?: string;
  restaurant_id: string;
  staff_id: string;
  staff_name?: string | null;
  date: string; // YYYY-MM-DD
  status: StaffAttendanceStatus;
  login_time?: string | null;
  first_action_time?: string | null;
  last_action_time?: string | null;
  dishes_count: number;
  orders_count: number;
  created_at?: string;
};

export type StaffMonthlyAttendanceSummary = {
  staff_id: string;
  staff_name: string;
  role?: string | null;
  month: string; // YYYY-MM
  present_days_count: number;
  absent_days_count: number;
  absent_dates: string[]; // List of YYYY-MM-DD
  total_dishes: number;
  total_orders: number;
  today_status: StaffAttendanceStatus;
  records: StaffAttendanceRecord[];
};

function getTodayString(): string {
  return new Date().toISOString().slice(0, 10);
}

function getCurrentMonthString(): string {
  return new Date().toISOString().slice(0, 7);
}

/** Record staff login (PIN verification) — creates initial checked_in attendance for today if not already present. */
export async function recordStaffLoginAttendance(
  restaurantId: string,
  staffId: string,
  staffName?: string | null,
) {
  if (!restaurantId || !staffId) return;
  const todayStr = getTodayString();
  const now = new Date().toISOString();

  try {
    const existing = await supabase
      .from("staff_attendance")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("staff_id", staffId)
      .eq("date", todayStr)
      .maybeSingle();

    if (existing.data) {
      // Already logged in today, keep record as is
      return;
    }

    await supabase.from("staff_attendance").insert({
      restaurant_id: restaurantId,
      staff_id: staffId,
      staff_name: staffName || null,
      date: todayStr,
      status: "checked_in",
      login_time: now,
      dishes_count: 0,
      orders_count: 0,
      created_at: now,
    });
  } catch (err) {
    console.error("[attendance] recordStaffLoginAttendance failed:", err);
  }
}

/** Record staff actual work action (e.g. prepared a dish, served an order, closed a bill).
 * Automatically marks attendance as 'confirmed' and accumulates dishes & orders counts.
 */
export async function recordStaffActionAttendance(
  restaurantId: string,
  staffId: string,
  metrics?: { dishes?: number; orders?: number },
) {
  if (!restaurantId || !staffId) return;
  const todayStr = getTodayString();
  const now = new Date().toISOString();
  const addDishes = Math.max(0, Number(metrics?.dishes) || 0);
  const addOrders = Math.max(0, Number(metrics?.orders) || 0);

  try {
    const existing = await supabase
      .from("staff_attendance")
      .select("*")
      .eq("restaurant_id", restaurantId)
      .eq("staff_id", staffId)
      .eq("date", todayStr)
      .maybeSingle();

    const row = existing.data as any;
    if (row && row.id) {
      const currentDishes = Number(row.dishes_count) || 0;
      const currentOrders = Number(row.orders_count) || 0;
      await supabase
        .from("staff_attendance")
        .update({
          status: "confirmed",
          first_action_time: row.first_action_time || now,
          last_action_time: now,
          dishes_count: currentDishes + addDishes,
          orders_count: currentOrders + addOrders,
        })
        .eq("id", row.id);
    } else {
      await supabase.from("staff_attendance").insert({
        restaurant_id: restaurantId,
        staff_id: staffId,
        date: todayStr,
        status: "confirmed",
        login_time: now,
        first_action_time: now,
        last_action_time: now,
        dishes_count: addDishes,
        orders_count: addOrders || 1,
        created_at: now,
      });
    }
  } catch (err) {
    console.error("[attendance] recordStaffActionAttendance failed:", err);
  }
}

/** Fetch monthly attendance and calculate worked days, absent days, and dishes/services count. */
export async function getStaffMonthlyAttendanceCore(
  restaurantId: string,
  staffId: string,
  monthStr?: string,
): Promise<StaffMonthlyAttendanceSummary> {
  const targetMonth = monthStr || getCurrentMonthString();
  const todayStr = getTodayString();

  // 1. Fetch staff member info
  const staffRes = await supabase
    .from("staff")
    .select("id, name, role, created_at")
    .eq("id", staffId)
    .maybeSingle();

  const staff = (staffRes.data as any) || { id: staffId, name: "موظف" };

  // 2. Fetch all attendance records for this month
  const recordsRes = await supabase
    .from("staff_attendance")
    .select("*")
    .eq("restaurant_id", restaurantId)
    .eq("staff_id", staffId);

  const allRecords = (recordsRes.data ?? []) as any[];
  const monthRecords = allRecords.filter((r) =>
    String(r.date || "").startsWith(targetMonth),
  );

  const recordByDate = new Map<string, any>();
  let totalDishes = 0;
  let totalOrders = 0;

  for (const r of monthRecords) {
    recordByDate.set(r.date, r);
    totalDishes += Number(r.dishes_count) || 0;
    totalOrders += Number(r.orders_count) || 0;
  }

  // 3. Compute active days from start of month up to min(today, endOfMonth)
  const [yearNum, monthNum] = targetMonth.split("-").map(Number);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();

  // Start from employee creation date if they joined during this month
  let startDay = 1;
  if (staff.created_at && String(staff.created_at).startsWith(targetMonth)) {
    startDay = Math.max(1, new Date(staff.created_at).getDate());
  }

  // Determine the cutoff day to compute absence:
  // If targetMonth is current month, only check days up to today.
  // If targetMonth is in the past, check up to full daysInMonth.
  let endDay = daysInMonth;
  if (targetMonth === getCurrentMonthString()) {
    endDay = Math.min(daysInMonth, new Date().getDate());
  } else if (targetMonth > getCurrentMonthString()) {
    endDay = 0; // Future month
  }

  let presentCount = 0;
  const absentDates: string[] = [];

  for (let d = startDay; d <= endDay; d++) {
    const dayStr = `${targetMonth}-${String(d).padStart(2, "0")}`;
    const rec = recordByDate.get(dayStr);
    if (rec && (rec.status === "confirmed" || rec.status === "checked_in")) {
      presentCount++;
    } else {
      absentDates.push(dayStr);
    }
  }

  const todayRecord = recordByDate.get(todayStr);
  const todayStatus: StaffAttendanceStatus = todayRecord
    ? todayRecord.status
    : "absent";

  return {
    staff_id: staffId,
    staff_name: staff.name || "موظف",
    role: staff.role ?? null,
    month: targetMonth,
    present_days_count: presentCount,
    absent_days_count: absentDates.length,
    absent_dates: absentDates,
    total_dishes: totalDishes,
    total_orders: totalOrders,
    today_status: todayStatus,
    records: monthRecords,
  };
}

/** Server function to get an individual staff member's attendance summary. */
export const getStaffMonthlyAttendance = createServerFn({ method: "GET" })
  .validator((d: { staffId: string; month?: string }) => d)
  .handler(async ({ data }) => {
    const authHeader = getRequestHeader("Authorization");
    const rid = await requireRestaurantId(authHeader);
    const input = data as { staffId: string; month?: string };
    return getStaffMonthlyAttendanceCore(rid, input.staffId, input.month);
  });

/** Server function to get attendance summary for all staff in the restaurant. */
export const getAllStaffAttendanceSummary = createServerFn({ method: "GET" })
  .validator((d: { month?: string }) => d)
  .handler(async ({ data }) => {
    const authHeader = getRequestHeader("Authorization");
    const rid = await requireRestaurantId(authHeader);
    const input = (data ?? {}) as { month?: string };
    const targetMonth = input.month || getCurrentMonthString();

    const staffListRes = await supabase
      .from("staff")
      .select("id, name, role, created_at, frozen")
      .eq("restaurant_id", rid);

    const staffList = (staffListRes.data ?? []).filter(
      (s: any) => !s.frozen,
    ) as any[];

    const summaries = await Promise.all(
      staffList.map((s) =>
        getStaffMonthlyAttendanceCore(rid, s.id, targetMonth),
      ),
    );

    return summaries;
  });
