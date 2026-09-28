/**
 * Unified staff permission model.
 *
 * A single employee can hold any combination of permissions:
 *  - operational interfaces (kitchen / waiter / cashier screens)
 *  - operations-dashboard areas (overview, inventory, recipes, …)
 *
 * An operations area can additionally carry write access, encoded as
 * `${area}:write`. Storing one flat `permissions: string[]` on the staff
 * document keeps the Firestore/Supabase adapter simple while still giving
 * view/edit granularity per area.
 */

export type StaffInterface = "kitchen" | "waiter" | "cashier";

export type StaffOpsArea =
  | "overview"
  | "inventory"
  | "inventoryCount"
  | "recipes"
  | "menu"
  | "suppliers"
  | "employees"
  | "staffPerformance"
  | "expenses"
  | "waste"
  | "complaints"
  | "reports"
  | "accounting"
  | "reportArchive";

export type StaffPermission =
  StaffInterface | StaffOpsArea | `${StaffOpsArea}:write`;

// ─── Legacy role constants (kept here to avoid import cycles) ──
export const ROLE_CASHIER = "كاشير";
export const ROLE_WAITER = "نادل";
export const ROLE_KITCHEN = "مطبخ";

export const GLOBAL_ROLES: string[] = [ROLE_CASHIER, ROLE_WAITER, ROLE_KITCHEN];

export const INTERFACE_PERMISSIONS: Array<{
  id: StaffInterface;
  label: string;
  path: string;
}> = [
  { id: "kitchen", label: "المطبخ", path: "/kitchen-screen" },
  { id: "waiter", label: "النادل", path: "/waiter-screen" },
  { id: "cashier", label: "الكاشير", path: "/cashier" },
];

export const OPS_AREA_LABELS: Record<StaffOpsArea, string> = {
  overview: "نظرة عامة",
  inventory: "المخزون",
  inventoryCount: "جرد المخزون",
  recipes: "الوصفات",
  menu: "المنيو والأصناف",
  suppliers: "الموردين",
  employees: "الموظفين",
  staffPerformance: "أداء الموظفين",
  expenses: "المصاريف",
  waste: "سجل الهدر",
  complaints: "الشكاوى",
  reports: "التقارير",
  accounting: "المحاسبة",
  reportArchive: "أرشيف التقارير",
};

export const OPS_AREA_PATHS: Record<StaffOpsArea, string> = {
  overview: "/ops",
  inventory: "/ops/inventory",
  inventoryCount: "/ops/inventory-count",
  recipes: "/ops/recipes",
  menu: "/ops/menu",
  suppliers: "/ops/suppliers",
  employees: "/ops/employees",
  staffPerformance: "/ops/staff-performance",
  expenses: "/ops/expenses",
  waste: "/ops/waste",
  complaints: "/ops/complaints",
  reports: "/ops/reports",
  accounting: "/ops/accounting",
  reportArchive: "/ops/report-archive",
};

export const OPS_AREAS = Object.keys(OPS_AREA_LABELS) as StaffOpsArea[];

const WRITE_SUFFIX = ":write";

export const writeAllowance = (area: string): string =>
  `${area}${WRITE_SUFFIX}`;

export function isInterfacePermission(p: string): p is StaffInterface {
  return INTERFACE_PERMISSIONS.some((i) => i.id === p);
}

export function isWritePermission(p: string): boolean {
  return p.endsWith(WRITE_SUFFIX);
}

export function baseOfPermission(p: string): string {
  return isWritePermission(p) ? p.slice(0, -WRITE_SUFFIX.length) : p;
}

export function isOpsAreaPermission(p: string): p is StaffOpsArea {
  const base = baseOfPermission(p);
  return (OPS_AREAS as string[]).includes(base);
}

export function interfaceLabel(id: StaffInterface): string {
  return INTERFACE_PERMISSIONS.find((i) => i.id === id)?.label ?? id;
}

/** Route paths of the interface screens the employee may open. */
export function allowedInterfacePaths(permissions: string[]): string[] {
  return INTERFACE_PERMISSIONS.filter((i) => permissions.includes(i.id))
    .map((i) => i.path)
    .filter((p): p is string => !!p);
}

/** Route paths of the operations areas the employee may open. */
export function allowedOpsAreaPaths(permissions: string[]): string[] {
  return grantedOpsAreas(permissions).map(({ area }) => opsAreaPath(area));
}

/**
 * Every route path the employee may open: the operational interface screens
 * first (kitchen / waiter / cashier), then the granted operations areas.
 */
export function allowedStaffPaths(permissions: string[]): string[] {
  return [
    ...allowedInterfacePaths(permissions),
    ...allowedOpsAreaPaths(permissions),
  ];
}

/** First screen the employee should land on after signing in, or null. */
export function firstStaffPath(permissions: string[]): string | null {
  return allowedStaffPaths(permissions)[0] ?? null;
}

export function interfacePath(id: StaffInterface): string | null {
  return INTERFACE_PERMISSIONS.find((i) => i.id === id)?.path ?? null;
}

export function opsAreaLabel(area: StaffOpsArea): string {
  return OPS_AREA_LABELS[area] ?? area;
}

export function opsAreaPath(area: StaffOpsArea): string {
  return OPS_AREA_PATHS[area] ?? "/ops";
}

/** Human-readable label for a single stored permission string. */
export function permissionLabel(p: string): string {
  const base = baseOfPermission(p);
  if (isInterfacePermission(base)) return interfaceLabel(base);
  if ((OPS_AREAS as string[]).includes(base)) {
    return `${opsAreaLabel(base as StaffOpsArea)}${isWritePermission(p) ? " — تعديل" : " — إطلاع"}`;
  }
  return p;
}

export function normalizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === "string" && p.length > 0);
}

/** Interface screens the employee may open. */
export function grantedInterfaces(permissions: string[]): StaffInterface[] {
  return INTERFACE_PERMISSIONS.map((i) => i.id).filter((id) =>
    permissions.includes(id),
  );
}

/** Ops areas the employee may open, with write flag. */
export function grantedOpsAreas(permissions: string[]): Array<{
  area: StaffOpsArea;
  write: boolean;
}> {
  const out: Array<{ area: StaffOpsArea; write: boolean }> = [];
  for (const area of OPS_AREAS) {
    const has =
      permissions.includes(area) || permissions.includes(writeAllowance(area));
    if (has)
      out.push({ area, write: permissions.includes(writeAllowance(area)) });
  }
  return out;
}

export function canAccessInterface(
  permissions: string[],
  id: StaffInterface,
): boolean {
  return permissions.includes(id);
}

export function canAccessOpsArea(
  permissions: string[],
  area: StaffOpsArea,
): boolean {
  return (
    permissions.includes(area) || permissions.includes(writeAllowance(area))
  );
}

export function canWriteOpsArea(
  permissions: string[],
  area: StaffOpsArea,
): boolean {
  // A granted area always means full control — the read-only `:write` nuance
  // is legacy. Anything the manager activates, the employee can manage.
  return permissions.includes(area) || permissions.includes(writeAllowance(area));
}

/**
 * The legacy `role` field is written from permission *labels* ("المطبخ") while
 * the role constants are bare ("مطبخ"), and older rows carry either spelling.
 * Comparing a normalized form keeps both resolving to the same role.
 */
export function normalizeRoleLabel(role: unknown): string {
  if (typeof role !== "string") return "";
  const s = role.trim();
  return s.startsWith("ال") ? s.slice(2) : s;
}

/**
 * Legacy compatibility: derive permission list from the old single `role`
 * free-text field (كاشير / نادل / مطبخ).
 */
export function derivePermissionsFromRole(role: unknown): string[] {
  const r = normalizeRoleLabel(role);
  if (r === ROLE_KITCHEN) return ["kitchen"];
  if (r === ROLE_WAITER) return ["waiter"];
  if (r === ROLE_CASHIER) return ["cashier"];
  return [];
}

/** First operational interface, used to keep the legacy `role` field in sync. */
export function primaryInterfaceFor(
  permissions: string[],
): StaffInterface | null {
  for (const id of ["kitchen", "waiter", "cashier"] as StaffInterface[]) {
    if (permissions.includes(id)) return id;
  }
  return null;
}

/** Legacy role label derived from permissions (display/sync only). */
export function roleLabelFor(permissions: string[]): string {
  const primary = primaryInterfaceFor(permissions);
  if (primary) return interfaceLabel(primary);
  if (grantedOpsAreas(permissions).length > 0) return "موظف إدارة";
  return "موظف";
}

/** True when the employee has any permission at all. */
export function hasAnyPermission(permissions: string[]): boolean {
  return permissions.length > 0;
}
