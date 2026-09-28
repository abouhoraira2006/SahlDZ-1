// ─── Silent kitchen printing (renderer side) ────────────────────
//
// The desktop shell owns printing: it renders the ticket to PDF with Electron
// and hands it to SumatraPDF, so the terminal never shows a print dialog and
// never picks the wrong printer by accident.
//
// Outside Electron (phones, tablets, browsers) none of this exists, so every
// function degrades to the normal `window.print()` path. The kitchen keeps
// working on a browser — it just asks the operator to confirm the printer.

export type PrintCapabilities = {
  /** The desktop shell can print silently. */
  supported: boolean;
  /** SumatraPDF is bundled and reachable. */
  sumatra: boolean;
  reason?: string;
};

export type PrinterInfo = { name: string; isDefault: boolean };

function api() {
  if (typeof window === "undefined") return null;
  if (!window.__ELECTRON__) return null;
  return window.electronAPI ?? null;
}

/** True when a silent print is possible on this device. */
export function canPrintSilently(): boolean {
  return !!api();
}

/**
 * Probes the desktop shell once. Cached, because the answer cannot change
 * while the app is running and the answer gates the print button.
 */
let capsCache: PrintCapabilities | null = null;
export async function getPrintCapabilities(): Promise<PrintCapabilities> {
  if (capsCache) return capsCache;
  const a = api();
  if (!a) {
    capsCache = { supported: false, sumatra: false, reason: "not-desktop" };
    return capsCache;
  }
  try {
    capsCache = await a.getPrintCapabilities();
  } catch {
    capsCache = { supported: true, sumatra: false, reason: "probe-failed" };
  }
  return capsCache;
}

/** Every printer Windows knows about. Empty outside Electron. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const a = api();
  if (!a) return [];
  try {
    return await a.listPrinters();
  } catch {
    return [];
  }
}

export type TicketPrintResult = {
  ok: boolean;
  /** How it was printed, for the operator-facing message. */
  via: "silent" | "dialog" | "none";
  reason?: string;
};

// ─── Ticket markup ─────────────────────────────────────────────
//
// A standalone HTML document, not a fragment: the desktop shell renders it in
// its own BrowserWindow, where none of the app's CSS or fonts are loaded. The
// inline styles below are therefore the ticket's entire stylesheet, and they
// use generic families so whatever the terminal has installed renders Arabic.

export type KitchenTicketLine = {
  name: string;
  qty: number;
  note?: string | null;
  options?: { label: string; choice: string }[];
};

export type KitchenTicketData = {
  /** Kitchen code, e.g. "PIZZA" — the station this ticket belongs to. */
  kitchenName: string;
  kitchenCode?: string;
  orderNo: string | number | null;
  orderType: string;
  tableNumber?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  orderNotes?: string | null;
  createdAt: string;
  lines: KitchenTicketLine[];
};

function esc(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const ORDER_TYPE_AR: Record<string, string> = {
  dine_in: "داخل المطعم",
  takeaway: "تيك أواي",
  delivery: "توصيل",
};

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return esc(iso);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return esc(iso);
  }
}

/** Builds the printable ticket for one kitchen's slice of an order. */
export function buildKitchenTicket(data: KitchenTicketData): string {
  const rows = data.lines
    .map((l) => {
      const opts = (l.options ?? [])
        .map(
          (o) =>
            `<div class="opt">- ${esc(o.label)}: ${esc(o.choice)}</div>`,
        )
        .join("");
      const note = l.note ? `<div class="note">${esc(l.note)}</div>` : "";
      return `<tr>
        <td class="qty">${esc(l.qty)}</td>
        <td class="name">${esc(l.name)}${opts}${note}</td>
      </tr>`;
    })
    .join("");

  const meta: string[] = [];
  if (data.tableNumber) meta.push(`<b>طاولة:</b> ${esc(data.tableNumber)}`);
  if (data.customerName) meta.push(`<b>العميل:</b> ${esc(data.customerName)}`);
  // A phone number and an address are the driver's job, not the kitchen's:
  // they are printed only on delivery, so a customer on a table order does not
  // have their contact details sitting on every counter ticket.
  if (data.orderType === "delivery") {
    if (data.customerPhone) meta.push(`<b>الهاتف:</b> ${esc(data.customerPhone)}`);
    if (data.customerAddress)
      meta.push(`<b>العنوان:</b> ${esc(data.customerAddress)}`);
  }

  const notes = data.orderNotes
    ? `<div class="box"><b>ملاحظات:</b> ${esc(data.orderNotes)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<title>تذكرة ${esc(data.kitchenCode || data.kitchenName)}</title>
<style>
  @page { size: 80mm auto; margin: 4mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: "Segoe UI", Tahoma, Arial, sans-serif;
    direction: rtl; font-size: 12pt; color: #000; line-height: 1.5;
    width: 72mm; padding: 2mm;
  }
  h1 { font-size: 15pt; text-align: center; margin-bottom: 1mm; }
  .code { text-align: center; font-size: 11pt; letter-spacing: 2px; color: #333; }
  hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
  .meta { font-size: 10.5pt; }
  .meta div { margin: 0.5mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1.2mm 0; vertical-align: top; }
  .qty {
    width: 10mm; font-weight: bold; font-size: 13pt; text-align: center;
    border: 1px solid #000; border-radius: 2px;
  }
  .name { padding-right: 3mm; font-weight: 600; }
  .opt { font-weight: 400; font-size: 10pt; padding-right: 2mm; color: #222; }
  .note {
    font-weight: 700; font-size: 11pt; padding-right: 2mm;
    text-decoration: underline;
  }
  .box {
    border: 1px solid #000; border-radius: 2px; padding: 1.5mm; margin: 2mm 0;
    font-size: 10.5pt;
  }
  .foot { text-align: center; font-size: 9.5pt; margin-top: 3mm; color: #333; }
</style>
</head>
<body>
  <h1>${esc(data.kitchenName)}</h1>
  <div class="code">${esc(data.kitchenCode || "")}</div>
  <hr>
  <div class="meta">
    <div><b>طلب رقم:</b> ${esc(data.orderNo ?? "-")}</div>
    <div><b>النوع:</b> ${esc(ORDER_TYPE_AR[data.orderType] || data.orderType)}</div>
    <div><b>الوقت:</b> ${fmtTime(data.createdAt)}</div>
    ${meta.map((m) => `<div>${m}</div>`).join("")}
  </div>
  <hr>
  <table>${rows}</table>
  ${notes}
  <div class="foot">-- تم --</div>
</body>
</html>`;
}

/** Renders `html` in an off-screen frame so the browser can print it. */
function printViaDialog(html: string): void {
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:0;visibility:hidden";
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
  }

  const cleanup = () => {
    setTimeout(() => frame.remove(), 1000);
  };

  frame.onload = () => {
    try {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
    } catch {
      /* popup-blocked or detached frame */
    }
    cleanup();
  };

  // If the document never fires onload (srcdoc-less write), fall back on a timer
  // so a ticket can never be silently dropped.
  setTimeout(cleanup, 3000);
}

/**
 * Prints a ticket to the given kitchen's printer.
 *
 * On the desktop this is fully silent and targets `printerName` (null = the
 * system default). In a browser it falls back to the normal print dialog,
 * which is the best a browser can do.
 */
export async function printKitchenTicket(opts: {
  html: string;
  printerName?: string | null;
  copies?: number;
  jobName?: string;
}): Promise<TicketPrintResult> {
  const a = api();

  if (!a) {
    if (typeof window !== "undefined" && opts.html) {
      printViaDialog(opts.html);
      return { ok: true, via: "dialog", reason: "not-desktop" };
    }
    return { ok: false, via: "none", reason: "not-desktop" };
  }

  try {
    const res = await a.printTicket({
      html: opts.html,
      printerName: opts.printerName ?? null,
      copies: opts.copies ?? 1,
      jobName: opts.jobName,
    });
    if (res.ok) return { ok: true, via: "silent", reason: res.printer || undefined };
    // Sumatra missing or wrong OS: never lose the ticket, print it anyway.
    printViaDialog(opts.html);
    return {
      ok: true,
      via: "dialog",
      reason: res.reason === "sumatra-missing" ? "sumatra-missing" : res.reason,
    };
  } catch (e) {
    printViaDialog(opts.html);
    return {
      ok: true,
      via: "dialog",
      reason: (e as Error).message,
    };
  }
}
