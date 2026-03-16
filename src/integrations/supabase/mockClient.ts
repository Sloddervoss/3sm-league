import { DEMO_USER, DEMO_SESSION, DEMO_USER_ID, getInitialStore } from "./mockData";

// ─── Persistent in-memory store (localStorage backed) ────────────────────────

const STORE_KEY = "3sm-demo-store-v1";

function loadStore(): Record<string, any[]> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const initial = getInitialStore();
  saveStore(initial);
  return initial;
}

function saveStore(store: Record<string, any[]>) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
}

function getTable(table: string): any[] {
  const store = loadStore();
  return store[table] || [];
}

function setTable(table: string, rows: any[]) {
  const store = loadStore();
  store[table] = rows;
  saveStore(store);
}

function genId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ─── Join helper ──────────────────────────────────────────────────────────────
// Parses PostgREST-style select like "*, leagues(name, car_class), races(*)"
// and resolves foreign-key joins automatically based on naming conventions

const FK_MAP: Record<string, { fkCol: string; refTable: string; refCol: string }[]> = {
  races:            [{ fkCol: "league_id",           refTable: "leagues",          refCol: "id" }],
  race_registrations:[{ fkCol: "race_id",            refTable: "races",            refCol: "id" }],
  race_results:     [{ fkCol: "race_id",              refTable: "races",            refCol: "id" },
                     { fkCol: "user_id",              refTable: "profiles",         refCol: "user_id" }],
  team_memberships: [{ fkCol: "team_id",              refTable: "teams",            refCol: "id" },
                     { fkCol: "user_id",              refTable: "profiles",         refCol: "user_id" }],
  team_creation_requests:[{ fkCol: "user_id",          refTable: "profiles",         refCol: "user_id" }],
  protests:         [{ fkCol: "race_id",              refTable: "races",            refCol: "id" },
                     { fkCol: "reporter_user_id",     refTable: "profiles",         refCol: "user_id" },
                     { fkCol: "accused_user_id",      refTable: "profiles",         refCol: "user_id" }],
  penalties:        [{ fkCol: "race_id",              refTable: "races",            refCol: "id" },
                     { fkCol: "user_id",              refTable: "profiles",         refCol: "user_id" }],
};

// Parse "*, leagues(name), races(*)" into list of join specs
function parseSelect(sel: string): { joins: { alias: string; table: string; cols: string }[] } {
  const joins: { alias: string; table: string; cols: string }[] = [];
  const re = /(\w+)\(([^)]+)\)/g;
  let m;
  while ((m = re.exec(sel)) !== null) {
    joins.push({ alias: m[1], table: m[1], cols: m[2] });
  }
  return { joins };
}

function applyJoins(row: any, table: string, selectStr: string): any {
  const { joins } = parseSelect(selectStr);
  if (!joins.length) return row;
  const result = { ...row };
  const fks = FK_MAP[table] || [];

  for (const join of joins) {
    // find matching FK
    const fk = fks.find((f) => f.refTable === join.table || f.refTable.startsWith(join.alias));
    if (!fk) {
      // Special case: protests reporter/accused
      if (join.alias === "reporter") {
        const profiles = getTable("profiles");
        const p = profiles.find((r) => r.user_id === row.reporter_user_id);
        result["reporter"] = p ? pickCols(p, join.cols) : null;
        continue;
      }
      if (join.alias === "accused") {
        const profiles = getTable("profiles");
        const p = profiles.find((r) => r.user_id === row.accused_user_id);
        result["accused"] = p ? pickCols(p, join.cols) : null;
        continue;
      }
      continue;
    }
    const refRows = getTable(fk.refTable);
    const matched = refRows.filter((r) => r[fk.refCol] === row[fk.fkCol]);
    if (join.alias === "leagues" || join.alias === "league") {
      result[join.alias] = matched[0] ? pickCols(matched[0], join.cols) : null;
    } else if (join.alias === "races") {
      result[join.alias] = matched[0] ? pickCols(matched[0], join.cols) : null;
    } else if (join.alias === "profiles") {
      result[join.alias] = matched[0] ? pickCols(matched[0], join.cols) : null;
    } else if (join.alias === "race_registrations") {
      const regRows = getTable("race_registrations");
      result[join.alias] = regRows.filter((r) => r.race_id === row.id).map((r) => pickCols(r, join.cols));
    } else if (join.alias === "team_memberships") {
      const tmRows = getTable("team_memberships");
      result[join.alias] = tmRows
        .filter((r) => r.team_id === row.id)
        .map((r) => {
          const profiles = getTable("profiles");
          const p = profiles.find((pr) => pr.user_id === r.user_id);
          return { ...r, profiles: p ? pickCols(p, "display_name,iracing_name") : null };
        });
    } else {
      result[join.alias] = matched.length === 1 ? pickCols(matched[0], join.cols) : matched.map((r) => pickCols(r, join.cols));
    }
  }

  // Handle race_registrations inline for races
  if (table === "races" && selectStr.includes("race_registrations")) {
    const regRows = getTable("race_registrations");
    result["race_registrations"] = regRows.filter((r) => r.race_id === row.id).map((r) => ({ user_id: r.user_id }));
  }

  return result;
}

function pickCols(row: any, cols: string): any {
  if (cols === "*") return row;
  const keys = cols.split(",").map((c) => c.trim());
  const out: any = {};
  keys.forEach((k) => { if (k in row) out[k] = row[k]; });
  return out;
}

// ─── Query Builder ────────────────────────────────────────────────────────────

class QueryBuilder {
  private _table: string;
  private _selectStr = "*";
  private _filters: Array<(row: any) => boolean> = [];
  private _orderCol: string | null = null;
  private _orderAsc = true;
  private _limitN: number | null = null;
  private _isSingle = false;
  private _countOnly = false;

  private _insertData: any | null = null;
  private _updateData: any | null = null;
  private _deleteMode = false;
  private _upsertData: any | null = null;
  private _upsertConflict: string | null = null;
  private _returnSelect = false;

  constructor(table: string) {
    this._table = table;
  }

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    this._selectStr = cols;
    if (opts?.count === "exact") this._countOnly = true;
    return this;
  }

  eq(col: string, val: any) {
    this._filters.push((row) => String(row[col]) === String(val));
    return this;
  }

  not(col: string, op: string, val: any) {
    if (op === "is" && val === null) this._filters.push((row) => row[col] != null);
    return this;
  }

  in(col: string, vals: any[]) {
    this._filters.push((row) => vals.map(String).includes(String(row[col])));
    return this;
  }

  or(filterStr: string) {
    const parts = filterStr.split(",").map((f) => {
      const dotIdx = f.indexOf(".");
      const col = f.slice(0, dotIdx);
      const rest = f.slice(dotIdx + 1);
      const opDot = rest.indexOf(".");
      const op = rest.slice(0, opDot);
      const val = rest.slice(opDot + 1);
      return { col, op, val };
    });
    this._filters.push((row) =>
      parts.some(({ col, op, val }) => {
        if (op === "eq") return String(row[col]) === String(val);
        return false;
      })
    );
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this._orderCol = col;
    this._orderAsc = opts?.ascending !== false;
    return this;
  }

  limit(n: number) { this._limitN = n; return this; }
  single() { this._isSingle = true; return this; }

  insert(data: any) { this._insertData = data; return this; }
  update(data: any) { this._updateData = data; return this; }
  delete() { this._deleteMode = true; return this; }

  upsert(data: any, opts?: { onConflict?: string }) {
    this._upsertData = data;
    this._upsertConflict = opts?.onConflict || null;
    return this;
  }

  // Chained .select() after insert
  _chainSelect() { this._returnSelect = true; return this; }

  then(resolve: (v: any) => void, reject?: (e: any) => void) {
    try { resolve(this._execute()); }
    catch (e) { reject ? reject(e) : resolve({ data: null, error: e }); }
  }

  private _execute(): any {
    // ── INSERT ──
    if (this._insertData !== null) {
      const rows = Array.isArray(this._insertData) ? this._insertData : [this._insertData];
      const table = getTable(this._table);
      const inserted = rows.map((r) => ({ id: genId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...r }));
      setTable(this._table, [...table, ...inserted]);
      if (this._isSingle) return { data: inserted[0], error: null };
      return { data: inserted, error: null };
    }

    // ── UPSERT ──
    if (this._upsertData !== null) {
      const rows = Array.isArray(this._upsertData) ? this._upsertData : [this._upsertData];
      let table = getTable(this._table);
      const conflictKeys = this._upsertConflict ? this._upsertConflict.split(",").map((s) => s.trim()) : ["id"];
      rows.forEach((newRow) => {
        const idx = table.findIndex((existing) =>
          conflictKeys.every((k) => existing[k] !== undefined && String(existing[k]) === String(newRow[k]))
        );
        if (idx >= 0) {
          table[idx] = { ...table[idx], ...newRow, updated_at: new Date().toISOString() };
        } else {
          table.push({ id: genId(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...newRow });
        }
      });
      setTable(this._table, table);
      return { data: rows, error: null };
    }

    // ── UPDATE ──
    if (this._updateData !== null) {
      let table = getTable(this._table);
      table = table.map((row) => {
        if (this._filters.every((f) => f(row))) {
          return { ...row, ...this._updateData, updated_at: new Date().toISOString() };
        }
        return row;
      });
      setTable(this._table, table);
      return { data: null, error: null };
    }

    // ── DELETE ──
    if (this._deleteMode) {
      let table = getTable(this._table);
      table = table.filter((row) => !this._filters.every((f) => f(row)));
      setTable(this._table, table);
      return { data: null, error: null };
    }

    // ── SELECT ──
    let rows = getTable(this._table);

    // Apply filters
    rows = rows.filter((row) => this._filters.every((f) => f(row)));

    // Count mode
    if (this._countOnly) return { count: rows.length, error: null };

    // Apply joins
    rows = rows.map((row) => applyJoins(row, this._table, this._selectStr));

    // Order
    if (this._orderCol) {
      const col = this._orderCol;
      const asc = this._orderAsc;
      rows = [...rows].sort((a, b) => {
        const av = a[col], bv = b[col];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (typeof av === "string" && typeof bv === "string") return asc ? av.localeCompare(bv) : bv.localeCompare(av);
        return asc ? (av > bv ? 1 : -1) : (bv > av ? 1 : -1);
      });
    }

    // Limit
    if (this._limitN !== null) rows = rows.slice(0, this._limitN);

    // Single
    if (this._isSingle) {
      if (!rows.length) return { data: null, error: { message: "No rows found" } };
      return { data: rows[0], error: null };
    }

    return { data: rows, error: null };
  }
}

// ─── Auth state management ────────────────────────────────────────────────────

type AuthCallback = (event: string, session: typeof DEMO_SESSION | null) => void;
const authCallbacks: AuthCallback[] = [];
let currentSession: typeof DEMO_SESSION | null = null;

// Auto sign in as admin on load
setTimeout(() => {
  currentSession = DEMO_SESSION;
  authCallbacks.forEach((cb) => cb("SIGNED_IN", DEMO_SESSION));
}, 50);

// ─── Mock Supabase client ─────────────────────────────────────────────────────

export const mockSupabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },

  auth: {
    getSession() {
      return Promise.resolve({ data: { session: currentSession }, error: null });
    },

    onAuthStateChange(callback: AuthCallback) {
      authCallbacks.push(callback);
      // Fire immediately with current state
      setTimeout(() => callback(currentSession ? "SIGNED_IN" : "SIGNED_OUT", currentSession), 10);
      return {
        data: {
          subscription: {
            unsubscribe() {
              const idx = authCallbacks.indexOf(callback);
              if (idx >= 0) authCallbacks.splice(idx, 1);
            },
          },
        },
      };
    },

    async signInWithPassword({ email, password }: { email: string; password: string }) {
      // Accept any login in demo mode
      currentSession = DEMO_SESSION;
      authCallbacks.forEach((cb) => cb("SIGNED_IN", DEMO_SESSION));
      return { data: { session: DEMO_SESSION }, error: null };
    },

    async signUp({ email, password, options }: any) {
      // In demo mode just sign them in
      currentSession = DEMO_SESSION;
      authCallbacks.forEach((cb) => cb("SIGNED_IN", DEMO_SESSION));
      return { data: { session: DEMO_SESSION }, error: null };
    },

    async signOut() {
      currentSession = null;
      authCallbacks.forEach((cb) => cb("SIGNED_OUT", null));
      return { error: null };
    },
  },

  rpc(fn: string, args?: any) {
    if (fn === "has_role") {
      const { _user_id, _role } = args || {};
      const roles = getTable("user_roles");
      const has = roles.some((r) => r.user_id === _user_id && r.role === _role);
      return Promise.resolve({ data: has, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  },
};

// Utility: reset demo data to initial state
export function resetDemoData() {
  localStorage.removeItem(STORE_KEY);
  window.location.reload();
}
