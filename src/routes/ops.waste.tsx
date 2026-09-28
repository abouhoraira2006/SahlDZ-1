import { useEffect, useState, useMemo } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { requireOpsAccess } from "@/lib/permissions";
import { Trash2, Loader2, Filter, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useRestaurantId, formatDZD } from "@/lib/restaurant";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { tx } from "@/lib/ops-tx";


export const Route = createFileRoute("/ops/waste")({
  beforeLoad: requireOpsAccess("waste"),
  component: OpsWaste,
});

type WasteRow = {
  id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  reason: string;
  reason_other: string | null;
  cost: number;
  logged_by: string | null;
  created_at: string;
};

const WASTE_REASONS: Record<string, string> = {
  burned: tx("محروق"),
  expired: tx("منتهي الصلاحية"),
  dropped: tx("سقط/تلف"),
  prep_error: tx("خطأ في التحضير"),
  other: tx("أخرى"),
};

const REASON_COLORS: Record<string, string> = {
  burned: "bg-destructive/10 text-destructive border border-destructive/20",
  expired: "bg-warning/10 text-warning border border-warning/20",
  dropped: "bg-warning/10 text-warning border border-warning/20",
  prep_error: "bg-[#3D6F9E]/10 text-[#3D6F9E] border border-[#3D6F9E]/20",
  other: "bg-secondary text-secondary-foreground border border-border",
};

function startOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function OpsWaste() {
  const { restaurantId } = useRestaurantId();


  const [wasteRows, setWasteRows] = useState<WasteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState(startOfWeek());
  const [to, setTo] = useState(today());
  const [reasonFilter, setReasonFilter] = useState("all");

  useEffect(() => {
    if (restaurantId === undefined) return;
    if (!restaurantId) {
      setLoading(false);
      return;
    }
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data: logs } = await supabase
        .from("waste_logs")
        .select("*")
        .eq("restaurant_id", restaurantId)
        .gte("created_at", from)
        .lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      if (cancel) return;

      const ingIds = [...new Set((logs ?? []).map((l: any) => l.ingredient_id).filter(Boolean))];
      const ingMap = new Map<string, { name: string; unit: string }>();
      if (ingIds.length) {
        const { data: ings } = await supabase.from("ingredients").select("id,name,unit").in("id", ingIds);
        for (const i of ings ?? []) ingMap.set((i as any).id, { name: (i as any).name, unit: (i as any).unit });
      }

      setWasteRows(
        (logs ?? []).map((l: any) => {
          const ing = ingMap.get(l.ingredient_id);
          return {
            id: l.id,
            ingredient_name: ing?.name ?? "—",
            quantity: Number(l.quantity ?? 0),
            unit: ing?.unit ?? "",
            reason: l.reason ?? "other",
            reason_other: l.reason_other ?? null,
            cost: Number(l.cost ?? 0),
            logged_by: l.logged_by ?? null,
            created_at: l.created_at ?? "",
          };
        })
      );
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [restaurantId, from, to]);

  const filtered = useMemo(() => {
    if (reasonFilter === "all") return wasteRows;
    return wasteRows.filter((r) => r.reason === reasonFilter);
  }, [wasteRows, reasonFilter]);

  const totalCost = useMemo(() => wasteRows.reduce((s, r) => s + r.cost, 0), [wasteRows]);

  const reasonBreakdown = useMemo(() => {
    const map = new Map<string, { count: number; cost: number }>();
    for (const r of wasteRows) {
      const prev = map.get(r.reason) ?? { count: 0, cost: 0 };
      prev.count++;
      prev.cost += r.cost;
      map.set(r.reason, prev);
    }
    return map;
  }, [wasteRows]);

  return (
    <div className="p-2 space-y-4" dir="rtl">
      <div className="flex items-center gap-2">
        <Trash2 className="w-5 h-5 text-[var(--primary)]" />
        <h1 className="text-lg font-bold">{tx("سجل الهدر")}</h1>
      </div>

      {/* KPI */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <Card className="p-3 col-span-2 md:col-span-1">
          <div className="flex items-center gap-2 text-[var(--muted-foreground)] text-xs mb-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            {tx("إجمالي الهدر")}
          </div>
          <div className="text-lg font-bold text-red-600">{formatDZD(totalCost)}</div>
        </Card>
        {[...reasonBreakdown.entries()].slice(0, 3).map(([reason, data]) => (
          <Card key={reason} className="p-3">
            <div className="flex items-center gap-2 text-[var(--muted-foreground)] text-xs mb-1">
              <Badge variant="secondary" className={`text-[10px] ${REASON_COLORS[reason] ?? ""}`}>
                {WASTE_REASONS[reason] ?? reason}
              </Badge>
            </div>
            <div className="text-sm font-bold">{data.count} {tx("مرات")}</div>
            <div className="text-xs text-[var(--muted-foreground)]">{formatDZD(data.cost)}</div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Filter className="w-4 h-4 text-[var(--muted-foreground)]" />
            <span className="text-xs font-medium">{tx("من")}</span>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-32 text-xs" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{tx("إلى")}</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-32 text-xs" />
          </div>
          <Select value={reasonFilter} onValueChange={setReasonFilter}>
            <SelectTrigger className="h-8 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{tx("كل الأسباب")}</SelectItem>
              {Object.entries(WASTE_REASONS).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table */}
      <Card>
        {loading ? (
          <div className="p-8 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--muted-foreground)]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--muted-foreground)]">
            {tx("لا توجد سجلات هدر")}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">{tx("التاريخ")}</TableHead>
                  <TableHead className="text-xs">{tx("المادة")}</TableHead>
                  <TableHead className="text-xs">{tx("الكمية")}</TableHead>
                  <TableHead className="text-xs">{tx("السبب")}</TableHead>
                  <TableHead className="text-xs text-left">{tx("التكلفة")}</TableHead>
                  <TableHead className="text-xs">{tx("سجّل")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="text-xs font-mono">
                      {new Date(row.created_at).toLocaleDateString("ar-DZ")}
                    </TableCell>
                    <TableCell className="text-xs font-medium">{row.ingredient_name}</TableCell>
                    <TableCell className="text-xs">
                      {row.quantity} {row.unit}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className={`text-[10px] ${REASON_COLORS[row.reason] ?? ""}`}>
                        {WASTE_REASONS[row.reason] ?? row.reason}
                        {row.reason === "other" && row.reason_other ? `: ${row.reason_other}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs font-bold text-left tabular-nums text-red-600">
                      {formatDZD(row.cost)}
                    </TableCell>
                    <TableCell className="text-xs text-[var(--muted-foreground)]">
                      {row.logged_by ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}
