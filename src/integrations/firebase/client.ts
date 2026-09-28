import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  documentId,
  orderBy as fsOrderBy,
  limit as fsLimit,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";
import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  type User,
} from "firebase/auth";
import {
  ref as storageRef,
  getDownloadURL,
  uploadString,
  uploadBytes,
} from "firebase/storage";
import {
  getFirebaseAuth,
  getFirebaseDb,
  getFirebaseStorage,
  getFirebaseStorageBucket,
} from "./config";
import { cacheSession, clearSessionCache } from "@/lib/session-cache";

const NO_BACKEND_MSG =
  "Firebase غير مهيأ. أضف VITE_FIREBASE_API_KEY و VITE_FIREBASE_PROJECT_ID للتشغيل الكامل. (وضع المعاينة لا يحتاج خادماً)";

const IN_CHUNK_SIZE = 30;

// ─── Preview mode stubs ────────────────────────────────────────
function createStubProxy(): any {
  const handler = { data: null as any, error: { message: NO_BACKEND_MSG } };

  const queryChain = (builder: any): any =>
    new Proxy(
      {
        eq: () => queryChain(builder),
        neq: () => queryChain(builder),
        gt: () => queryChain(builder),
        gte: () => queryChain(builder),
        lt: () => queryChain(builder),
        lte: () => queryChain(builder),
        like: () => queryChain(builder),
        ilike: () => queryChain(builder),
        in: () => queryChain(builder),
        order: () => queryChain(builder),
        limit: () => queryChain(builder),
        range: () => queryChain(builder),
        select: () => queryChain({ ...builder, kind: "select" }),
        insert: (data: any) =>
          queryChain({ ...builder, kind: "insert", payload: data }),
        update: (data: any) =>
          queryChain({ ...builder, kind: "update", payload: data }),
        delete: () => queryChain({ ...builder, kind: "delete" }),
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: "" } }),
        then: (resolve: any) =>
          resolve({
            data: builder.kind === "select" ? [] : null,
            error: null,
          }),
        returns: () => queryChain(builder),
      },
      {
        get(target: any, prop: string | symbol, receiver: any) {
          if (prop === "then") return target.then;
          if (typeof prop === "string" && prop in target)
            return (target as any)[prop];
          return receiver;
        },
      },
    );

  const fn: any = async () => handler;
  return new Proxy(fn, {
    get(target, prop: string | symbol, receiver) {
      if (prop === "from")
        return (table: string) => queryChain({ table, kind: "select" });
      if (prop === "getSession")
        return async () => ({ data: { session: null }, error: null });
      if (prop === "getUser")
        return async () => ({ data: { user: null }, error: null });
      if (prop === "signOut") return async () => ({ error: null });
      if (prop === "signInWithPassword")
        return async () => ({ data: { user: null }, error: null });
      if (prop === "signUp")
        return async () => ({ data: { user: null }, error: null });
      if (prop === "then") return undefined;
      if (typeof prop === "string" && prop in target)
        return (target as any)[prop];
      return receiver;
    },
    apply() {
      return fn();
    },
  });
}

// ─── Shared helpers ────────────────────────────────────────────
function buildQuery(
  db: any,
  table: string,
  filters: Array<{ op: string; field: string; value: any }>,
  orderBy: { field: string; direction: "asc" | "desc" } | null,
  limitN: number | null,
) {
  const constraints: QueryConstraint[] = [];
  for (const f of filters) {
    if (f.op === "in" && Array.isArray(f.value) && f.value.length === 0)
      continue;
    constraints.push(
      where(f.field === "id" ? documentId() : f.field, f.op as any, f.value),
    );
  }
  if (orderBy) {
    constraints.push(fsOrderBy(orderBy.field, orderBy.direction));
  }
  if (limitN) {
    constraints.push(fsLimit(limitN));
  }
  return query(collection(db, table), ...constraints);
}

async function runFirestoreQuery(
  db: any,
  table: string,
  filters: Array<{ op: string; field: string; value: any }>,
  orderBy: { field: string; direction: "asc" | "desc" } | null = null,
  limitN: number | null = null,
): Promise<any[]> {
  const inFilters = filters.filter(
    (f) => f.op === "in" && Array.isArray(f.value),
  );
  const otherFilters = filters.filter(
    (f) => !(f.op === "in" && Array.isArray(f.value)),
  );

  if (inFilters.length === 0) {
    const q = buildQuery(db, table, filters, orderBy, limitN);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  const inFilter = inFilters[0];
  const arr = inFilter.value as any[];
  let allResults: any[] = [];

  for (let i = 0; i < arr.length; i += IN_CHUNK_SIZE) {
    const chunk = arr.slice(i, i + IN_CHUNK_SIZE);
    const chunkFilters = [
      ...otherFilters,
      { op: "in", field: inFilter.field, value: chunk },
    ];
    const q = buildQuery(db, table, chunkFilters, orderBy, limitN);
    const snap = await getDocs(q);
    allResults = allResults.concat(
      snap.docs.map((d) => ({ id: d.id, ...d.data() })),
    );
  }

  return allResults;
}

// ─── Firestore query resilience ────────────────────────────────
// Firestore (unlike SQL) rejects some query shapes and needs composite
// indexes for others. The Supabase-compatible API is expected to behave
// like SQL, so we try the indexed Firestore query first and transparently
// fall back to fetching + filtering/ordering locally when Firestore refuses.
const RANGE_OPS = new Set([
  "gt",
  ">",
  "gte",
  ">=",
  "lt",
  "<",
  "lte",
  "<=",
  "neq",
  "!=",
]);
const indexMissCache = new Set<string>();

function normalizeValue(v: any): any {
  if (v === null || v === undefined) return v;
  if (typeof v?.toDate === "function") return v.toDate().getTime();
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) {
    const ms = Date.parse(v);
    if (!Number.isNaN(ms)) return ms;
  }
  return v;
}

/**
 * Firestore rejects the whole write when a field is `undefined`
 * ("Unsupported field value: undefined"). Optional form fields that were left
 * blank often arrive as `undefined`, so drop those keys before writing instead
 * of failing the save. Nested objects/arrays are cleaned recursively.
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

function compareValues(x: any, y: any): number {
  const a = normalizeValue(x);
  const b = normalizeValue(y);
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  return String(a).localeCompare(String(b));
}

function matchRange(value: any, op: string, target: any): boolean {
  if (value === null || value === undefined) return false;
  const c = compareValues(value, target);
  switch (op) {
    case ">":
      return c > 0;
    case ">=":
      return c >= 0;
    case "<":
      return c < 0;
    case "<=":
      return c <= 0;
    case "!=":
      return c !== 0;
    default:
      return true;
  }
}

function isIndexError(e: any): boolean {
  const msg = String(e?.message ?? e ?? "");
  return (
    msg.includes("requires an index") ||
    msg.includes("FAILED_PRECONDITION") ||
    msg.includes("first sort order must be the same") ||
    msg.includes("inequality filter") ||
    e?.code === 9
  );
}

function queryShapeKey(
  table: string,
  filters: Array<{ op: string; field: string }>,
  orderBy: { field: string; direction: string } | null,
): string {
  return `${table}|${filters.map((f) => `${f.op}:${f.field}`).join(",")}|${
    orderBy ? `${orderBy.field}:${orderBy.direction}` : ""
  }`;
}

async function resolveClientSide(
  db: any,
  table: string,
  filters: Array<{ op: string; field: string; value: any }>,
  orderBy: { field: string; direction: "asc" | "desc" } | null,
  limitN: number | null,
): Promise<any[]> {
  // Equality and `in` filters are always safe (single-field index merge),
  // so push those down and apply range filters / ordering / limit locally.
  const pushable = filters.filter((f) => f.op === "==" || f.op === "in");
  const rangeFilters = filters.filter((f) => RANGE_OPS.has(f.op));
  let rows = await runFirestoreQuery(db, table, pushable, null, null);
  if (rangeFilters.length) {
    rows = rows.filter((r) =>
      rangeFilters.every((f) => matchRange(r[f.field], f.op, f.value)),
    );
  }
  if (orderBy) {
    const dir = orderBy.direction === "desc" ? -1 : 1;
    rows = rows
      .slice()
      .sort((a, b) => dir * compareValues(a[orderBy.field], b[orderBy.field]));
  }
  if (limitN) rows = rows.slice(0, limitN);
  return rows;
}

async function executeFilterChain(
  db: any,
  table: string,
  filters: Array<{ op: string; field: string; value: any }>,
  orderBy: { field: string; direction: "asc" | "desc" } | null = null,
  limitN: number | null = null,
): Promise<any[]> {
  const ineqFilters = filters.filter(
    (f) => RANGE_OPS.has(f.op) || f.op === "in",
  );
  const ineqFields = new Set(ineqFilters.map((f) => f.field));
  const firstIneqField = ineqFilters[0]?.field ?? null;
  const eqFields = new Set(
    filters.filter((f) => f.op === "==").map((f) => f.field),
  );

  // Shapes Firestore rejects regardless of indexes → resolve locally.
  const invalidShape =
    ineqFields.size > 1 ||
    (orderBy !== null &&
      firstIneqField !== null &&
      orderBy.field !== firstIneqField) ||
    (orderBy !== null && eqFields.has(orderBy.field));

  const key = queryShapeKey(table, filters, orderBy);
  if (invalidShape || indexMissCache.has(key)) {
    return resolveClientSide(db, table, filters, orderBy, limitN);
  }

  try {
    return await runFirestoreQuery(db, table, filters, orderBy, limitN);
  } catch (e) {
    // Cloud Firestore raises several failure modes the SQL-compatible API
    // must transparently absorb: missing composite indexes
    // ("requires an index"), mixed filter types, and invalid query shapes.
    // The client-side fallback only relies on single-field equality / `in`
    // pushdowns which always work, so try it for ANY failure of the indexed
    // attempt. Genuine failures (permissions, offline) resurface because the
    // fallback fails too.
    if (isIndexError(e)) indexMissCache.add(key);
    return resolveClientSide(db, table, filters, orderBy, limitN);
  }
}

function makeUpdateChain(db: any, table: string, rawData: any) {
  const data = stripUndefined(rawData);
  const pendingFilters: Array<{ op: string; field: string; value: any }> = [];

  const chain: any = {
    eq: (field: string, value: any) => {
      pendingFilters.push({ op: "==", field, value });
      return chain;
    },
    neq: (field: string, value: any) => {
      pendingFilters.push({ op: "!=", field, value });
      return chain;
    },
    in: (field: string, value: any) => {
      if (Array.isArray(value) && value.length > 0) {
        pendingFilters.push({ op: "in", field, value });
      }
      return chain;
    },
    gte: (field: string, value: any) => {
      pendingFilters.push({ op: ">=", field, value });
      return chain;
    },
    lte: (field: string, value: any) => {
      pendingFilters.push({ op: "<=", field, value });
      return chain;
    },
    gt: (field: string, value: any) => {
      pendingFilters.push({ op: ">", field, value });
      return chain;
    },
    lt: (field: string, value: any) => {
      pendingFilters.push({ op: "<", field, value });
      return chain;
    },
    select: () => chain,
    single: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          null,
          1,
        );
        if (!rows.length)
          return { data: null, error: { message: "Not found" } };
        await updateDoc(doc(db, table, rows[0].id), data);
        return { data: { ...rows[0], ...data }, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    maybeSingle: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          null,
          1,
        );
        if (!rows.length) return { data: null, error: null };
        await updateDoc(doc(db, table, rows[0].id), data);
        return { data: { ...rows[0], ...data }, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    then: async (resolve: any) => {
      try {
        const rows = await executeFilterChain(db, table, pendingFilters);
        for (const d of rows) {
          await updateDoc(doc(db, table, d.id), data);
        }
        resolve({ data: rows.map((d) => ({ ...d, ...data })), error: null });
      } catch (e: any) {
        resolve({ data: [], error: { message: e.message } });
      }
    },
  };

  return chain;
}

function makeDeleteChain(db: any, table: string) {
  const pendingFilters: Array<{ op: string; field: string; value: any }> = [];

  const chain: any = {
    eq: (field: string, value: any) => {
      pendingFilters.push({ op: "==", field, value });
      return chain;
    },
    neq: (field: string, value: any) => {
      pendingFilters.push({ op: "!=", field, value });
      return chain;
    },
    in: (field: string, value: any) => {
      if (Array.isArray(value) && value.length > 0) {
        pendingFilters.push({ op: "in", field, value });
      }
      return chain;
    },
    gte: (field: string, value: any) => {
      pendingFilters.push({ op: ">=", field, value });
      return chain;
    },
    lte: (field: string, value: any) => {
      pendingFilters.push({ op: "<=", field, value });
      return chain;
    },
    select: () => chain,
    single: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          null,
          1,
        );
        if (!rows.length)
          return { data: null, error: { message: "Not found" } };
        await deleteDoc(doc(db, table, rows[0].id));
        return { data: rows[0], error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    maybeSingle: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          null,
          1,
        );
        if (!rows.length) return { data: null, error: null };
        await deleteDoc(doc(db, table, rows[0].id));
        return { data: rows[0], error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    then: async (resolve: any) => {
      try {
        const rows = await executeFilterChain(db, table, pendingFilters);
        for (const d of rows) {
          await deleteDoc(doc(db, table, d.id));
        }
        resolve({ data: null, error: null });
      } catch (e: any) {
        resolve({ data: null, error: { message: e.message } });
      }
    },
  };

  return chain;
}

// ─── Firestore query chain (real Firebase) ─────────────────────
function firestoreQueryChain(table: string, _builder: any): any {
  const db = getFirebaseDb();
  if (!db) return createStubProxy();

  const pendingFilters: Array<{ op: string; field: string; value: any }> = [];
  let pendingOrderBy: { field: string; direction: "asc" | "desc" } | null =
    null;
  let pendingLimit: number | null = null;

  const chain: any = {
    eq: (field: string, value: any) => {
      pendingFilters.push({ op: "==", field, value });
      return chain;
    },
    neq: (field: string, value: any) => {
      pendingFilters.push({ op: "!=", field, value });
      return chain;
    },
    gt: (field: string, value: any) => {
      pendingFilters.push({ op: ">", field, value });
      return chain;
    },
    gte: (field: string, value: any) => {
      pendingFilters.push({ op: ">=", field, value });
      return chain;
    },
    lt: (field: string, value: any) => {
      pendingFilters.push({ op: "<", field, value });
      return chain;
    },
    lte: (field: string, value: any) => {
      pendingFilters.push({ op: "<=", field, value });
      return chain;
    },
    like: (field: string, _value: any) => {
      console.warn(
        `[Firebase adapter] like query on "${field}" not supported — falling back to >= (prefix match).`,
      );
      pendingFilters.push({ op: ">=", field, value: _value });
      return chain;
    },
    ilike: (field: string, _value: any) => {
      console.warn(
        `[Firebase adapter] ilike query on "${field}" not supported — falling back to >= (prefix match).`,
      );
      pendingFilters.push({ op: ">=", field, value: _value });
      return chain;
    },
    in: (field: string, value: any) => {
      if (Array.isArray(value) && value.length > 0) {
        pendingFilters.push({ op: "in", field, value });
      }
      return chain;
    },
    order: (field: string, opts?: { ascending?: boolean }) => {
      pendingOrderBy = {
        field,
        direction: opts?.ascending !== false ? "asc" : "desc",
      };
      return chain;
    },
    limit: (n: number) => {
      pendingLimit = n;
      return chain;
    },
    range: (from: number, to: number) => {
      pendingLimit = to - from + 1;
      return chain;
    },
    select: () => chain,
    insert: (rawData: any) => {
      const data = stripUndefined(rawData);
      const doInsert = async () => {
        if (Array.isArray(data)) {
          const docs: any[] = [];
          for (const item of data) {
            const docRef = await addDoc(collection(db, table), item);
            docs.push({ id: docRef.id, ...item });
          }
          return docs;
        }
        const docRef = await addDoc(collection(db, table), data);
        const snap = await getDoc(docRef);
        return { id: snap.id, ...snap.data() };
      };
      return {
        _pendingInsert: data,
        single: async () => {
          try {
            return { data: await doInsert(), error: null };
          } catch (e: any) {
            return { data: null, error: { message: e.message } };
          }
        },
        maybeSingle: async () => {
          try {
            return { data: await doInsert(), error: null };
          } catch (e: any) {
            return { data: null, error: { message: e.message } };
          }
        },
        select: () => ({
          single: async () => {
            try {
              return { data: await doInsert(), error: null };
            } catch (e: any) {
              return { data: null, error: { message: e.message } };
            }
          },
          maybeSingle: async () => {
            try {
              return { data: await doInsert(), error: null };
            } catch (e: any) {
              return { data: null, error: { message: e.message } };
            }
          },
          then: async (resolve: any) => {
            try {
              resolve({ data: [await doInsert()], error: null });
            } catch (e: any) {
              resolve({ data: [], error: { message: e.message } });
            }
          },
        }),
        then: async (resolve: any) => {
          try {
            resolve({ data: [await doInsert()], error: null });
          } catch (e: any) {
            resolve({ data: [], error: { message: e.message } });
          }
        },
      };
    },
    update: (data: any) => makeUpdateChain(db, table, data),
    delete: () => makeDeleteChain(db, table),
    single: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          pendingOrderBy,
          pendingLimit ?? 1,
        );
        return { data: rows[0] ?? null, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    maybeSingle: async () => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          pendingOrderBy,
          pendingLimit ?? 1,
        );
        return { data: rows[0] ?? null, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    then: async (resolve: any) => {
      try {
        const rows = await executeFilterChain(
          db,
          table,
          pendingFilters,
          pendingOrderBy,
          pendingLimit,
        );
        resolve({ data: rows, error: null });
      } catch (e: any) {
        resolve({ data: [], error: { message: e.message } });
      }
    },
  };

  return chain;
}

// ─── Storage helpers ───────────────────────────────────────────
const UPLOAD_TIMEOUT_MS = 25_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("انتهت مهلة رفع الملف")), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

function parseStoragePath(bucket: string, path: string): string {
  const full = `${bucket}/${path}`;
  return full.replace(/\/{2,}/g, "/").replace(/^\/|\/$/g, "");
}

function getPublicUrlFromBucket(bucket: string, path: string): string {
  const storageBucket = getFirebaseStorageBucket();
  if (!storageBucket) return "";
  try {
    const full = parseStoragePath(bucket, path);
    return `https://firebasestorage.googleapis.com/v0/b/${storageBucket}/o/${encodeURIComponent(full)}?alt=media`;
  } catch {
    return "";
  }
}

function storageChain(bucket: string) {
  return {
    getPublicUrl: (path: string) => ({
      data: { publicUrl: getPublicUrlFromBucket(bucket, path) },
    }),
    upload: async (
      path: string,
      fileData: any,
      options?: { contentType?: string },
    ) => {
      const storage = getFirebaseStorage();
      if (!storage)
        return { data: { path }, error: { message: NO_BACKEND_MSG } };
      try {
        const ref = storageRef(storage, parseStoragePath(bucket, path));
        const contentType = options?.contentType;
        let task: Promise<unknown>;
        if (typeof fileData === "string") {
          const isDataUrl = fileData.startsWith("data:");
          task = uploadString(
            ref,
            fileData,
            isDataUrl ? "data_url" : "raw",
            isDataUrl ? undefined : contentType ? { contentType } : undefined,
          );
        } else if (fileData instanceof Blob || fileData instanceof File) {
          task = uploadBytes(
            ref,
            fileData,
            contentType ? { contentType } : undefined,
          );
        } else {
          task = uploadString(
            ref,
            String(fileData),
            "raw",
            contentType ? { contentType } : undefined,
          );
        }
        await withTimeout(task, UPLOAD_TIMEOUT_MS);
        // Build the public URL first so a later metadata/lookup failure can't
        // make a successful upload look like a failure.
        let url = getPublicUrlFromBucket(bucket, path);
        try {
          url = await withTimeout(getDownloadURL(ref), UPLOAD_TIMEOUT_MS);
        } catch {
          // keep the constructed public URL
        }
        return { data: { path, url }, error: null };
      } catch (e: any) {
        const msg = e?.message ?? "فشل رفع الملف";
        const code = String(e?.code ?? "") || msg;
        if (
          /bucket|[Ss]torage has not been set up|firebasestorage\.googleapis\.com\/(404)?/i.test(
            msg,
          ) ||
          code === "storage/unknown" ||
          code === "storage/bucket-not-found"
        ) {
          return {
            data: null,
            error: {
              message:
                "خدمة تخزين الصور غير مُفعّلة على مشروع Firebase — افتح Storage في لوحة Firebase واضغط «Get Started».",
            },
          };
        }
        return { data: null, error: { message: msg } };
      }
    },
  };
}

// ─── Auth wrapper ──────────────────────────────────────────────
function authWrapper() {
  const auth = getFirebaseAuth();

  async function getSession() {
    if (!auth) return { data: { session: null }, error: null };
    if (typeof window === "undefined") {
      return { data: { session: null }, error: null };
    }
    const current = auth.currentUser;
    if (current) {
      const token = await current.getIdToken();
      return {
        data: {
          session: {
            user: { id: current.uid, email: current.email },
            access_token: token,
          },
        },
        error: null,
      };
    }
    return new Promise<{
      data: {
        session: {
          user: { id: string; email: string | null };
          access_token: string;
        } | null;
      };
      error: null;
    }>((resolve) => {
      let settled = false;
      const finish = async (user: User | null) => {
        if (settled) return;
        settled = true;
        if (user) {
          const token = await user.getIdToken();
          resolve({
            data: {
              session: {
                user: { id: user.uid, email: user.email },
                access_token: token,
              },
            },
            error: null,
          });
        } else {
          resolve({ data: { session: null }, error: null });
        }
      };
      const unsub = onAuthStateChanged(auth, (user) => {
        unsub();
        finish(user);
      });
      setTimeout(() => finish(null), 3000);
    });
  }

  return {
    getSession,
    getUser: async () => {
      if (!auth) return { data: { user: null }, error: null };
      if (typeof window === "undefined") {
        return { data: { user: null }, error: null };
      }
      if (auth.currentUser) {
        return {
          data: {
            user: { id: auth.currentUser.uid, email: auth.currentUser.email },
          },
          error: null,
        };
      }
      const { data } = await getSession();
      return { data: { user: data.session?.user ?? null }, error: null };
    },
    signInWithPassword: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      if (!auth)
        return {
          data: { user: null, session: null },
          error: { message: NO_BACKEND_MSG },
        };
      try {
        if (typeof window !== "undefined") {
          await setPersistence(auth, browserLocalPersistence);
        }
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const token = await cred.user.getIdToken();
        const user = { id: cred.user.uid, email: cred.user.email };
        cacheSession(user.id);
        return {
          data: { user, session: { user, access_token: token } },
          error: null,
        };
      } catch (e: any) {
        return {
          data: { user: null, session: null },
          error: { message: e.message },
        };
      }
    },
    signUp: async ({
      email,
      password,
    }: {
      email: string;
      password: string;
    }) => {
      if (!auth)
        return {
          data: { user: null, session: null },
          error: { message: NO_BACKEND_MSG },
        };
      try {
        if (typeof window !== "undefined") {
          await setPersistence(auth, browserLocalPersistence);
        }
        const { createUserWithEmailAndPassword } =
          await import("firebase/auth");
        const cred = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        const token = await cred.user.getIdToken();
        const user = { id: cred.user.uid, email: cred.user.email };
        cacheSession(user.id);
        return {
          data: { user, session: { user, access_token: token } },
          error: null,
        };
      } catch (e: any) {
        return {
          data: { user: null, session: null },
          error: { message: e.message },
        };
      }
    },
    signOut: async () => {
      if (!auth) return { error: null };
      try {
        clearSessionCache();
        await fbSignOut(auth);
        return { error: null };
      } catch (e: any) {
        return { error: { message: e.message } };
      }
    },
  };
}

// ─── Firestore Realtime subscription (via onSnapshot) ──────────
function createRealtimeChannel(name: string) {
  const db = getFirebaseDb();
  const listeners: Array<{ unsub: () => void; filter: any; callback: any }> =
    [];

  const channelObj: any = {
    on: (event: string, opts: any, callback?: any) => {
      if (!db || !callback) return channelObj;
      const table = opts?.table || opts?.filter?.split("=")[0];
      const filterStr: string | undefined = opts?.filter;
      let filterField: string | null = null;
      let filterValue: string | null = null;
      if (filterStr) {
        const match = filterStr.match(/(\w+)=eq\.(.+)/);
        if (match) {
          filterField = match[1];
          filterValue = match[2];
        }
      }

      const tableRef = table ? collection(db, table) : null;
      if (!tableRef) return channelObj;

      const constraints: QueryConstraint[] = [];
      if (filterField && filterValue) {
        constraints.push(where(filterField, "==", filterValue));
      }

      const q = constraints.length ? query(tableRef, ...constraints) : tableRef;
      const unsub = onSnapshot(q, (snap) => {
        for (const change of snap.docChanges()) {
          const rowData = { id: change.doc.id, ...change.doc.data() };
          const eventType =
            change.type === "added"
              ? "INSERT"
              : change.type === "modified"
                ? "UPDATE"
                : change.type === "removed"
                  ? "DELETE"
                  : "UPDATE";
          callback({
            eventType: eventType.toLowerCase(),
            new:
              eventType !== "DELETE"
                ? { type: "TableRow", table, record: rowData }
                : undefined,
            old:
              eventType !== "INSERT"
                ? { type: "TableRow", table, record: rowData }
                : undefined,
          });
        }
      });

      listeners.push({ unsub, filter: opts, callback });
      return channelObj;
    },
    subscribe: () => {
      return {
        unsubscribe: () => channelObj.unsubscribe(),
        status: "SUBSCRIBED",
      };
    },
    unsubscribe: () => {
      for (const l of listeners) {
        l.unsub();
      }
      listeners.length = 0;
    },
  };

  return channelObj;
}

// ─── Main client export ────────────────────────────────────────
function createStorageStub() {
  const objectUrls = new Map<string, string>();
  return {
    from: (_bucket?: string) => ({
      getPublicUrl: (path: string) => ({
        data: { publicUrl: objectUrls.get(path) ?? "" },
      }),
      list: async (path: string) => ({
        data: objectUrls.get(path) ? [{ name: path }] : [],
        error: null,
      }),
      upload: async (path: string, fileData: any) => {
        try {
          if (typeof fileData === "string") {
            objectUrls.set(path, fileData);
            return { data: { path, url: fileData }, error: null };
          }
          if (typeof Blob !== "undefined" && fileData instanceof Blob) {
            const url = URL.createObjectURL(fileData);
            objectUrls.set(path, url);
            return { data: { path, url }, error: null };
          }
          objectUrls.set(path, String(fileData));
          return { data: { path, url: String(fileData) }, error: null };
        } catch (e: any) {
          return {
            data: null,
            error: { message: e?.message ?? "فشل رفع الملف" },
          };
        }
      },
    }),
  };
}

function createFirebaseClient(): any {
  const firebaseDb = getFirebaseDb();
  const isConfigured = !!firebaseDb;

  const from = (table: string) => {
    if (!isConfigured) return createStubProxy().from(table);
    return firestoreQueryChain(table, {});
  };

  const auth = authWrapper();
  const storageStub = createStorageStub();
  const storage = {
    from: (bucket: string) => {
      if (!isConfigured) return storageStub.from(bucket);
      return storageChain(bucket);
    },
  };

  const channels: Record<string, any> = {};

  return {
    from,
    auth,
    storage,
    channel: (name: string) => {
      if (!isConfigured) return createStubProxy().channel(name);
      if (!channels[name]) channels[name] = createRealtimeChannel(name);
      return channels[name];
    },
    removeChannel: (ch: any) => {
      ch?.unsubscribe?.();
    },
    removeAllChannels: () => {
      Object.values(channels).forEach((c) => c.unsubscribe());
    },
  };
}

export const supabase: any = createFirebaseClient();
