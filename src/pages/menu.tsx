import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  UploadCloud,
  Sparkles,
  ImageIcon,
  X,
  UtensilsCrossed,
  ListChecks,
  Minus,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { parseMenuImage } from "@/lib/menu-import.functions";
import {
  saveMenuOptions,
  getMenuOptionsForItem,
} from "@/lib/menu-options.functions";
import { seedCashierMenu } from "@/lib/cashier.functions";
import { useRestaurantId, formatDZD } from "@/lib/restaurant";
import { uploadImageWithFallback } from "@/lib/image-upload";
import { uploadImageToGithub } from "@/lib/github-storage.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  defaultKitchen,
  loadKitchensSnapshot,
  type Kitchen,
} from "@/lib/kitchens";

type Category = {
  id: string;
  name: string;
  display_order: number;
  image_url: string | null;
  /** Kitchen that prepares this category; null = default kitchen. */
  kitchen_id?: string | null;
};
type MenuItem = {
  id: string;
  name: string;
  description: string | null;
  price: number;
  category_id: string | null;
  image_url: string | null;
  is_available: boolean;
};

type EditableChoice = { name: string; price_delta: number };
type EditableOption = {
  name: string;
  required: boolean;
  multi: boolean;
  choices: EditableChoice[];
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

export default function MenuPage() {
  const { restaurantId, loading: rLoading } = useRestaurantId();
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
  const [categories, setCategories] = useState<Category[]>([]);
  /** Kitchens used to route a category to a station (and its printer). */
  const [kitchens, setKitchens] = useState<Kitchen[]>([]);
  /** Empty = default kitchen. */
  const [catKitchen, setCatKitchen] = useState<string>("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);

  // category modal
  const [catOpen, setCatOpen] = useState(false);
  const [catEditing, setCatEditing] = useState<Category | null>(null);
  const [catName, setCatName] = useState("");
  const [catSaving, setCatSaving] = useState(false);
  const [catDelete, setCatDelete] = useState<Category | null>(null);
  const [catImage, setCatImage] = useState<File | null>(null);
  const [catImagePreview, setCatImagePreview] = useState<string | null>(null);

  // item modal
  const [itemOpen, setItemOpen] = useState(false);
  const [itemEditing, setItemEditing] = useState<MenuItem | null>(null);
  const [itemName, setItemName] = useState("");
  const [itemDesc, setItemDesc] = useState("");
  const [itemPrice, setItemPrice] = useState("");
  const [itemCat, setItemCat] = useState<string>("");
  const [itemAvailable, setItemAvailable] = useState(true);
  const [itemImage, setItemImage] = useState<File | null>(null);
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null);
  const [itemSaving, setItemSaving] = useState(false);
  const [itemDelete, setItemDelete] = useState<MenuItem | null>(null);

  // options manager
  const [optionsFor, setOptionsFor] = useState<MenuItem | null>(null);
  const [optionsList, setOptionsList] = useState<EditableOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsSaving, setOptionsSaving] = useState(false);

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
          "id, name, description, price, category_id, image_url, is_available, created_at",
        )
        .eq("restaurant_id", rid),
    ]);
    if (catsRes.error) toast.error("تعذّر تحميل الفئات");
    if (itsRes.error) toast.error("تعذّر تحميل الأصناف");
    // Kitchens are optional routing metadata: a restaurant with none still
    // routes everything to the default kitchen, so a failure is not fatal.
    loadKitchensSnapshot(rid)
      .then((kk) => setKitchens(kk.kitchens))
      .catch(() => setKitchens([defaultKitchen()]));
    if (catsRes.data) {
      const sortedCats = (catsRes.data as Category[]).sort(
        (a, b) => (a.display_order ?? 0) - (b.display_order ?? 0),
      );
      setCategories(sortedCats);
    }
    if (itsRes.data) {
      const sortedItems = (itsRes.data as MenuItem[]).sort((a: any, b: any) => {
        const tA = a.created_at ? new Date(a.created_at).getTime() : 0;
        const tB = b.created_at ? new Date(b.created_at).getTime() : 0;
        if (tA && tB) return tA - tB;
        return (a.name || "").localeCompare(b.name || "", "ar");
      });
      setItems(sortedItems);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    reload(restaurantId);
  }, [restaurantId]);

  // image preview
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

  /* ---------------- Category handlers ---------------- */
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
          .update({ name, image_url: imageUrl, kitchen_id: catKitchen })
          .eq("id", catEditing.id);
        if (error) throw error;
        toast.success("تم تعديل الفئة");
      } else {
        const { error } = await supabase.from("categories").insert({
          restaurant_id: restaurantId,
          name,
          display_order: categories.length,
          image_url: imageUrl,
          kitchen_id: catKitchen,
        });
        if (error) throw error;
        toast.success("تمت إضافة الفئة");
      }
      setCatOpen(false);
      await reload(restaurantId);
    } catch (e) {
      console.error("[saveCat] error", e);
      const msg = e instanceof Error ? e.message : "تعذّر حفظ الفئة";
      toast.error(`تعذّر حفظ الفئة: ${msg}`);
    } finally {
      setCatSaving(false);
    }
  };
  const confirmDeleteCat = async () => {
    if (!catDelete || !restaurantId) return;
    try {
      // Delete all items belonging to this category first (DB has no CASCADE on category_id)
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

  /* ---------------- Item handlers ---------------- */
  const resetItemForm = () => {
    setItemName("");
    setItemDesc("");
    setItemPrice("");
    setItemCat(categories[0]?.id ?? "");
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
    setItemCat(categories[0].id);
    setItemOpen(true);
  };
  const openItemEdit = (it: MenuItem) => {
    setItemEditing(it);
    setItemName(it.name);
    setItemDesc(it.description ?? "");
    setItemPrice(String(it.price));
    setItemCat(it.category_id ?? categories[0]?.id ?? "");
    setItemAvailable(it.is_available);
    setItemImage(null);
    setItemImagePreview(it.image_url);
    setItemOpen(true);
  };
  const saveItem = async () => {
    if (!restaurantId) return;
    const name = itemName.trim();
    const price = Number(itemPrice);
    if (!name) return toast.error("اسم الصنف مطلوب");
    if (!itemCat) return toast.error("اختر الفئة");
    if (!isFinite(price) || price <= 0)
      return toast.error("السعر يجب أن يكون أكبر من 0");

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

      const payload = {
        restaurant_id: restaurantId,
        name,
        description: itemDesc.trim() || null,
        price,
        category_id: itemCat,
        image_url: imageUrl,
        is_available: itemAvailable,
      };

      if (itemEditing) {
        const { error } = await supabase
          .from("menu_items")
          .update(payload)
          .eq("id", itemEditing.id);
        if (error) throw error;
        toast.success("تم تعديل الصنف");
      } else {
        const { error } = await supabase.from("menu_items").insert(payload);
        if (error) throw error;
        toast.success("تمت إضافة الصنف");
      }

      setItemOpen(false);
      await reload(restaurantId);
    } catch (e) {
      console.error("[saveItem] error", e);
      const msg = e instanceof Error ? e.message : "تعذّر حفظ الصنف";
      toast.error(`تعذّر حفظ الصنف: ${msg}`);
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

  /* ---------------- Options manager ---------------- */
  const openOptions = async (it: MenuItem) => {
    if (!restaurantId) return;
    setOptionsFor(it);
    setOptionsLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("الجلسة منتهية");
      const res = await getMenuOptionsForItem({
        data: { menuItemId: it.id },
        headers: { Authorization: `Bearer ${token}` },
      });
      setOptionsList(
        res.options.map((o) => ({
          name: o.name,
          required: o.required,
          multi: o.multi,
          choices: o.choices.map((c) => ({
            name: c.name,
            price_delta: c.price_delta,
          })),
        })),
      );
    } catch (e) {
      toast.error(`تعذّر تحميل الخيارات: ${(e as Error).message}`);
      setOptionsList([]);
    } finally {
      setOptionsLoading(false);
    }
  };

  const addOptionGroup = () => {
    setOptionsList((prev) => [
      ...prev,
      {
        name: "",
        required: false,
        multi: false,
        choices: [{ name: "", price_delta: 0 }],
      },
    ]);
  };
  const updateOptionGroup = (idx: number, patch: Partial<EditableOption>) => {
    setOptionsList((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
    );
  };
  const removeOptionGroup = (idx: number) => {
    setOptionsList((prev) => prev.filter((_, i) => i !== idx));
  };
  const addChoice = (optIdx: number) => {
    setOptionsList((prev) =>
      prev.map((o, i) =>
        i === optIdx
          ? { ...o, choices: [...o.choices, { name: "", price_delta: 0 }] }
          : o,
      ),
    );
  };
  const updateChoice = (
    optIdx: number,
    chIdx: number,
    patch: Partial<EditableChoice>,
  ) => {
    setOptionsList((prev) =>
      prev.map((o, i) =>
        i === optIdx
          ? {
              ...o,
              choices: o.choices.map((c, j) =>
                j === chIdx ? { ...c, ...patch } : c,
              ),
            }
          : o,
      ),
    );
  };
  const removeChoice = (optIdx: number, chIdx: number) => {
    setOptionsList((prev) =>
      prev.map((o, i) =>
        i === optIdx
          ? { ...o, choices: o.choices.filter((_, j) => j !== chIdx) }
          : o,
      ),
    );
  };
  const saveOptions = async () => {
    if (!restaurantId || !optionsFor) return;
    setOptionsSaving(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("الجلسة منتهية، سجّل دخولك من جديد");
      await saveMenuOptions({
        data: { menuItemId: optionsFor.id, options: optionsList },
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success("تم حفظ الخيارات");
      setOptionsFor(null);
    } catch (e) {
      toast.error(`تعذّر حفظ الخيارات: ${(e as Error).message}`);
    } finally {
      setOptionsSaving(false);
    }
  };

  const seedFn = useServerFn(seedCashierMenu);
  const [seeding, setSeeding] = useState(false);
  const onSeedDemo = async () => {
    if (!restaurantId) return;
    setSeeding(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error("الجلسة منتهية، سجّل دخولك من جديد");
      const res = await seedFn({
        headers: { Authorization: `Bearer ${token}` },
      });
      toast.success(
        `تمت إضافة ${res.insertedItems} صنف و ${res.insertedCategories} فئة`,
      );
      reload(restaurantId);
    } catch (e) {
      toast.error(`تعذّرت التعبئة: ${(e as Error).message}`);
    } finally {
      setSeeding(false);
    }
  };

  /* ---------------- Render ---------------- */
  if (rLoading || loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="bg-card border border-border rounded-xl p-5 md:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-lg bg-secondary text-primary flex items-center justify-center shrink-0">
            <UtensilsCrossed className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight">
              إدارة القائمة
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
              {categories.length} فئة · {items.length} صنف
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImportFromPhotoButton
            restaurantId={restaurantId}
            onImported={() => restaurantId && reload(restaurantId)}
          />
          <Button
            variant="outline"
            onClick={onSeedDemo}
            disabled={seeding}
            className="rounded-lg"
          >
            {seeding ? (
              <Loader2 className="w-4 h-4 ml-1 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4 ml-1" />
            )}
            تعبئة منيو تجريبي
          </Button>
          <Button variant="outline" onClick={openCatNew} className="rounded-lg">
            <Plus className="w-4 h-4 ml-1" />
            إضافة فئة
          </Button>
          <Button
            data-annotate="menu-add"
            onClick={openItemNew}
            className="rounded-lg"
          >
            <Plus className="w-4 h-4 ml-1" />
            إضافة صنف
          </Button>
        </div>
      </div>

      {categories.length === 0 ? (
        <div className="bg-card border-2 border-dashed border-border rounded-xl p-12 text-center">
          <div className="w-12 h-12 mx-auto rounded-lg bg-secondary flex items-center justify-center mb-3 text-muted-foreground">
            <UtensilsCrossed className="w-6 h-6" />
          </div>
          <p className="text-base font-semibold text-foreground">
            ابدأ بإضافة فئة جديدة
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            نظّم أصنافك ضمن فئات لتظهر بشكل احترافي للزبائن
          </p>
          <Button onClick={openCatNew} className="mt-4 rounded-lg">
            <Plus className="w-4 h-4 ml-1" />
            إضافة فئة
          </Button>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => {
            const catItems = items.filter((i) => i.category_id === cat.id);
            return (
              <section
                key={cat.id}
                className="bg-card border border-border rounded-xl p-5 md:p-6"
              >
                <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-border">
                  <div className="flex items-center gap-3 min-w-0">
                    {cat.image_url ? (
                      <img
                        src={cat.image_url}
                        alt={cat.name}
                        className="w-10 h-10 rounded-lg object-cover ring-1 ring-border shrink-0"
                      />
                    ) : (
                      <div className="w-1 h-6 rounded-full bg-primary" />
                    )}
                    <h2 className="text-lg md:text-xl font-bold text-foreground tracking-tight truncate">
                      {cat.name}
                    </h2>
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      {catItems.length}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openCatEdit(cat)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
                      aria-label="تعديل الفئة"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setCatDelete(cat)}
                      className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                      aria-label="حذف الفئة"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {catItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    لا توجد أصناف بعد
                  </p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {catItems.map((it) => (
                      <ItemCard
                        key={it.id}
                        item={it}
                        onEdit={() => openItemEdit(it)}
                        onDelete={() => setItemDelete(it)}
                        onOptions={() => openOptions(it)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Category Dialog */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {catEditing ? "تعديل الفئة" : "إضافة فئة"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="cat-name">اسم الفئة</Label>
            <Input
              id="cat-name"
              value={catName}
              onChange={(e) => setCatName(e.target.value)}
              maxLength={60}
              placeholder="مثلاً: المقبلات"
            />
          </div>
          <div className="space-y-2">
            <Label>المطبخ المسؤول</Label>
            <Select value={catKitchen || "default"} onValueChange={setCatKitchen}>
              <SelectTrigger>
                <SelectValue placeholder="المطبخ الرئيسي" />
              </SelectTrigger>
              <SelectContent>
                {kitchens.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              كل أصناف هذه الفئة تذهب لهذا المطبخ وتُطبع على طابعته.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="cat-image">صورة الفئة (اختياري)</Label>
            <label
              htmlFor="cat-image"
              className="flex items-center gap-3 border border-dashed border-input rounded-xl p-3 cursor-pointer hover:bg-muted/40"
            >
              {catImagePreview ? (
                <img
                  src={catImagePreview}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                  <UploadCloud className="w-6 h-6 text-muted-foreground" />
                </div>
              )}
              <span className="text-sm text-muted-foreground">
                {catImage?.name ?? "اختر صورة"}
              </span>
              <input
                id="cat-image"
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setCatImage(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCatOpen(false)}
              disabled={catSaving}
            >
              إلغاء
            </Button>
            <Button onClick={saveCat} disabled={catSaving}>
              {catSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Item Dialog */}
      <Dialog open={itemOpen} onOpenChange={setItemOpen}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {itemEditing ? "تعديل الصنف" : "إضافة صنف"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="item-name">اسم الصنف</Label>
              <Input
                id="item-name"
                value={itemName}
                onChange={(e) => setItemName(e.target.value)}
                maxLength={100}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-desc">الوصف</Label>
              <Textarea
                id="item-desc"
                value={itemDesc}
                onChange={(e) => setItemDesc(e.target.value)}
                maxLength={300}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-price">السعر</Label>
              <div className="relative">
                <Input
                  id="item-price"
                  type="number"
                  min={0}
                  step="0.01"
                  value={itemPrice}
                  onChange={(e) => setItemPrice(e.target.value)}
                  className="pl-12"
                />
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  دج
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label>الفئة</Label>
              <Select value={itemCat} onValueChange={setItemCat}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر فئة" />
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
            <div className="space-y-2">
              <Label htmlFor="item-image">صورة الصنف (اختياري)</Label>
              <label
                htmlFor="item-image"
                className="flex items-center gap-3 border border-dashed border-input rounded-xl p-3 cursor-pointer hover:bg-muted/40"
              >
                {itemImagePreview ? (
                  <img
                    src={itemImagePreview}
                    alt=""
                    className="w-16 h-16 rounded-lg object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-muted flex items-center justify-center">
                    <UploadCloud className="w-6 h-6 text-muted-foreground" />
                  </div>
                )}
                <span className="text-sm text-muted-foreground">
                  {itemImage?.name ?? "اختر صورة"}
                </span>
                <input
                  id="item-image"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setItemImage(e.target.files?.[0] ?? null)}
                />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-xl border p-3">
              <Label htmlFor="item-available" className="cursor-pointer">
                متاح للطلب
              </Label>
              <Switch
                id="item-available"
                checked={itemAvailable}
                onCheckedChange={setItemAvailable}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setItemOpen(false)}
              disabled={itemSaving}
            >
              إلغاء
            </Button>
            <Button onClick={saveItem} disabled={itemSaving}>
              {itemSaving && <Loader2 className="w-4 h-4 ml-2 animate-spin" />}
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Category Confirm */}
      <AlertDialog
        open={!!catDelete}
        onOpenChange={(o) => !o && setCatDelete(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الفئة؟</AlertDialogTitle>
            <AlertDialogDescription>
              سيتم حذف الفئة وجميع الأصناف التابعة لها نهائياً. هذا الإجراء لا
              يمكن التراجع عنه.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteCat}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Item Confirm */}
      <AlertDialog
        open={!!itemDelete}
        onOpenChange={(o) => !o && setItemDelete(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف الصنف؟</AlertDialogTitle>
            <AlertDialogDescription>
              لا يمكن التراجع عن هذه العملية.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeleteItem}>
              حذف
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Options manager Dialog */}
      <Dialog
        open={!!optionsFor}
        onOpenChange={(o) => !o && setOptionsFor(null)}
      >
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>الخيارات — {optionsFor?.name ?? ""}</DialogTitle>
          </DialogHeader>
          {optionsLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                حدّد مجموعات الخيارات لهذا الصنف (مثل: المقاس، الإضافات). كل
                مجموعة تحتوي اختيارات يمكن إضافة سعر لها.
              </p>
              {optionsList.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  لا توجد خيارات بعد.
                </p>
              )}
              {optionsList.map((opt, oi) => (
                <div
                  key={oi}
                  className="border border-border rounded-xl p-3 space-y-3 bg-muted/20"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={opt.name}
                      onChange={(e) =>
                        updateOptionGroup(oi, { name: e.target.value })
                      }
                      placeholder={`اسم المجموعة ${oi + 1} (مثل: المقاس)`}
                      className="flex-1"
                      maxLength={60}
                    />
                    <button
                      onClick={() => removeOptionGroup(oi)}
                      className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                      aria-label="حذف المجموعة"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex items-center gap-4 px-1">
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                      <Switch
                        checked={opt.required}
                        onCheckedChange={(v) =>
                          updateOptionGroup(oi, { required: !!v })
                        }
                      />
                      إجباري
                    </label>
                    <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                      <Switch
                        checked={opt.multi}
                        onCheckedChange={(v) =>
                          updateOptionGroup(oi, { multi: !!v })
                        }
                      />
                      اختيار متعدد
                    </label>
                  </div>
                  <div className="space-y-2">
                    {opt.choices.map((ch, ci) => (
                      <div key={ci} className="flex items-center gap-2">
                        <Input
                          value={ch.name}
                          onChange={(e) =>
                            updateChoice(oi, ci, { name: e.target.value })
                          }
                          placeholder={`الاختيار ${ci + 1}`}
                          className="flex-1"
                          maxLength={60}
                        />
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={
                            ch.price_delta === 0 ? "" : String(ch.price_delta)
                          }
                          onChange={(e) =>
                            updateChoice(oi, ci, {
                              price_delta: Number(e.target.value) || 0,
                            })
                          }
                          placeholder="+دج"
                          className="w-24 text-left"
                        />
                        <button
                          onClick={() => removeChoice(oi, ci)}
                          className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
                          aria-label="حذف الاختيار"
                        >
                          <Minus className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => addChoice(oi)}
                      className="flex items-center gap-1 text-sm text-primary hover:underline"
                    >
                      <Plus className="w-4 h-4" /> إضافة اختيار
                    </button>
                  </div>
                </div>
              ))}
              <button
                onClick={addOptionGroup}
                className="w-full flex items-center justify-center gap-1 rounded-xl border border-dashed border-input py-2.5 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground transition"
              >
                <Plus className="w-4 h-4" /> إضافة مجموعة خيارات
              </button>
            </div>
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setOptionsFor(null)}>
              إلغاء
            </Button>
            <Button
              onClick={saveOptions}
              disabled={optionsLoading || optionsSaving}
            >
              {optionsSaving && <Loader2 className="w-4 h-4 animate-spin" />}
              حفظ الخيارات
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ItemCard({
  item,
  onEdit,
  onDelete,
  onOptions,
}: {
  item: MenuItem;
  onEdit: () => void;
  onDelete: () => void;
  onOptions: () => void;
}) {
  return (
    <div
      data-annotate="menu-card"
      className="group relative rounded-xl bg-card border border-border overflow-hidden flex flex-col transition-colors hover:border-primary/40"
    >
      <div className="relative overflow-hidden">
        {item.image_url ? (
          <img
            src={item.image_url}
            alt={item.name}
            className="w-full h-[160px] object-cover"
          />
        ) : (
          <div className="w-full h-[160px] bg-secondary flex items-center justify-center text-muted-foreground">
            <ImageIcon className="w-8 h-8 opacity-40" />
          </div>
        )}
        {!item.is_available && (
          <span className="absolute top-2.5 right-2.5 text-[10px] font-semibold bg-card border border-destructive/20 text-destructive rounded-md px-2 py-0.5">
            غير متاح
          </span>
        )}
      </div>
      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-bold text-foreground tracking-tight line-clamp-1">
          {item.name}
        </h3>
        {item.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
            {item.description}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between pt-3 border-t border-border/60">
          <span className="font-bold text-base text-foreground">
            {formatDZD(item.price)}
          </span>
          <div
            data-annotate="menu-controls"
            className="flex gap-1 opacity-70 group-hover:opacity-100 transition-opacity"
          >
            <button
              onClick={onEdit}
              className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition"
              aria-label="تعديل"
            >
              <Pencil className="w-4 h-4" />
            </button>
            <button
              onClick={onOptions}
              className="p-2 rounded-lg hover:bg-primary/10 text-muted-foreground hover:text-primary transition"
              aria-label="الخيارات"
            >
              <ListChecks className="w-4 h-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition"
              aria-label="حذف"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Import from photo ---------------- */
type DraftItem = {
  name: string;
  description: string;
  price: number;
  included: boolean;
};
type DraftCat = { name: string; included: boolean; items: DraftItem[] };

function ImportFromPhotoButton({
  restaurantId,
  onImported,
}: {
  restaurantId: string | null;
  onImported: () => void;
}) {
  const parseFn = useServerFn(parseMenuImage);
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [drafts, setDrafts] = useState<DraftCat[] | null>(null);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  function reset() {
    setFile(null);
    setPreview(null);
    setDrafts(null);
    setParsing(false);
    setImporting(false);
  }

  async function fileToBase64(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(f);
    });
  }

  async function onParse() {
    if (!file) return;
    setParsing(true);
    try {
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();
      if (sessionError || !sessionData.session?.access_token) {
        throw new Error("الجلسة منتهية، سجّل دخولك من جديد");
      }
      const b64 = await fileToBase64(file);
      const res = await parseFn({
        data: { imageBase64: b64 },
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });
      if (res instanceof Response) {
        throw new Error((await res.text()) || "فشل تحليل الصورة");
      }
      setDrafts(
        res.categories.map((c) => ({
          name: c.name,
          included: true,
          items: c.items.map((it) => ({
            name: it.name,
            description: it.description ?? "",
            price: it.price,
            included: true,
          })),
        })),
      );
    } catch (e) {
      toast.error((e as Error).message || "فشل تحليل الصورة");
    } finally {
      setParsing(false);
    }
  }

  async function onImport() {
    if (!drafts || !restaurantId) return;
    setImporting(true);
    try {
      // Load existing categories to dedupe by name
      const { data: existingCats } = await supabase
        .from("categories")
        .select("id, name, display_order")
        .eq("restaurant_id", restaurantId);
      const byName = new Map<string, string>();
      let maxOrder = 0;
      (existingCats ?? []).forEach((c: any) => {
        byName.set(c.name.trim().toLowerCase(), c.id);
        if (c.display_order > maxOrder) maxOrder = c.display_order;
      });

      let createdCats = 0;
      let createdItems = 0;

      for (const cat of drafts) {
        if (!cat.included) continue;
        const includedItems = cat.items.filter(
          (i) => i.included && i.name && i.price > 0,
        );
        if (!includedItems.length) continue;
        const key = cat.name.trim().toLowerCase();
        let catId = byName.get(key);
        if (!catId) {
          maxOrder += 1;
          const { data: ins, error } = await supabase
            .from("categories")
            .insert({
              restaurant_id: restaurantId,
              name: cat.name.trim(),
              display_order: maxOrder,
            })
            .select("id")
            .single();
          if (error || !ins) throw new Error(error?.message || "فشل إنشاء فئة");
          catId = ins.id as string;
          byName.set(key, catId);
          createdCats += 1;
        }
        const rows = includedItems.map((it) => ({
          restaurant_id: restaurantId,
          name: it.name,
          description: it.description || null,
          price: it.price,
          category_id: catId!,
          image_url: null as string | null,
          is_available: true,
        }));
        const { error: insErr } = await supabase
          .from("menu_items")
          .insert(rows);
        if (insErr) throw new Error(insErr.message);
        createdItems += rows.length;
      }

      toast.success(
        `تم استيراد ${createdItems} صنف في ${createdCats || "0"} فئة جديدة`,
      );
      onImported();
      setOpen(false);
      reset();
    } catch (e) {
      toast.error((e as Error).message || "فشل الاستيراد");
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} className="gap-1">
        <Sparkles className="w-4 h-4" />
        استيراد من صورة (AI)
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent
          dir="rtl"
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              استيراد المنيو من صورة
            </DialogTitle>
          </DialogHeader>

          {!drafts ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                ارفع صورة المنيو وسنستخرج الأصناف والأسعار والفئات تلقائياً.
                ستراجع النتائج قبل الإضافة.
              </p>
              <label
                htmlFor="ai-menu-image"
                className="flex flex-col items-center justify-center gap-3 border-2 border-dashed border-input rounded-2xl p-6 cursor-pointer hover:bg-muted/40"
              >
                {preview ? (
                  <img
                    src={preview}
                    alt=""
                    className="max-h-72 rounded-xl object-contain"
                  />
                ) : (
                  <>
                    <ImageIcon className="w-10 h-10 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      انقر لاختيار صورة المنيو
                    </span>
                  </>
                )}
                <input
                  id="ai-menu-image"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setOpen(false)}
                  disabled={parsing}
                >
                  إلغاء
                </Button>
                <Button onClick={onParse} disabled={!file || parsing}>
                  {parsing && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                  {parsing ? "جاري التحليل..." : "تحليل بالذكاء الاصطناعي"}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                راجع وعدّل قبل الاستيراد. أزل ما لا تريده.
              </p>
              <div className="space-y-4">
                {drafts.map((cat, ci) => (
                  <div
                    key={ci}
                    className="rounded-xl border p-3 bg-muted/20 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={cat.included}
                        onCheckedChange={(v) =>
                          setDrafts(
                            (prev) =>
                              prev?.map((c, i) =>
                                i === ci ? { ...c, included: v } : c,
                              ) ?? null,
                          )
                        }
                      />
                      <Input
                        value={cat.name}
                        onChange={(e) =>
                          setDrafts(
                            (prev) =>
                              prev?.map((c, i) =>
                                i === ci ? { ...c, name: e.target.value } : c,
                              ) ?? null,
                          )
                        }
                        className="font-bold"
                      />
                    </div>
                    {cat.included && (
                      <div className="space-y-2">
                        {cat.items.map((it, ii) => (
                          <div
                            key={ii}
                            className="grid grid-cols-[auto_1fr_110px_auto] items-center gap-2 bg-background rounded-lg p-2"
                          >
                            <Switch
                              checked={it.included}
                              onCheckedChange={(v) =>
                                setDrafts(
                                  (prev) =>
                                    prev?.map((c, i) =>
                                      i === ci
                                        ? {
                                            ...c,
                                            items: c.items.map((x, j) =>
                                              j === ii
                                                ? { ...x, included: v }
                                                : x,
                                            ),
                                          }
                                        : c,
                                    ) ?? null,
                                )
                              }
                            />
                            <Input
                              value={it.name}
                              onChange={(e) =>
                                setDrafts(
                                  (prev) =>
                                    prev?.map((c, i) =>
                                      i === ci
                                        ? {
                                            ...c,
                                            items: c.items.map((x, j) =>
                                              j === ii
                                                ? { ...x, name: e.target.value }
                                                : x,
                                            ),
                                          }
                                        : c,
                                    ) ?? null,
                                )
                              }
                              placeholder="اسم"
                            />
                            <Input
                              type="number"
                              value={it.price}
                              onChange={(e) =>
                                setDrafts(
                                  (prev) =>
                                    prev?.map((c, i) =>
                                      i === ci
                                        ? {
                                            ...c,
                                            items: c.items.map((x, j) =>
                                              j === ii
                                                ? {
                                                    ...x,
                                                    price:
                                                      Number(e.target.value) ||
                                                      0,
                                                  }
                                                : x,
                                            ),
                                          }
                                        : c,
                                    ) ?? null,
                                )
                              }
                            />
                            <button
                              onClick={() =>
                                setDrafts(
                                  (prev) =>
                                    prev?.map((c, i) =>
                                      i === ci
                                        ? {
                                            ...c,
                                            items: c.items.filter(
                                              (_, j) => j !== ii,
                                            ),
                                          }
                                        : c,
                                    ) ?? null,
                                )
                              }
                              className="p-1 text-muted-foreground hover:text-destructive"
                              aria-label="remove"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                ملاحظة: الصور للأصناف لا تُستخرج من المنيو — تقدر تضيفها يدوياً
                بعد الاستيراد.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDrafts(null)}
                  disabled={importing}
                >
                  رجوع
                </Button>
                <Button onClick={onImport} disabled={importing}>
                  {importing && (
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                  )}
                  استيراد
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
