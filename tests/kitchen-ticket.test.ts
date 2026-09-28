import { describe, expect, it } from "vitest";
import { buildKitchenTicket } from "@/lib/kitchen-print";

// ─── Kitchen ticket markup ─────────────────────────────────────
//
// The ticket is rendered inside the desktop shell's own BrowserWindow, where
// the app's CSS does not exist. So this HTML is the whole stylesheet, and it
// has to carry two things on its own: correct Arabic/RTL, and an escape hatch
// for any text a menu item or a customer can inject.

describe("buildKitchenTicket", () => {
  const base = {
    kitchenName: "مطبخ البيتزا",
    kitchenCode: "PIZZA",
    orderNo: 42,
    orderType: "dine_in",
    tableNumber: 7,
    createdAt: "2026-01-15T10:30:00.000Z",
    lines: [{ name: "بيتزا مارجريتا", qty: 2 }],
  };

  it("is a complete standalone document", () => {
    const html = buildKitchenTicket(base);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('lang="ar"');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain("</html>");
  });

  it("shows the station name and code so the right kitchen is obvious", () => {
    const html = buildKitchenTicket(base);
    expect(html).toContain("مطبخ البيتزا");
    expect(html).toContain("PIZZA");
  });

  it("carries the order identity and the table", () => {
    const html = buildKitchenTicket(base);
    expect(html).toContain("طلب رقم");
    expect(html).toContain("42");
    expect(html).toContain("طاولة");
    expect(html).toContain("7");
  });

  it("renders each line with its quantity", () => {
    const html = buildKitchenTicket({
      ...base,
      lines: [
        { name: "بيتزا مارجريتا", qty: 2 },
        { name: "سلطة", qty: 1 },
      ],
    });
    expect(html).toContain("بيتزا مارجريتا");
    expect(html).toContain("سلطة");
    expect(html).toContain('class="qty"');
  });

  it("translates the order type and falls back to the raw value", () => {
    expect(buildKitchenTicket({ ...base, orderType: "delivery" })).toContain(
      "توصيل",
    );
    expect(buildKitchenTicket({ ...base, orderType: "takeaway" })).toContain(
      "تيك أواي",
    );
    expect(buildKitchenTicket({ ...base, orderType: "weird" })).toContain(
      "weird",
    );
  });

  it("shows the note when the chef wrote one, underlined", () => {
    const html = buildKitchenTicket({
      ...base,
      lines: [{ name: "بيتزا", qty: 1, note: "بدون بصل" }],
    });
    expect(html).toContain("بدون بصل");
    expect(html).toContain("note");
  });

  it("renders option choices under the dish", () => {
    const html = buildKitchenTicket({
      ...base,
      lines: [
        {
          name: "بيتزا",
          qty: 1,
          options: [{ label: "الحجم", choice: "كبير" }],
        },
      ],
    });
    expect(html).toContain("الحجم");
    expect(html).toContain("كبير");
  });

  it("always shows the customer name, and delivery-only the phone/address", () => {
    const delivery = buildKitchenTicket({
      ...base,
      orderType: "delivery",
      tableNumber: null,
      customerName: "سعيد",
      customerPhone: "0555123456",
      customerAddress: "شارع الاستقلال",
    });
    expect(delivery).toContain("سعيد");
    expect(delivery).toContain("0555123456");
    expect(delivery).toContain("شارع الاستقلال");

    // A table order never needs a phone or an address on the ticket.
    const dineIn = buildKitchenTicket({
      ...base,
      customerName: "سعيد",
      customerPhone: "0555123456",
      customerAddress: "شارع الاستقلال",
    });
    expect(dineIn).toContain("سعيد");
    expect(dineIn).not.toContain("0555123456");
    expect(dineIn).not.toContain("شارع الاستقلال");
    expect(dineIn).not.toContain("الهاتف");
    expect(dineIn).not.toContain("العنوان");
  });

  it("escapes injected markup so a menu item cannot break the ticket", () => {
    const html = buildKitchenTicket({
      ...base,
      lines: [
        { name: "<script>alert(1)</script>", qty: 1 },
        { name: "</body><h1>fake", qty: 1 },
      ],
      orderNotes: "<img src=x onerror=alert(2)>",
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("</body><h1>fake");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;script&gt;");
  });

  it("survives a ticket with no lines at all", () => {
    const html = buildKitchenTicket({ ...base, lines: [] });
    expect(html).toContain("</html>");
  });

  it("tolerates a missing or bogus timestamp", () => {
    expect(
      buildKitchenTicket({ ...base, createdAt: "not-a-date" }),
    ).toContain("not-a-date");
    expect(
      buildKitchenTicket({ ...base, createdAt: "" }),
    ).toContain("</html>");
  });

  it("uses a thermal-friendly page width", () => {
    expect(buildKitchenTicket(base)).toContain("80mm");
  });
});
