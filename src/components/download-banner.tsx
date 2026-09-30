import { Monitor, Smartphone, Download, ArrowLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { DESKTOP_DOWNLOAD_URL } from "@/config/download";

const DESKTOP_URL = DESKTOP_DOWNLOAD_URL;
const APK_URL = "https://github.com/mohammedbachir/SahlDZ/releases/download/v1.0.0/sahldz-v1.2.0.apk";

export function DownloadBanner() {
  return (
    <section className="py-10 md:py-14" dir="rtl">
      <div className="container-sahl">
        <div className="relative overflow-hidden rounded-2xl border border-[var(--primary)]/30 bg-gradient-to-br from-[var(--card)] to-[var(--primary)]/10 p-6 md:p-10">
          <div className="absolute -top-24 -left-24 w-64 h-64 rounded-full bg-[var(--primary)]/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col lg:flex-row lg:items-center gap-8">
            <div className="flex-1 text-center lg:text-right">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] text-xs font-bold mb-4">
                <Download className="w-3.5 h-3.5" />
                تحميل التطبيقات
              </div>
              <h2 className="text-2xl md:text-3xl font-bold text-[var(--foreground)] mb-3">
                ثبّت Sahl DZ على جهازك
              </h2>
              <p className="text-sm md:text-base text-[var(--muted-foreground)] leading-relaxed max-w-xl mx-auto lg:mx-0">
                حمّل برنامج سطح المكتب للمطاعم أو تطبيق أندرويد، واستخدم النظام
                بسرعة مع أفضل أداء وإشعارات فورية.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <a
                href={DESKTOP_URL}
                download
                className="group flex flex-col items-center gap-3 rounded-xl border border-[var(--primary)]/25 bg-[var(--card)] p-5 hover:border-[var(--primary)] hover:-translate-y-0.5 transition-all shadow-lg shadow-black/5"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--primary)] to-[#b97f2c] flex items-center justify-center">
                  <Monitor className="w-6 h-6 text-white" />
                </div>
                <span className="font-bold text-[var(--foreground)]">
                  برنامج سطح المكتب
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  Windows — نظام متكامل للنقاط
                </span>
                <span className="mt-1 inline-flex items-center text-sm font-semibold text-[var(--primary)]">
                  <Download className="w-4 h-4 ml-1" />
                  تحميل الآن
                </span>
              </a>

              <a
                href={APK_URL}
                download
                className="group flex flex-col items-center gap-3 rounded-xl border border-green-500/25 bg-[var(--card)] p-5 hover:border-green-500 hover:-translate-y-0.5 transition-all shadow-lg shadow-black/5"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center">
                  <Smartphone className="w-6 h-6 text-white" />
                </div>
                <span className="font-bold text-[var(--foreground)]">
                  تطبيق أندرويد
                </span>
                <span className="text-xs text-[var(--muted-foreground)]">
                  APK — للهواتف والأجهزة اللوحية
                </span>
                <span className="mt-1 inline-flex items-center text-sm font-semibold text-green-500">
                  <Download className="w-4 h-4 ml-1" />
                  تحميل الآن
                </span>
              </a>
            </div>
          </div>

          <div className="relative mt-6 text-center">
            <Link
              to="/download"
              className="inline-flex items-center text-sm font-semibold text-[var(--primary)] hover:underline"
            >
              كل طرق التحميل والمساعدة
              <ArrowLeft className="w-4 h-4 mr-1.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
