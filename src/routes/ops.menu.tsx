import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { requireOpsAccess, useAreaPermission } from "@/lib/permissions";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Search,
  ToggleLeft,
  ToggleRight,
  Image as ImageIcon,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantId, formatDZD } from "@/lib/restaurant";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { tx } from "@/lib/ops-tx";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { uploadImageWithFallback } from "@/lib/image-upload";
import { MenuImportDialog } from "@/components/menu-import-dialog";
import { uploadImageToGithub } from "@/lib/github-storage.functions";
import {
  defaultKitchen,
  loadKitchensSnapshot,
  type Kitchen,
} from "@/lib/kitchens";

export const Route = createFileRoute("/ops/menu")({
  beforeLoad: requireOpsAccess("menu"),
  component: OpsMenu,
});

type Category = {
  id: string;
  name: string;
  display_order: number;
  image_url: string | null;
  /** Kitchen that cooks this category; null routes it to the main kitchen. */
  kitchen_id?: string | null;
};

type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  /** Optional per-item kitchen override; wins over the category's kitchen. */
  kitchen_id?: string | null;
  image_url: string | null;
  is_available: boolean;
};

function buildMenuImagePath(
  restaurantId: string,
  folder: "categories" | "items",
  file: File,
) {
  const rawExt = file.name.split(".").pop()?.toLowerCase() || "png";
  const ext = rawExt.replace(/[^a-z0-9]/g, "") || "png";
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}`;
  return `${restaurantId}/${folder}/${id}.${ext}`;
}

function OpsMenu() {
  useTranslation();
  const ghUpload = useServerFn(uploadImageToGithub);
  const githubUploadFn = async (base64: string, path: string) => {
    try {
      const r = (await ghUpload({ data: { path, base64 } })) as {
        url?: string;
      };
      return r?.url ?? null;
    } catch {
      return null;
    }
  };
  const { restaurantId, loading: rLoading } = useRestaurantId();
  const { canWrite } = useAreaPermission("menu");
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [activeCat, setActiveCat] = useState<string>("all");

  const [catOpen, setCatOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catName, setCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const [catDelete, setCatDelete] = useState<Category | null>(null);
  const [catImage, setCatImage] = useState<File | null>(null);
  const [catImagePreview, setCatImagePreview] = useState<string | null>(null);
  /** Kitchens available as a routing target for this category. */
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  /** Real (persisted) kitchens — the synthetic default is not selectable. */
  const realKitchens = useMemo(
    () => kitchens.filter((k) => k.id !== "default"),
    [kitchens],
  );
  /** Empty string = the default kitchen. */
  const [catKitchen, setCatKitchen] = useState("");

  const [itemOpen, setItemOpen] = useState(false);
  const [itemEditing, setItemEditing] = useState<MenuItem | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCat, setItemCat] = useState("");
  /** Optional kitchen override for this one dish; "" follows the category. */
  const [itemKitchen, setItemKitchen] = useState("");
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemImage, setItemImage] = useState<File | null>(null);
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [itemDelete, setItemDelete] = useState<MenuItem | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const reload = async (rid: string) => {
    setLoading(true);
    const [catsRes, itsRes] = await Promise.all([
      supabase
        .from("categories")
        .select("id, name, display_order, image_url, kitchen_id")
        .eq("restaurant_id", rid),
      supabase
        .from("menu_items")
        .select(
          "id, name, description, price, category_id, kitchen_id, image_url, is_available",
        )
        .eq("restaurant_id", rid),
    ]);
    if (catsRes.error) toast.error("تعذّر تحميل الفئات");
    if (itsRes.error) toast.error("تعذّر تحميل الأصناف");
    const cats = catsRes.data ?? [];
    const its = itsRes.data ?? [];
    const sorted = [...cats].sort(
      (a, b) =>
        ((a as any).display_order ?? 0) - ((b as any).display_order ?? 0),
    );
    setCategories(sorted as Category[]);
    setItems(its as MenuItem[]);
    // Kitchens drive where a category's tickets get printed. A failure here is
    // not fatal: the category editor simply falls back to the main kitchen.
    loadKitchensSnapshot(rid)
      .then((kk) => setKitchens(kk.kitchens))
      .catch(() => setKitchens([defaultKitchen()]));
    setLoading(false);
  };

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    reload(restaurantId);
  }, [restaurantId]);

  useEffect(() => {
    if (!itemImage) return;
    const url = URL.createObjectURL(itemImage);
    setItemImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [itemImage]);

  useEffect(() => {
    if (!catImage) return;
    const url = URL.createObjectURL(catImage);
    setCatImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [catImage]);

  const filteredItems = useMemo(() => {
    let list = items;
    if (activeCat !== "all")
      list = list.filter((i) => i.category_id === activeCat);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.name.toLowerCase().includes(s) ||
          (i.description ?? "").toLowerCase().includes(s),
      );
    }
    return list;
  }, [items, activeCat, q]);

  const catMap = useMemo(() => {
    const m = new Map<string, Category>();
    for (const c of categories) m.set(c.id, c);
    return m;
  }, [categories]);

  const itemsByCat = useMemo(() => {
    const m = new Map<string, MenuItem[]>();
    for (const it of items) {
      const key = it.category_id ?? "_none";
      const arr = m.get(key) ?? [];
      arr.push(it);
      m.set(key, arr);
    }
    return m;
  }, [items]);

  /* ─── Category CRUD ─── */
  const openCatNew = () => {
    setCatEditing(null);
    setCatName("");
    setCatImage(null);
    setCatImagePreview(null);
    setCatKitchen("");
    setCatOpen(true);
  };
  const openCatEdit = (c: Category) => {
    setCatEditing(c);
    setCatName(c.name);
    setCatImage(null);
    setCatImagePreview(c.image_url);
    setCatKitchen(c.kitchen_id ?? "");
    setCatOpen(true);
  };
  const saveCat = async () => {
    if (!restaurantId) return;
    const name = catName.trim();
    if (!name) {
      toast.error("اسم الفئة مطلوب");
      return;
    }
    setCatSaving(true);
    try {
      let imageUrl: string | null = catEditing?.image_url ?? null;
      if (catImage) {
        const path = buildMenuImagePath(restaurantId, "categories", catImage);
        const up = await uploadImageWithFallback(
          "menu-images",
          path,
          catImage,
          githubUploadFn,
        );
        imageUrl = up.url;
        if (up.warning) toast.warning(up.warning);
      }
      if (catEditing) {
        const { error } = await supabase
          .from("categories")
          .update({ name, image_url: imageUrl, kitchen_id: catKitchen || null })
          .eq("id", catEditing.id);
        if (error) throw error;
        toast.success("تم تعديل الفئة");
      } else {
        const { error } = await supabase.from("categories").insert({
          restaurant_id: restaurantId,
          name,
          display_order: categories.length,
          image_url: imageUrl,
          kitchen_id: catKitchen || null,
        });
        if (error) throw error;
        toast.success("تمت إضافة الفئة");
      }
      setCatOpen(false);
      await reload(restaurantId);
    } catch (e) {
      toast.error((e as Error).message || "تعذّر حفظ الفئة");
    } finally {
      setCatSaving(false);
    }
  };
  const confirmDeleteCat = async () => {
    if (!catDelete || !restaurantId) return;
    try {
      const { error: itemsErr } = await supabase
        .from("menu_items")
        .delete()
        .eq("category_id", catDelete.id);
      if (itemsErr) throw itemsErr;
      const { error } = await supabase
        .from("categories")
        .delete()
        .eq("id", catDelete.id);
      if (error) throw error;
      toast.success("تم حذف الفئة وأصنافها");
      setCatDelete(null);
      await reload(restaurantId);
    } catch {
      toast.error("تعذّر حذف الفئة");
    }
  };

  /* ─── Item CRUD ─── */
  const resetItemForm = () => {
    setItemName("");
    setItemDesc("");
    setItemPrice("");
    setItemCat(categories[0]?.id ?? "");
    setItemKitchen("");
    setItemAvailable(true);
    setItemImage(null);
    setItemImagePreview(null);
  };
  const openItemNew = () => {
    if (categories.length === 0) {
      toast.error("أضف فئة واحدة على الأقل أولاً");
      return;
    }
    setItemEditing(null);
    resetItemForm();
    setItemCat(activeCat !== "all" ? activeCat : categories[0].id);
    setItemOpen(true);
  };
  const openItemEdit = (it: MenuItem) => {
    setItemEditing(it);
    setItemName(it.name);
    setItemDesc(it.description ?? "");
    setItemPrice(String(it.price));
    setItemCat(it.category_id ?? "");
    setItemKitchen(it.kitchen_id ?? "");
    setItemAvailable(it.is_available !== false);
    setItemImage(null);
    setItemImagePreview(it.image_url);
    setItemOpen(true);
  };
  const saveItem = async () => {
    if (!restaurantId) return;
    const name = itemName.trim();
    const price = parseFloat(itemPrice);
    if (!name) {
      toast.error("اسم الصنف مطلوب");
      return;
    }
    if (isNaN(price) || price < 0) {
      toast.error("السعر غير صحيح");
      return;
    }
    setItemSaving(true);
    try {
      let imageUrl: string | null = itemEditing?.image_url ?? null;
      if (itemImage) {
        const path = buildMenuImagePath(restaurantId, "items", itemImage);
        const up = await uploadImageWithFallback(
          "menu-images",
          path,
          itemImage,
          githubUploadFn,
        );
        imageUrl = up.url;
        if (up.warning) toast.warning(up.warning);
      }
      if (itemEditing) {
        const { error } = await supabase
          .from("menu_items")
          .update({
            name,
            description: itemDesc.trim() || null,
            price,
            category_id: itemCat || null,
            kitchen_id: itemKitchen || null,
            is_available: itemAvailable,
            image_url: imageUrl,
          })
          .eq("id", itemEditing.id);
        if (error) throw error;
        toast.success("تم تعديل الصنف");
      } else {
        const { error } = await supabase.from("menu_items").insert({
          restaurant_id: restaurantId,
          name,
          description: itemDesc.trim() || null,
          price,
          category_id: itemCat || null,
          kitchen_id: itemKitchen || null,
          is_available: itemAvailable,
          image_url: imageUrl,
        });
        if (error) throw error;
        toast.success("تمت إضافة الصنف");
      }
      setItemOpen(false);
      await reload(restaurantId);
    } catch (e) {
      toast.error((e as Error).message || "تعذّر حفظ الصنف");
    } finally {
      setItemSaving(false);
    }
  };
  const confirmDeleteItem = async () => {
    if (!itemDelete || !restaurantId) return;
    try {
      const { error } = await supabase
        .from("menu_items")
        .delete()
        .eq("id", itemDelete.id);
      if (error) throw error;
      toast.success("تم حذف الصنف");
      setItemDelete(null);
      await reload(restaurantId);
    } catch {
      toast.error("تعذّر حذف الصنف");
    }
  };
  const toggleItemAvailability = async (it: MenuItem) => {
    if (!restaurantId) return;
    const { error } = await supabase
      .from("menu_items")
      .update({ is_available: !it.is_available })
      .eq("id", it.id);
    if (error) {
      toast.error("تعذّر التحديث");
      return;
    }
    setItems((prev) =>
      prev.map((x) =>
        x.id === it.id ? { ...x, is_available: !it.is_available } : x,
      ),
    );
  };

  if (rLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--primary)]" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-[var(--foreground)]">
            {tx("المنيو والأصناف")}
          </h2>
          <p className="text-xs text-[var(--muted-foreground)]">
            {tx("إدارة التصنيفات والأصناف والأسعار")}
          </p>
        </div>
        {canWrite && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Sparkles className="w-4 h-4 ml-1" />
              {tx("استيراد من صورة")}
            </Button>
            <Button variant="outline" size="sm" onClick={openCatNew}>
              <Plus className="w-4 h-4 ml-1" />
              {tx("فئة")}
            </Button>
            <Button size="sm" onClick={openItemNew}>
              <Plus className="w-4 h-4 ml-1" />
              {tx("صنف")}
            </Button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--muted-foreground)]" />
        <Input
          dir="rtl"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tx("بحث في الأصناف…")}
          className="pr-9"
        />
      </div>

      {/* Category chips */}
      <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
        <button
          onClick={() => setActiveCat("all")}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
            activeCat === "all"
              ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
              : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:bg-[var(--muted)]"
          }`}
        >
          {tx("الكل")} ({items.length})
        </button>
        {categories.map((cat) => {
          const count = itemsByCat.get(cat.id)?.length ?? 0;
          return (
            <div key={cat.id} className="flex items-center shrink-0">
              <button
                onClick={() => setActiveCat(cat.id)}
                className={`rounded-full px-3 py-1 text-xs font-semibold border transition-colors ${
                  activeCat === cat.id
                    ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                    : "bg-[var(--card)] text-[var(--muted-foreground)] border-[var(--border)] hover:bg-[var(--muted)]"
                }`}
              >
                {cat.name} ({count})
              </button>
              {canWrite && (
                <div className="flex gap-0.5 mr-1">
                  <button
                    onClick={() => openCatEdit(cat)}
                    className="p-0.5 text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => setCatDelete(cat)}
                    className="p-0.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Items */}
      {filteredItems.length === 0 ? (
        <Card className="p-12 text-center text-[var(--muted-foreground)]">
          <p className="text-sm">
            {q.trim()
              ? "لا توجد نتائج مطابقة"
              : categories.length === 0
                ? "أضف فئة واحدة على الأقل ثم أضف أصنافاً"
                : "لا توجد أصناف بعد"}
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredItems.map((it) => (
            <Card
              key={it.id}
              className={`p-3 transition-opacity ${it.is_available === false ? "opacity-50" : ""}`}
            >
              <div className="flex gap-3">
                {it.image_url ? (
                  <img
                    src={it.image_url}
                    alt={it.name}
                    className="w-16 h-16 rounded-lg object-cover shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-[var(--muted)] flex items-center justify-center shrink-0">
                    <ImageIcon className="w-6 h-6 text-[var(--muted-foreground)]/50" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-[var(--foreground)] truncate">
                        {it.name}
                      </p>
                      {catMap.get(it.category_id ?? "") && (
                        <p className="text-[11px] text-[var(--primary)] font-medium">
                          {catMap.get(it.category_id ?? "")!.name}
                        </p>
                      )}
                    </div>
                    {canWrite && (
                      <button
                        onClick={() => toggleItemAvailability(it)}
                        className="shrink-0 mt-0.5"
                      >
                        {it.is_available !== false ? (
                          <ToggleRight className="w-5 h-5 text-[var(--primary)]" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-[var(--muted-foreground)]" />
                        )}
                      </button>
                    )}
                  </div>
                  {it.description && (
                    <p className="text-[11px] text-[var(--muted-foreground)] mt-0.5 line-clamp-1">
                      {it.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-sm font-bold text-[var(--foreground)]">
                      {formatDZD(it.price)}
                    </span>
                    {canWrite && (
                      <div className="flex gap-1">
                        <button
                          onClick={() => openItemEdit(it)}
                          className="p-1 text-[var(--muted-foreground)] hover:text-[var(--primary)]"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setItemDelete(it)}
                          className="p-1 text-[var(--muted-foreground)] hover:text-[var(--destructive)]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ─── Category dialog ─── */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent className="max-w-sm" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {catEditing ? tx("تعديل الفئة") : tx("إضافة فئة")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{tx("اسم الفئة")}</Label>
              <Input
                dir="rtl"
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder={tx("مثال: مشروبات، برجر…")}
              />
            </div>
            <div>
              <Label>{tx("المطبخ المسؤول")}</Label>
              <Select
                value={catKitchen || "__main__"}
                onValueChange={(v) => setCatKitchen(v === "__main__" ? "" : v)}
              >
                <SelectTrigger dir="rtl">
                  <SelectValue placeholder={tx("المطبخ الرئيسي")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__main__">
                    {tx("المطبخ الرئيسي (افتراضي)")}
                  </SelectItem>
                  {realKitchens.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                {tx(
                  "كل أصناف هذه الفئة تُحضّر في هذا المطبخ وتُطبع على طابعته. غيّرها من صفحة المطابخ.",
                )}
              </p>
              {realKitchens.length === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400 mt-1">
                  {tx("لا توجد مطابخ بعد — أنشئ مطبخاً من")}{" "}
                  <a
                    href="/account/settings/kitchens"
                    className="underline font-medium"
                  >
                    {tx("إعدادات المطابخ")}
                  </a>{" "}
                  {tx("لتظهر هنا في الخيارات.")}
                </p>
              )}
            </div>
            <div>
              <Label>{tx("صورة الفئة (اختياري)")}</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCatImage(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {catImagePreview && (
                <img
                  src={catImagePreview}
                  alt=""
                  className="mt-2 w-20 h-20 rounded-lg object-cover"
                />
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>
              {tx("إلغاء")}
            </Button>
            <Button onClick={saveCat} disabled={catSaving}>
              {catSaving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              {tx("حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Item dialog ─── */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent
          className="max-w-md max-h-[90vh] overflow-y-auto"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle>
              {itemEditing ? tx("تعديل الصنف") : tx("إضافة صنف")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>{tx("اسم الصنف")}</Label>
              <Input
                dir="rtl"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                placeholder={tx("مثال: همبرغر، بيبروني…")}
              />
            </div>
            <div>
              <Label>{tx("الوصف (اختياري)")}</Label>
              <Textarea
                dir="rtl"
                value={itemDesc}
                onChange={(e) => setItemDesc(e.target.value)}
                rows={2}
                placeholder={tx("وصف مختصر للصنف")}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{tx("السعر (دج)")}</Label>
                <Input
                  type="number"
                  min="0"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label>{tx("الفئة")}</Label>
                <Select value={itemCat} onValueChange={setItemCat}>
                  <SelectTrigger>
                    <SelectValue placeholder={tx("اختر فئة")} />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {/* A dish can legitimately go to another station than the rest of
                its category — one grilled item inside a "mains" category, for
                example. Empty means "follow the category". */}
            <div>
              <Label>{tx("مطبخ مختلف عن الفئة (اختياري)")}</Label>
              <Select
                value={itemKitchen || "__cat__"}
                onValueChange={(v) => setItemKitchen(v === "__cat__" ? "" : v)}
              >
                <SelectTrigger dir="rtl">
                  <SelectValue placeholder={tx("حسب الفئة")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__cat__">
                    {tx("حسب الفئة (الافتراضي)")}
                  </SelectItem>
                  {realKitchens.map((k) => (
                    <SelectItem key={k.id} value={k.id}>
                      {k.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{tx("صورة الصنف (اختياري)")}</Label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setItemImage(e.target.files?.[0] ?? null)}
                className="text-sm"
              />
              {itemImagePreview && (
                <img
                  src={itemImagePreview}
                  alt=""
                  className="mt-2 w-20 h-20 rounded-lg object-cover"
                />
              )}
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={itemAvailable}
                onCheckedChange={setItemAvailable}
              />
              <Label className="text-sm">{tx("متاح للطلب")}</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setItemOpen(false)}>
              {tx("إلغاء")}
            </Button>
            <Button onClick={saveItem} disabled={itemSaving}>
              {itemSaving && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              {tx("حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Delete confirmations ─── */}
      <MenuImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        restaurantId={restaurantId}
        existingCategories={categories}
        onImported={() => {
          if (restaurantId) void reload(restaurantId);
        }}
      />
      <ConfirmDialog
        open={!!catDelete}
        onOpenChange={() => setCatDelete(null)}
        title={tx("حذف الفئة")}
        description={`هل أنت متأكد من حذف "${catDelete?.name}" وجميع أصنافها؟ لا يمكن التراجع.`}
        onConfirm={confirmDeleteCat}
      />
      <ConfirmDialog
        open={!!itemDelete}
        onOpenChange={() => setItemDelete(null)}
        title={tx("حذف الصنف")}
        description={`هل أنت متأكد من حذف "${itemDelete?.name}"؟ لا يمكن التراجع.`}
        onConfirm={confirmDeleteItem}
      />
    </div>
  );
}
