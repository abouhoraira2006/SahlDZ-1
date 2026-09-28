import { Link } from "@tanstack/react-router";
import {
  Settings,
  Users,
  Sparkles,
  Palette,
  ShoppingBag,
  Bike,
  ChevronLeft,
  LayoutGrid,
  ChefHat,
} from "lucide-react";

export function SettingsHubView({ basePath }: { basePath: string }) {
  const SETTINGS_CARDS = [
    {
      title: "إعدادات المطعم",
      description: "تعديل اسم المطعم، الشعار، ورابط خرائط جوجل، ورقم التسجيل.",
      icon: Settings,
      to: `${basePath}/restaurant`,
    },
    {
      title: "الموظفون",
      description:
        "إضافة وحذف الموظفين وتعديل صلاحياتهم (كاشير، نادل، مطبخ...).",
      icon: Users,
      to: `${basePath}/employees`,
    },
    {
      title: "المطابخ والطباعة",
      description:
        "قسّم العمل بين المطابخ، واربط كل مطبخ بطابعته ليطبع أصنافه تلقائياً.",
      icon: ChefHat,
      to: `${basePath}/kitchens`,
    },
    {
      title: "القاعات والطاولات",
      description:
        "أضف قاعاتك بعدد الطاولات الذي تريده، وولّد رمز QR لكل طاولة من زر واحد.",
      icon: LayoutGrid,
      to: `${basePath}/halls`,
    },
    {
      title: "صفحة الترحيب (Splash)",
      description: "تخصيص الشاشة الأولى التي تظهر للعميل عند مسح QR الطاولة.",
      icon: Sparkles,
      to: `${basePath}/welcome`,
    },
    {
      title: "شكل المنيو",
      description: "تغيير الألوان، النسق، ومظهر المنيو الرقمي للعميل.",
      icon: Palette,
      to: `${basePath}/appearance`,
    },
    {
      title: "نظام التوصيل (Delivery)",
      description:
        "تفعيل وتخصيص رابط الطلب من المنزل ومشاركته عبر مواقع التواصل.",
      icon: Bike,
      to: `${basePath}/delivery`,
    },
    {
      title: "الطلب السريع (Takeaway)",
      description:
        "إنشاء وطباعة رمز QR للطلب السريع من الطاولة أو واجهة المحل.",
      icon: ShoppingBag,
      to: `${basePath}/takeaway`,
    },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5 sm:p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">
            <Settings className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-foreground">
              إعدادات النظام
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              إدارة كافة تفاصيل المطعم، الموظفين، والخدمات الرقمية
            </p>
          </div>
        </div>
      </div>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {SETTINGS_CARDS.map((card, idx) => {
          const Icon = card.icon;
          return (
            <Link
              key={idx}
              to={card.to}
              className="group bg-card border border-border hover:border-primary/40 rounded-xl p-5 transition-colors flex flex-col justify-between h-full"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <div className="w-9 h-9 rounded-lg bg-secondary text-primary flex items-center justify-center">
                    <Icon className="w-4 h-4" />
                  </div>
                  <ChevronLeft className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-1">
                  {card.title}
                </h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {card.description}
                </p>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
