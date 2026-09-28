import { getFirebaseDb } from "@/integrations/firebase/config";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import {
  normalizePermissions,
  derivePermissionsFromRole,
  type StaffPermission,
} from "@/lib/staff-permissions";

// ─── Staff roles (legacy single-role labels) ───────────────────
// Kept here and re-exported for backward compatibility; the canonical
// definition lives in staff-permissions.ts (catalog + helpers).
export {
  ROLE_CASHIER,
  ROLE_WAITER,
  ROLE_KITCHEN,
  GLOBAL_ROLES,
  normalizeRoleLabel,
} from "@/lib/staff-permissions";
// ─── HMAC signing for session tokens ───────────────────────────
// In production, set STAFF_TOKEN_SECRET as an env variable.
// Fallback is used only in preview/development mode.
const TOKEN_SECRET =
  (typeof import.meta !== "undefined" &&
    (import.meta as any).env?.VITE_STAFF_TOKEN_SECRET) ||
  "dev-fallback-secret-do-not-use-in-production";

export async function hmacSign(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function hmacVerify(
  data: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSign(data);
  return expected === signature;
}

// ─── Serial / PIN generation (shared by ops UI and server fns) ─
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export const randomSerial = (): string => {
  let letters = "";
  for (let i = 0; i < 4; i++)
    letters += LETTERS[Math.floor(Math.random() * 26)];
  const digits = String(Math.floor(100000 + Math.random() * 900000));
  return `${letters}-${digits}`;
};

export const randomPin = (): string => {
  const len = Math.random() < 0.5 ? 4 : 6;
  const min = len === 4 ? 1000 : 100000;
  const max = len === 4 ? 9999 : 999999;
  return String(min + Math.floor(Math.random() * (max - min + 1)));
};

export async function generateUniqueSerial(): Promise<string> {
  const db = getFirebaseDb();
  for (let i = 0; i < 30; i++) {
    const s = randomSerial();
    if (!db) return s;
    const q = query(collection(db, "staff"), where("serial", "==", s));
    const snap = await getDocs(q);
    if (snap.empty) return s;
  }
  return randomSerial();
}

export async function generateUniquePin(): Promise<string> {
  const db = getFirebaseDb();
  for (let i = 0; i < 30; i++) {
    const pin = randomPin();
    if (!db) return pin;
    const q = query(collection(db, "staff"), where("pin", "==", pin));
    const snap = await getDocs(q);
    if (snap.empty) return pin;
  }
  return randomPin();
}

// ─── Staff session token ───────────────────────────────────────
// Signed opaque token: `stf.<staffId>.<expiryEpochMs>.<hmacSignature>`.
// The HMAC signature prevents token forgery.
// Long TTL so restaurant kiosk computers stay logged in for months.
export const STAFF_SESSION_TTL_MS = 365 * 24 * 3600 * 1000;

export const staffSessionExpiry = (): string =>
  new Date(Date.now() + STAFF_SESSION_TTL_MS).toISOString();

export async function makeStaffSessionToken(staffId: string): Promise<string> {
  const expiresAt = Date.now() + STAFF_SESSION_TTL_MS;
  const payload = `stf.${staffId}.${expiresAt}`;
  const sig = await hmacSign(payload);
  return `${payload}.${sig}`;
}

export async function parseStaffSessionToken(
  token: string | null | undefined,
): Promise<{ staffId: string; expiresAt: number } | null> {
  if (!token || !token.startsWith("stf.")) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const expiresAt = Number(parts[2]);
  if (!Number.isFinite(expiresAt)) return null;
  const payload = `stf.${parts[1]}.${parts[2]}`;
  const valid = await hmacVerify(payload, parts[3]);
  if (!valid) return null;
  return { staffId: parts[1], expiresAt };
}

export async function isStaffSessionExpired(
  token: string | null | undefined,
): Promise<boolean> {
  const parsed = await parseStaffSessionToken(token);
  if (!parsed) return true;
  return parsed.expiresAt <= Date.now();
}

// ─── Shared: resolve staff row + restaurant from session token ─
export async function resolveStaffFromToken(token: string): Promise<{
  staffRow: any;
  restaurantId: string;
  staffId: string;
  permissions: StaffPermission[];
}> {
  const parsed = await parseStaffSessionToken(token);
  if (!parsed) throw new Error("الجلسة منتهية — سجّل دخولك من جديد");

  const db = getFirebaseDb();
  if (!db) throw new Error("Firebase غير متصل");

  const staffSnap = await getDoc(doc(db, "staff", parsed.staffId));
  if (!staffSnap.exists()) throw new Error("الحساب غير موجود");
  const staffData = staffSnap.data() as Record<string, any>;
  const permissions = effectiveStaffPermissions(staffData);
  const staffRow = { id: staffSnap.id, ...staffData, permissions };

  return {
    staffRow,
    restaurantId: staffData.restaurant_id as string,
    staffId: parsed.staffId,
    permissions,
  };
}

/** Normalize the permissions of a staff row, falling back to the legacy role. */
export function effectiveStaffPermissions(
  row: Record<string, any>,
): StaffPermission[] {
  const stored = normalizePermissions(row.permissions);
  if (stored.length > 0) return stored as StaffPermission[];
  return derivePermissionsFromRole(row.role) as StaffPermission[];
}
