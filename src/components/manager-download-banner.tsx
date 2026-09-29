import { useEffect, useState } from "react";
import { Download, Monitor, Smartphone, BellRing } from "lucide-react";
import { isEmbeddedWebView } from "@/lib/device";

const DESKTOP_URL = "https://github.com/mohammedbachir/SahlDZ/releases/download/v1.01/SahlDZ-Setup-1.0.1.exe";
const APK_URL = "https://github.com/mohammedbachir/SahlDZ/releases/download/v1.0.0/sahldz-v1.2.0.apk";

// Always-visible banner for the manager's post-login overview page (/ops).
// Shows only in a real web browser: the desktop app (Electron) and the mobile
// app (WebView) already run the program, so nagging them is pointless.
export function ManagerDownloadBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(
      !isEmbeddedWebView() &&
        typeof window !== "undefined" &&
        !window.__ELECTRON__,
    );
  }, []);

  if (!show) return null;

  return (
    <div
      className="mx-2 mt-2 mb-1 rounded-2xl border border-[var(--primary)]/25 bg-gradient-to-l from-[var(--card)] to-[var(--primary)]/10 p-4 shadow-glass"
      role="complementary"
    >
      <div className="flex flex-col md:flex-row md:items-center gap-4">
        <div className="flex-1 min-w-0">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-[11px] font-bold mb-2">
            <BellRing className="w-3 h-3" />
            ثبّت التطبيق لتوصلك الإشعارات
          </div>
          <h3 className="font-bold text-sm text-[var(--foreground)] leading-snug">
            حمّل تطبيق الهاتف على موبايلك لتصلك الإشعارات في أي وقت، وحمّل
            برنامج سطح المكتب وقم بتثبيته لمستخدميك.
          </h3>
        </div>
        <div className="flex flex-wrap gap-2.5 shrink-0">
          <a
            href={APK_URL}
            download
            className="group inline-flex items-center gap-2 rounded-xl border border-green-500/30 bg-[var(--card)] px-4 py-2.5 hover:border-green-500 hover:-translate-y-0.5 transition-all"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
              <Smartphone className="w-4 h-4 text-white" />
            </div>
            <span className="leading-tight text-right">
              <span className="block text-xs font-bold text-[var(--foreground)]">
                تطبيق الهاتف
              </span>
              <span className="block text-[11px] text-green-600 dark:text-green-400 font-semibold inline-flex items-center gap-1">
                <Download className="w-3 h-3" />
                للإشعارات — تحميل
              </span>
            </span>
          </a>
          <a
            href={DESKTOP_URL}
            download
            className="group inline-flex items-center gap-2 rounded-xl border border-[var(--primary)]/30 bg-[var(--card)] px-4 py-2.5 hover:border-[var(--primary)] hover:-translate-y-0.5 transition-all"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[#b97f2c] flex items-center justify-center">
              <Monitor className="w-4 h-4 text-white" />
            </div>
            <span className="leading-tight text-right">
              <span className="block text-xs font-bold text-[var(--foreground)]">
                برنامج سطح المكتب
              </span>
              <span className="block text-[11px] text-[var(--primary)] font-semibold inline-flex items-center gap-1">
                <Download className="w-3 h-3" />
                للمستخدمين — تحميل
              </span>
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
