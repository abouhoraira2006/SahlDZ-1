import { useState, useEffect } from "react";
import { useRestaurantId } from "@/lib/restaurant";
import {
  Smartphone,
  Monitor,
  Download,
  CheckCircle2,
  Info,
  Shield,
  Wifi,
} from "lucide-react";

export default function DownloadPage() {
  useRestaurantId();
  const [downloading, setDownloading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstallPWA() {
    if (!installPrompt) return;
    setDownloading(true);
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") {
      setInstallPrompt(null);
    }
    setDownloading(false);
  }

  function handleDownloadAPK() {
    setDownloading(true);
    const link = document.createElement("a");
    link.href = "https://github.com/mohammedbachir/SahlDZ/releases/download/v1.0.0/sahldz-v1.2.0.apk";
    link.download = "SahlDZ-v1.2.0.apk";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => setDownloading(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto p-4 space-y-6" dir="rtl">
      <div className="text-center space-y-3">
        <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-amber-500 to-amber-600 flex items-center justify-center">
          <Smartphone className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-2xl font-bold">تحميل تطبيق SahlDZ</h1>
        <p className="text-muted-foreground">اختر الطريقة المناسبة لجهازك</p>
      </div>

      {isStandalone && (
        <div className="rounded-2xl border border-green-500/30 bg-green-500/10 p-4 flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-green-500">
              التطبيق مثبت بالفعل
            </p>
            <p className="text-xs text-muted-foreground">
              أنت تستخدم التطبيق حالياً
            </p>
          </div>
        </div>
      )}

      {/* Option 1: Desktop (Windows) */}
      <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#D4A853] to-[#b97f2c] flex items-center justify-center shrink-0">
            <Monitor className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold">برنامج سطح المكتب (ويندوز)</h2>
            <p className="text-xs text-muted-foreground">
              نظام متكامل لكمبيوتر المطعم — المفضل للنقاط والاستقبال
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يعمل بنفس بيانات الموقع</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>حسابات العمال (نادل / مطبخ / كاشير) متاحة عليه فقط</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>أداء أسرع ومستقر للمهام اليومية</span>
          </div>
        </div>
        <button
          onClick={() => {
            setDownloading(true);
            const link = document.createElement("a");
            link.href = "https://github.com/mohammedbachir/SahlDZ/releases/download/v1.01/SahlDZ-Setup-1.0.1.exe";
            link.download = "SahlDZ-Setup-1.0.1.exe";
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            setTimeout(() => setDownloading(false), 2000);
          }}
          disabled={downloading}
          className="w-full py-3 rounded-xl bg-[#D4A853] text-[#1a1612] font-medium hover:bg-[#D4A853]/90 transition-colors disabled:opacity-50"
        >
          {downloading ? "جاري التحميل..." : "تحميل برنامج الويندوز (1.0.1)"}
        </button>
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-xl p-3">
          <p className="font-medium mb-1">خطوات التثبيت:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>حمّل الملف وشغّله</li>
            <li>
              إذا ظهر تحذير Windows، اضغط "معلومات أكثر" ثم "تشغيل على أي حال"
            </li>
            <li>اتبع خطوات التثبيت وافتح البرنامج</li>
          </ul>
        </div>
      </div>

      {/* Option 2: PWA */}
      <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shrink-0">
            <Wifi className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold">ثبّت من المتصفح (PWA)</h2>
            <p className="text-xs text-muted-foreground">
              أسرع طريقة — بدون تحميل
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يعمل بدون إنترنت</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يتحدث تلقائياً</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يتكلّف صفر ميجا</span>
          </div>
        </div>
        {installPrompt && (
          <button
            onClick={handleInstallPWA}
            disabled={downloading}
            className="w-full py-3 rounded-xl bg-blue-500 text-white font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
          >
            {downloading ? "جاري التثبيت..." : "تثبيت الآن"}
          </button>
        )}
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-xl p-3">
          <p className="font-medium mb-1">كيفية التثبيت يدوياً:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>Chrome: اضغط النقاط الثلاث ⋮ ثم "تثبيت التطبيق"</li>
            <li>Safari: اضغط زر المشاركة ثم "إضافة إلى الشاشة الرئيسية"</li>
            <li>Samsung: اضغط النقاط الثلاث ثم "إضافة إلى الشاشة الرئيسية"</li>
          </ul>
        </div>
      </div>

      {/* Option 3: APK */}
      <div className="rounded-2xl border border-border/60 bg-card p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center shrink-0">
            <Download className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="font-bold">حمّل ملف APK</h2>
            <p className="text-xs text-muted-foreground">
              لأجهزة Android — تثبيت مباشر
            </p>
          </div>
        </div>
        <div className="space-y-2 text-sm text-muted-foreground">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>تثبيت مباشر بدون متجر</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يفتح مباشرة على تطبيق التقارير للمدير</span>
          </div>
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-green-500" />
            <span>يعمل مع الأجهزة القديمة</span>
          </div>
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-500" />
            <span>آمن — يفتح الموقع فقط داخل تطبيق</span>
          </div>
        </div>
        <button
          onClick={handleDownloadAPK}
          disabled={downloading}
          className="w-full py-3 rounded-xl bg-green-500 text-white font-medium hover:bg-green-600 transition-colors disabled:opacity-50"
        >
          {downloading ? "جاري التحميل..." : "تحميل SahlDZ v1.2.0"}
        </button>
        <div className="text-xs text-muted-foreground bg-muted/50 rounded-xl p-3">
          <p className="font-medium mb-1">خطوات التثبيت:</p>
          <ul className="space-y-1 list-disc list-inside">
            <li>حمّل الملف واضغط عليه</li>
            <li>إذا ظهرت رسالة تحذير، اضغط "تثبيت على أي حال"</li>
            <li>بعض الأجهزة تطلب تفعيل "مصادر غير معروفة" من الإعدادات</li>
            <li>ثبّت التطبيق واستمتع</li>
          </ul>
        </div>
      </div>

      {/* Info */}
      <div className="rounded-2xl border border-border/60 bg-card/50 p-4 flex items-start gap-3">
        <Info className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
        <div className="text-xs text-muted-foreground space-y-1">
          <p className="font-medium">أيهما أفضل؟</p>
          <p>
            <strong>PWA</strong> — الأفضل للأغلبية. أحدث، أصغر حجماً، يتحدث
            تلقائياً. يحتاج متصفح حديث.
          </p>
          <p>
            <strong>APK</strong> — الأفضل للجهاز القديم أو إذا أردت توزيعه
            يدوياً على الموظفين.
          </p>
        </div>
      </div>
    </div>
  );
}
