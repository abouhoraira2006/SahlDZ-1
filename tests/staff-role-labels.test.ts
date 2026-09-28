import { describe, expect, it } from "vitest";
import {
  ROLE_CASHIER,
  ROLE_KITCHEN,
  ROLE_WAITER,
  derivePermissionsFromRole,
  normalizePermissions,
  normalizeRoleLabel,
  roleLabelFor,
} from "@/lib/staff-permissions";

// ─── Legacy role label compatibility ─────────────────────────────
//
// `staff.role` is a display label synced from the permission list
// ("المطبخ"), while the role constants are bare ("مطبخ"). Comparing the two
// verbatim made every staff member added through the permissions UI
// invisible to the kitchen screens. These tests pin the normalization so the
// two spellings can never diverge again.

describe("normalizeRoleLabel", () => {
  it("strips the Arabic definite article so labels match the constants", () => {
    expect(normalizeRoleLabel("المطبخ")).toBe(ROLE_KITCHEN);
    expect(normalizeRoleLabel("النادل")).toBe(ROLE_WAITER);
    expect(normalizeRoleLabel("الكاشير")).toBe(ROLE_CASHIER);
  });

  it("leaves the bare constants untouched", () => {
    expect(normalizeRoleLabel(ROLE_KITCHEN)).toBe(ROLE_KITCHEN);
    expect(normalizeRoleLabel(ROLE_WAITER)).toBe(ROLE_WAITER);
    expect(normalizeRoleLabel(ROLE_CASHIER)).toBe(ROLE_CASHIER);
  });

  it("trims surrounding whitespace and tolerates junk input", () => {
    expect(normalizeRoleLabel("  مطبخ  ")).toBe(ROLE_KITCHEN);
    expect(normalizeRoleLabel(null)).toBe("");
    expect(normalizeRoleLabel(undefined)).toBe("");
    expect(normalizeRoleLabel(42)).toBe("");
  });
});

describe("derivePermissionsFromRole", () => {
  it("maps both spellings of the kitchen role to the kitchen permission", () => {
    expect(derivePermissionsFromRole("المطبخ")).toEqual(["kitchen"]);
    expect(derivePermissionsFromRole(ROLE_KITCHEN)).toEqual(["kitchen"]);
  });

  it("maps both spellings of the waiter and cashier roles", () => {
    expect(derivePermissionsFromRole("النادل")).toEqual(["waiter"]);
    expect(derivePermissionsFromRole("الكاشير")).toEqual(["cashier"]);
  });

  it("returns nothing for non-operational roles", () => {
    expect(derivePermissionsFromRole("سائق توصيل")).toEqual([]);
    expect(derivePermissionsFromRole("")).toEqual([]);
  });
});

describe("roleLabelFor round-trip", () => {
  it("survives a label → permissions → label cycle", () => {
    for (const role of [ROLE_KITCHEN, ROLE_WAITER, ROLE_CASHIER]) {
      const label = roleLabelFor(derivePermissionsFromRole(role));
      expect(normalizeRoleLabel(label)).toBe(role);
    }
  });

  it("still grants the kitchen permission after the round-trip", () => {
    const label = roleLabelFor(["kitchen"]);
    expect(normalizeRoleLabel(label)).toBe(ROLE_KITCHEN);
    expect(derivePermissionsFromRole(label)).toEqual(["kitchen"]);
  });
});

describe("normalizePermissions", () => {
  it("keeps the kitchen permission among mixed ops permissions", () => {
    const perms = normalizePermissions([
      "kitchen",
      "inventory",
      "inventoryCount",
      "recipes",
    ]);
    expect(perms).toContain("kitchen");
  });
});
