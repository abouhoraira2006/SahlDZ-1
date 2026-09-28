import { describe, expect, it } from "vitest";
import {
  DEFAULT_KITCHEN_ID,
  defaultKitchen,
  groupLinesByKitchen,
  isSyntheticKitchen,
  nextDisplayOrder,
  resolveKitchenId,
  resolveLineKitchen,
  type Kitchen,
} from "@/lib/kitchens";

// ─── Print routing unit tests ─────────────────────────────────────
//
// The whole point of the feature is that one order can feed several stations
// and each station only ever sees its own lines. These tests pin the pure
// decision functions that make that happen, so a refactor cannot silently
// break the split.

describe("resolveKitchenId", () => {
  it("falls back to the default kitchen for every unset value", () => {
    expect(resolveKitchenId(null)).toBe(DEFAULT_KITCHEN_ID);
    expect(resolveKitchenId(undefined)).toBe(DEFAULT_KITCHEN_ID);
    expect(resolveKitchenId("")).toBe(DEFAULT_KITCHEN_ID);
    expect(resolveKitchenId("   ")).toBe(DEFAULT_KITCHEN_ID);
  });

  it("keeps a real kitchen id untouched", () => {
    expect(resolveKitchenId("k-pizza")).toBe("k-pizza");
  });
});

describe("isSyntheticKitchen", () => {
  it("treats the default and blanks as synthetic", () => {
    expect(isSyntheticKitchen(DEFAULT_KITCHEN_ID)).toBe(true);
    expect(isSyntheticKitchen(null)).toBe(true);
    expect(isSyntheticKitchen("k-pizza")).toBe(false);
  });
});

describe("resolveLineKitchen", () => {
  it("uses the category kitchen when the item has no override", () => {
    expect(
      resolveLineKitchen({
        item_kitchen_id: null,
        category_kitchen_id: "k-grill",
      }),
    ).toBe("k-grill");
  });

  it("lets the per-item override win over the category", () => {
    expect(
      resolveLineKitchen({
        item_kitchen_id: "k-pizza",
        category_kitchen_id: "k-grill",
      }),
    ).toBe("k-pizza");
  });

  it("falls back to the default kitchen when neither is set", () => {
    expect(
      resolveLineKitchen({
        item_kitchen_id: null,
        category_kitchen_id: null,
      }),
    ).toBe(DEFAULT_KITCHEN_ID);
  });

  it("ignores blank overrides instead of routing nowhere", () => {
    expect(
      resolveLineKitchen({
        item_kitchen_id: "   ",
        category_kitchen_id: "k-grill",
      }),
    ).toBe("k-grill");
  });
});

describe("groupLinesByKitchen", () => {
  it("splits a mixed order into one bucket per station", () => {
    const lines = [
      { name: "بيتزا", kitchen_id: "k-pizza" },
      { name: "شاورما", kitchen_id: "k-grill" },
      { name: "كسكس", kitchen_id: "k-pizza" },
      { name: "سلطة", kitchen_id: null },
    ];
    const groups = groupLinesByKitchen(lines);

    expect([...groups.keys()].sort()).toEqual(
      [DEFAULT_KITCHEN_ID, "k-grill", "k-pizza"].sort(),
    );
    expect(groups.get("k-pizza")?.map((l) => l.name)).toEqual([
      "بيتزا",
      "كسكس",
    ]);
    expect(groups.get("k-grill")?.map((l) => l.name)).toEqual(["شاورما"]);
    expect(groups.get(DEFAULT_KITCHEN_ID)?.map((l) => l.name)).toEqual(["سلطة"]);
  });

  it("preserves the original line order inside each bucket", () => {
    const lines = [
      { name: "1", kitchen_id: "k" },
      { name: "2", kitchen_id: "other" },
      { name: "3", kitchen_id: "k" },
      { name: "4", kitchen_id: "k" },
    ];
    const groups = groupLinesByKitchen(lines);
    expect(groups.get("k")?.map((l) => l.name)).toEqual(["1", "3", "4"]);
  });

  it("returns an empty map for an empty order", () => {
    expect(groupLinesByKitchen([]).size).toBe(0);
  });
});

describe("nextDisplayOrder", () => {
  it("returns 0 for an empty list", () => {
    expect(nextDisplayOrder([])).toBe(0);
  });

  it("appends after the highest existing order", () => {
    const ks = [
      { ...defaultKitchen(), id: "a", display_order: 0 },
      { ...defaultKitchen(), id: "b", display_order: 5 },
      { ...defaultKitchen(), id: "c", display_order: 2 },
    ] as Kitchen[];
    expect(nextDisplayOrder(ks)).toBe(6);
  });
});

describe("defaultKitchen", () => {
  it("prints to the OS default printer with auto print on", () => {
    const k = defaultKitchen();
    expect(k.id).toBe(DEFAULT_KITCHEN_ID);
    expect(k.printer_name).toBeNull();
    expect(k.copies).toBe(1);
    expect(k.auto_print).toBe(true);
  });
});
