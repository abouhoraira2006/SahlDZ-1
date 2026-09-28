import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import { getFirebaseDb } from "@/integrations/firebase/config";

// ── Functions under test ───────────────────────────────────────
import {
  addWaiterCore,
  deleteWaiterCore,
  listWaitersCore,
  toggleWaiterCore,
  updateWaiterPinCore,
  verifyWaiterPinCore,
  getPublicWaiterListCore,
} from "@/lib/waiter.functions";
import {
  addIndividualChefCore,
  deleteIndividualChefCore,
  getPublicChefListCore,
  listIndividualChefsCore,
  toggleIndividualChefCore,
  updateIndividualChefPinCore,
  verifyIndividualChefPinCore,
} from "@/lib/individual-chef.functions";
import {
  disableCashierCore,
  getCashierStatusCore,
  getPublicCashierLoginInfoCore,
  setCashierPinCore,
  verifyCashierPinCore,
} from "@/lib/cashier.functions";
import {
  createStaffAccountCore,
  deleteStaffAccountCore,
  listStaffAccountsCore,
  updateStaffPasswordCore,
} from "@/lib/settings.functions";
import { requireRestaurantIdFromToken } from "@/lib/server-staff-auth";
import { isStaffSessionExpired, makeStaffSessionToken } from "@/lib/staff-core";

const AUTH_BASE = "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1";

async function authRest(action: string, body: unknown): Promise<any> {
  const res = await fetch(`${AUTH_BASE}/${action}?key=fake-api-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `auth ${action} failed`);
  return json;
}

/**
 * Clears both emulators so every run starts deterministic (test-only endpoints).
 *
 * The wipe must target the same project id the emulator was started with
 * (`npm run dev:emulators` uses `sahldz-demo`). Wiping a different id silently
 * does nothing, which makes `accounts:signUp` fail with EMAIL_EXISTS on the
 * second run. Both ids are cleared so the suite is deterministic either way.
 */
async function wipeEmulators(): Promise<void> {
  for (const projectId of ["sahldz-demo", "test-project"]) {
    await fetch(
      `http://127.0.0.1:9099/emulator/v1/projects/${projectId}/accounts`,
      { method: "DELETE" },
    );
    await fetch(
      `http://127.0.0.1:8081/emulator/v1/projects/${projectId}/databases/(default)/documents`,
      { method: "DELETE" },
    );
  }
}

let ownerUid = "";
let ownerToken = "";
let managerUid = "";
let rid = "";

async function insertDoc(table: string, data: Record<string, unknown>): Promise<string> {
  const inserted = await (supabase.from(table) as any).insert(data).single();
  if (inserted.error) throw new Error(`seed ${table}: ${inserted.error.message}`);
  return (inserted.data as any).id;
}

beforeAll(async () => {
  if (!getFirebaseDb()) throw new Error("Firestore emulator not connected");
  await wipeEmulators();
  // Owner account in the Auth emulator (manager is created later by G1)
  const owner = await authRest("accounts:signUp", { email: "owner@test.dz", password: "owner123" });
  ownerUid = owner.localId;
  const login = await authRest("accounts:signInWithPassword", { email: "owner@test.dz", password: "owner123" });
  ownerToken = login.idToken;
  // Restaurant owned by the owner
  rid = await insertDoc("restaurants", {
    name: "مطعم الاختبار",
    owner_id: ownerUid,
    created_at: new Date().toISOString(),
  });
});

afterAll(async () => {
  // Clean the three tables so re-runs stay deterministic
  for (const t of ["staff", "user_roles"]) {
    await supabase.from(t).delete().eq("restaurant_id", rid);
  }
});

// ─── Group A: waiter addition → real PIN login chain ──────────
describe("المجموعة أ — إضافة نادل ودخوله الحقيقي", () => {
  let waiterId = "";
  const PIN = "424242";

  it("A1: تُضيف النادل في جدول staff برمز صالح", async () => {
    const res = await addWaiterCore(rid, "كريم", PIN);
    expect(res.ok).toBe(true);
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    const karim = (rows.data ?? []).find((s: any) => s.name === "كريم");
    expect(karim).toBeTruthy();
    expect(karim.role).toBe("نادل");
    expect(karim.pin).toBe(PIN);
    expect(karim.frozen).toBe(false);
    waiterId = karim.id;
  });

  it("A2: قائمة الدخول العامة تعرض كريم فقط", async () => {
    const res = await getPublicWaiterListCore(rid);
    expect(res.found).toBe(true);
    expect(res.name).toBe("مطعم الاختبار");
    expect(res.waiters.map((w: any) => w.name)).toContain("كريم");
    expect(res.waiters.every((w: any) => !("pin" in w))).toBe(true); // لا تسريب للرموز
  });

  it("A3: يرفض PIN خاطئ", async () => {
    await expect(verifyWaiterPinCore(waiterId, "111111")).rejects.toThrow("رمز PIN غير صحيح");
  });

  it("A3-ب: يرفض حساباً غير موجود", async () => {
    await expect(verifyWaiterPinCore("nope", PIN)).rejects.toThrow("الحساب غير موجود");
  });

  it("A4: يقبل الـ PIN الصحيح ويرجع جلسة سليمة", async () => {
    const res = await verifyWaiterPinCore(waiterId, PIN);
    expect(res.waiterName).toBe("كريم");
    expect(res.waiterId).toBe(waiterId);
    expect(res.restaurant.id).toBe(rid);
    expect(await isStaffSessionExpired(res.token)).toBe(false);
  });
});

// ─── Group B: freeze enforcement ───────────────────────────────
describe("المجموعة ب — تطبيق التجميد عند الدخول", () => {
  let waiterId = "";
  const PIN = "515151";

  beforeAll(async () => {
    await addWaiterCore(rid, "سمير", PIN);
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    waiterId = (rows.data ?? []).find((s: any) => s.name === "سمير").id;
  });

  it("B1/B2: يدخل قبل التجميد، ويُمنع بعده مع ظهور السبب", async () => {
    const ok = await verifyWaiterPinCore(waiterId, PIN);
    expect(ok.waiterName).toBe("سمير");

    await toggleWaiterCore(rid, waiterId, false); // إيقاف = تجميد
    await expect(verifyWaiterPinCore(waiterId, PIN)).rejects.toThrow(/تم تجميد حسابك/);

    await toggleWaiterCore(rid, waiterId, true); // B3: رفع الإيقاف
    const again = await verifyWaiterPinCore(waiterId, PIN);
    expect(again.waiterName).toBe("سمير");
  });

  it("B-إضافي: التجميد من صفحة ops (سبب مخصص) يُعرض أيضاً", async () => {
    await supabase
      .from("staff")
      .update({ frozen: true, freeze_reason: "غياب متكرر" })
      .eq("id", waiterId);
    await expect(verifyWaiterPinCore(waiterId, PIN)).rejects.toThrow(
      "تم تجميد حسابك: غياب متكرر",
    );
    await supabase.from("staff").update({ frozen: false, freeze_reason: null }).eq("id", waiterId);
  });
});

// ─── Group C: unified systems (settings CRUD ↔ staff table) ──
describe("المجموعة ج — وحدة النظامين", () => {
  it("C1: قائمة الإعدادات تعكس جدول staff", async () => {
    const res = await listWaitersCore(rid);
    const names = res.waiters.map((w) => w.name);
    expect(names).toContain("كريم");
    expect(names).toContain("سمير");
  });

  it("C2: تغيير PIN من الإعدادات يُطبق على الدخول فوراً", async () => {
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    const samir = (rows.data ?? []).find((s: any) => s.name === "سمير");
    await updateWaiterPinCore(rid, samir.id, "999999");
    await expect(verifyWaiterPinCore(samir.id, "515151")).rejects.toThrow("رمز PIN غير صحيح");
    const ok = await verifyWaiterPinCore(samir.id, "999999");
    expect(ok.waiterName).toBe("سمير");
  });

  it("C3: لا يمكن لمطعم آخر العبث بموظفينا (فحص الملكية)", async () => {
    const otherRid = await insertDoc("restaurants", {
      name: "مطعم آخر",
      owner_id: ownerUid,
      created_at: new Date().toISOString(),
    });
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    const samir = (rows.data ?? []).find((s: any) => s.name === "سمير");
    await expect(deleteWaiterCore(otherRid, samir.id)).rejects.toThrow("الحساب غير موجود");
    await expect(toggleWaiterCore(otherRid, samir.id, false)).rejects.toThrow("الحساب غير موجود");
  });

  it("C4: حذف النادل يمنع دخوله نهائياً", async () => {
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    const karim = (rows.data ?? []).find((s: any) => s.name === "كريم");
    await deleteWaiterCore(rid, karim.id);
    await expect(verifyWaiterPinCore(karim.id, "424242")).rejects.toThrow("الحساب غير موجود");
  });
});

// ─── Group D: kitchen staff ────────────────────────────────────
describe("المجموعة د — موظف المطبخ", () => {
  let chefId = "";
  const PIN = "636363";

  it("D1/D2: إضافة شيف، دخول صحيح، رفض الخاطئ", async () => {
    await addIndividualChefCore(rid, "الشيف يوسف", PIN);
    const list = await listIndividualChefsCore(rid);
    chefId = list.chefs.find((c) => c.name === "الشيف يوسف")!.id;

    await expect(verifyIndividualChefPinCore(chefId, "000000")).rejects.toThrow(
      "رمز PIN غير صحيح",
    );

    const ok = await verifyIndividualChefPinCore(chefId, PIN);
    expect(ok.chefName).toBe("الشيف يوسف");
    expect(ok.restaurant.id).toBe(rid);

    const pub = await getPublicChefListCore(rid);
    expect(pub.chefs.some((c: any) => c.id === chefId)).toBe(true);
  });

  it("D3: تجميد الشيف يمنعه مع السبب، وإيقاف/تشغيل يعملان", async () => {
    await toggleIndividualChefCore(rid, chefId, false);
    await expect(verifyIndividualChefPinCore(chefId, PIN)).rejects.toThrow(/تم تجميد حسابك/);
    await toggleIndividualChefCore(rid, chefId, true);
    const ok = await verifyIndividualChefPinCore(chefId, PIN);
    expect(ok.chefName).toBe("الشيف يوسف");
    await deleteIndividualChefCore(rid, chefId);
    await expect(verifyIndividualChefPinCore(chefId, PIN)).rejects.toThrow("الحساب غير موجود");
  });
});

// ─── Group E: shared cashier system ───────────────────────────
describe("المجموعة هـ — نظام الكاشير المشترك", () => {
  it("E0: قبل التفعيل — الدخول مرفوض والحالة معطلة", async () => {
    const info = await getPublicCashierLoginInfoCore(rid);
    expect(info.enabled).toBe(false);
    await expect(verifyCashierPinCore(rid, "1234")).rejects.toThrow("نظام الكاشير غير مفعّل");
    expect((await getCashierStatusCore(rid)).enabled).toBe(false);
  });

  it("E1/E2/E3: التفعيل بـ 4 أرقام ثم دخول صحيح/خاطئ", async () => {
    await setCashierPinCore(rid, "1234");
    expect((await getCashierStatusCore(rid)).enabled).toBe(true);

    await expect(verifyCashierPinCore(rid, "9999")).rejects.toThrow("رمز PIN غير صحيح");

    const ok = await verifyCashierPinCore(rid, "1234");
    expect(ok.restaurant.id).toBe(rid);
    expect(ok.token.startsWith("csh.")).toBe(true);
  });

  it("E4: التعطيل يحذف الرمز ويمنع الدخول", async () => {
    await disableCashierCore(rid);
    expect((await getCashierStatusCore(rid)).enabled).toBe(false);
    const info = await getPublicCashierLoginInfoCore(rid);
    expect(info.enabled).toBe(false);
    await expect(verifyCashierPinCore(rid, "1234")).rejects.toThrow("نظام الكاشير غير مفعّل");
  });

  it("E-تحقق: رمز غير مكوّن من 4 أرقام مرفوض", async () => {
    await expect(setCashierPinCore(rid, "12")).rejects.toThrow("يجب أن يكون الرمز 4 أرقام");
  });
});

// ─── Group F: role integrity & validation ─────────────────────
describe("المجموعة و — سلامة الأدوار والمدخلات", () => {
  it("F1: تحويل النادل لدور آخر يمنع دخول الويتر", async () => {
    const added = await addWaiterCore(rid, "ليلى", "717171");
    expect(added.ok).toBe(true);
    const rows = await supabase.from("staff").select("*").eq("restaurant_id", rid);
    const laila = (rows.data ?? []).find((s: any) => s.name === "ليلى");
    await supabase.from("staff").update({ role: "استقبال" }).eq("id", laila.id);
    await expect(verifyWaiterPinCore(laila.id, "717171")).rejects.toThrow(
      "هذا الحساب لم يعد حساب نادل",
    );
    // ولا يظهر في القائمة العامة بعد تغيير الدور
    const pub = await getPublicWaiterListCore(rid);
    expect(pub.waiters.some((w: any) => w.name === "ليلى")).toBe(false);
  });

  it("F2: مدخلات خاطئة تُرفض (اسم فارغ/PIN قصير)", async () => {
    await expect(addWaiterCore(rid, "   ", "1234")).rejects.toThrow("اكتب الاسم");
    await expect(addWaiterCore(rid, "فلان", "12")).rejects.toThrow("PIN من 4 إلى 6 أرقام");
    await expect(addIndividualChefCore(rid, "شيف", "abc")).rejects.toThrow(
      "PIN من 4 إلى 6 أرقام",
    );
  });

  it("F3: المطعم غير موجود → القائمة found=false", async () => {
    const res = await getPublicWaiterListCore("missing-rid");
    expect(res.found).toBe(false);
    expect(res.waiters).toHaveLength(0);
  });
});

// ─── Group G: manager accounts ────────────────────────────────
describe("المجموعة ز — حسابات المديرين", () => {
  it("G1/G3: إنشاء حساب حقيقي + رفض البريد المكرر", async () => {
    const res = await createStaffAccountCore(rid, "Manager@Test.DZ ", "manager123", "production_manager");
    expect(res.staff.email).toBe("manager@test.dz");

    await expect(
      createStaffAccountCore(rid, "manager@test.dz", "another123", "hr_manager"),
    ).rejects.toThrow("هذا البريد مستخدم مسبقاً");

    const list = await listStaffAccountsCore(rid);
    const row = list.staff.find((s) => s.email === "manager@test.dz");
    expect(row?.role).toBe("production_manager");
    managerUid = row!.user_id; // captured for G2/G4
  });

  it("G2: توكن المدير يُحل إلى المطعم الصحيح", async () => {
    const login = await authRest("accounts:signInWithPassword", {
      email: "manager@test.dz",
      password: "manager123",
    });
    const resolvedRid = await requireRestaurantIdFromToken(login.idToken);
    expect(resolvedRid).toBe(rid);
  });

  it("G2-سلبي: توكن مزور يُرفض", async () => {
    await expect(requireRestaurantIdFromToken("not-a-real-token")).rejects.toThrow();
  });

  it("G-تحقق: بريد/كلمة سر غير صالحة تُرفض", async () => {
    await expect(createStaffAccountCore(rid, "bad-email", "123456", "staff")).rejects.toThrow(
      "البريد غير صالح",
    );
    await expect(
      createStaffAccountCore(rid, "x@y.dz", "123", "staff"),
    ).rejects.toThrow("كلمة السر 6 أحرف على الأقل");
  });

  it("G4: حذف الحساب يزيل دوره فقط", async () => {
    const list = await listStaffAccountsCore(rid);
    const row = list.staff.find((s) => s.email === "manager@test.dz")!;
    const res = await deleteStaffAccountCore(rid, row.user_id);
    expect(res.ok).toBe(true);
    const after = await listStaffAccountsCore(rid);
    expect(after.staff.some((s) => s.email === "manager@test.dz")).toBe(false);
    // مستخدم المصادقة ما زالت موجودة لكن بلا دور → لا مطعم
    const login = await authRest("accounts:signInWithPassword", {
      email: "manager@test.dz",
      password: "manager123",
    });
    await expect(requireRestaurantIdFromToken(login.idToken)).rejects.toThrow(
      "لا يوجد مطعم مرتبط بهذا الحساب",
    );
  });

  it("G-حدود: تغيير كلمة سر المدير غير مدعوم برسالة واضحة", async () => {
    await expect(updateStaffPasswordCore()).rejects.toThrow(
      "تغيير كلمة سر المديرين غير متاح بعد",
    );
  });
});

// ─── Token helpers sanity ─────────────────────────────────────
describe("توكن الجلسة", () => {
  it("توكن منتهي يُعتبر منتهياً", async () => {
    // Both helpers are async: they sign/verify an HMAC.
    const expired = `stf.abc.${Date.now() - 1000}`;
    expect(await isStaffSessionExpired(expired)).toBe(true);
    expect(await isStaffSessionExpired(await makeStaffSessionToken("abc"))).toBe(false);
    expect(await isStaffSessionExpired("garbage")).toBe(true);
  });
});
