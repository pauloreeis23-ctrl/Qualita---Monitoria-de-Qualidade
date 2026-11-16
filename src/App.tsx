import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =====================================================================
   TIPOS
   ===================================================================== */

type Concept = "Excelente" | "Adequado" | "Atenção" | "Crítico";

type Person = { id: number; name: string; team: string; initials: string; color: string };

type Monitoria = {
  id: string;
  date: number | null;
  week: string;
  consultor: string;
  categoria: string;
  ticket: string;
  csat: string;
  team: string;
  scores: (number | null)[] | null;
  nota: number | null;
  concept: Concept | null;
  flag: boolean;
  disregarded: boolean;
  attention: string;
};

type Scored = Monitoria & { nota: number };

type AgentRow = Person & { audits: number; score: number; trend: number | null };

type Param = {
  id: number;
  name: string;
  evaluates: string;
  full: string;
  partial: string;
  none: string;
  canBeNA: boolean;
  rule: string;
};

type Scorecard = {
  version: string;
  params: Param[];
  excellentMin: number;
  adequateMin: number;
  attentionMin: number;
};

type Goals = { csat: number; agreement: number; feedback: number };

type FieldMapping = { field: string; label: string; header: string | null };

type SheetState = {
  status: "demo" | "loading" | "ok" | "error";
  records: Monitoria[];
  message: string;
  syncedAt: number | null;
  skipped: number;
  scaleNote: string;
  mapping: FieldMapping[];
  authExpired: boolean;
};

type Win = { from: number; to: number; prevFrom: number; prevTo: number; hasPrev: boolean };

/* =====================================================================
   CONSTANTES
   ===================================================================== */

const DAY = 86400000;
const NO_TEAM = "Sem time";
const ALL_TEAMS = "Todos os times";
const ALL_CONSULTANTS = "Todos os consultores";

const PALETTE = ["#826be0", "#61c5b2", "#e5a45c", "#5ea3e0", "#d46a8a", "#b86bd1", "#4fa3a5", "#d9776a"];

const CONCEPTS: Concept[] = ["Excelente", "Adequado", "Atenção", "Crítico"];

const CONCEPT_COLORS: Record<Concept, string> = {
  Excelente: "#62c9b5",
  Adequado: "#5ea3e0",
  Atenção: "#e5a45c",
  Crítico: "#ef8d85",
};

const PERIOD_NAMES = [
  "Semana anterior",
  "Últimos 7 dias",
  "Últimos 15 dias",
  "Últimos 30 dias",
  "Últimos 90 dias",
  "Todo o período",
];

const PERIOD_DAYS: Record<string, number> = {
  "Últimos 7 dias": 7,
  "Últimos 15 dias": 15,
  "Últimos 30 dias": 30,
  "Últimos 90 dias": 90,
};

const SB_URL: string = String((import.meta as any).env?.VITE_SUPABASE_URL ?? "https://xkrlnvksgouijbwvtphq.supabase.co").trim();
const SB_KEY: string = String((import.meta as any).env?.VITE_SUPABASE_KEY ?? "sb_publishable_3jHVyCvqdY-aU_L9VfmvIA_nV2P9SOo").trim();
const SB_DEFAULT_TABLE = "monitorias";

const DEFAULT_SCORECARD: Scorecard = {
  version: "V4",
  excellentMin: 9,
  adequateMin: 7,
  attentionMin: 5,
  params: [],
};

const DEFAULT_GOALS: Goals = { csat: 94, agreement: 90, feedback: 100 };

type SbSession = { access_token: string; refresh_token: string; expires_at: number; email: string };
type DataSource = { key: string; load: (() => Promise<string[][]>) | null };

/* =====================================================================
   UTILITÁRIOS E CÁLCULOS
   ===================================================================== */

const norm = (s: string) => (s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ") : "");
const normHeader = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const initialsOf = (name: string) => (name ? name.trim().split(/\s+/).map((n) => n[0] ?? "").join("").slice(0, 2).toUpperCase() : "PR");
const fmt = (n: number, digits = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const mondayOf = (t: number) => t - ((new Date(t).getDay() + 6) % 7) * DAY;

function pushTo<K>(map: Map<K, number[]>, key: K, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  }, [key, value]);
  return [value, setValue] as const;
}

function totalFromScores(scores: (number | null)[]): number | null {
  const applicable = scores.filter((s): s is number => s !== null);
  if (applicable.length === 0) return null;
  const obtained = applicable.reduce((a, b) => a + b, 0);
  return Math.round((obtained / (applicable.length * 2)) * 10);
}

function conceptOf(total: number, sc: Scorecard): Concept {
  if (total >= sc.excellentMin) return "Excelente";
  if (total >= sc.adequateMin) return "Adequado";
  if (total >= sc.attentionMin) return "Atenção";
  return "Crítico";
}

function rangeLabel(concept: Concept, sc: Scorecard) {
  const [lo, hi] =
    concept === "Excelente" ? [sc.excellentMin, 10] :
    concept === "Adequado" ? [sc.adequateMin, sc.excellentMin - 1] :
    concept === "Atenção" ? [sc.attentionMin, sc.adequateMin - 1] : [0, sc.attentionMin - 1];
  return lo === hi ? `${lo}` : `${lo} a ${hi}`;
}

function parseConcept(value: string): Concept | null {
  const s = norm(value);
  if (s.startsWith("excelente")) return "Excelente";
  if (s.startsWith("adequad")) return "Adequado";
  if (s.startsWith("atencao")) return "Atenção";
  if (s.startsWith("critic")) return "Crítico";
  return null;
}

function csatNotAnsweredPercentage(list: Monitoria[]): { pct: number | null; answered: number; total: number } {
  const validList = list.filter((r) => !r.disregarded);
  if (validList.length === 0) return { pct: null, answered: 0, total: 0 };

  let notAnsweredCount = 0;
  let answeredCount = 0;

  validList.forEach((r) => {
    const s = norm(r.csat);
    const isBlank = !s || s === "—" || /sem resposta|nao respondido|n\/a|vazio|-/.test(s);
    if (isBlank) notAnsweredCount++;
    else answeredCount++;
  });

  const pct = (notAnsweredCount / validList.length) * 100;
  return { pct, answered: answeredCount, total: validList.length };
}

const scored = (list: Monitoria[]): Scored[] => list.filter((r): r is Scored => r.nota !== null);

function getWindow(period: string, now: number): Win {
  if (period === "Todo o período") return { from: -Infinity, to: Infinity, prevFrom: -Infinity, prevTo: -Infinity, hasPrev: false };
  if (period === "Semana anterior") {
    const thisMonday = mondayOf(now);
    return { from: thisMonday - 7 * DAY, to: thisMonday, prevFrom: thisMonday - 14 * DAY, prevTo: thisMonday - 7 * DAY, hasPrev: true };
  }
  const days = PERIOD_DAYS[period] ?? 30;
  return { from: now - days * DAY, to: Infinity, prevFrom: now - 2 * days * DAY, prevTo: now - days * DAY, hasPrev: true };
}

const inCurrent = (r: Monitoria, w: Win) => r.date === null || (r.date >= w.from && r.date < w.to);
const inPrev = (r: Monitoria, w: Win) => w.hasPrev && r.date !== null && r.date >= w.prevFrom && r.date < w.prevTo;

/* =====================================================================
   PARSER
   ===================================================================== */

const FIELDS = [
  { field: "consultor", keys: ["consultor", "atendente", "agente", "colaborador"] },
  { field: "nota", keys: ["nota final", "nota total", "total", "nota"] },
  { field: "conceito", keys: ["conceito"] },
  { field: "data", keys: ["data"] },
  { field: "semana", keys: ["semana"] },
  { field: "categoria", keys: ["categoria"] },
  { field: "ticket", keys: ["ticket", "protocolo", "chamado"] },
  { field: "csat", keys: ["csat"] },
  { field: "time", keys: ["time", "equipe"] },
  { field: "alerta", keys: ["alerta"] },
  { field: "atencao", keys: ["atencao"] },
];

function findCol(headers: string[], keys: readonly string[]): number {
  for (const k of keys) {
    const exact = headers.indexOf(k);
    if (exact >= 0) return exact;
  }
  return -1;
}

function parseNumber(value: string): number {
  let s = value ? value.trim().replace("%", "").replace(/\s/g, "") : "";
  if (!s) return NaN;
  if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
  return Number(s);
}

function parseDateCell(value: string): number | null {
  const s = value ? value.trim() : "";
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  return null;
}

function recordsFromRows(rows: string[][]) {
  const keysOf = (field: string) => FIELDS.find((f) => f.field === field)!.keys;
  const rawHeaders = rows[0] || [];
  const headers = rawHeaders.map(normHeader);
  
  const idx: Record<string, number> = {};
  FIELDS.forEach((f) => { idx[f.field] = findCol(headers, f.keys); });

  const raw: Monitoria[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (c: number) => (c >= 0 && r[c] ? r[c].trim() : "");
    const consultor = get(idx.consultor);
    if (!consultor) { skipped++; continue; }

    const nota = parseNumber(get(idx.nota));
    if (isNaN(nota)) { skipped++; continue; }

    raw.push({
      id: `r${i}`,
      date: parseDateCell(get(idx.data)),
      week: get(idx.semana),
      consultor,
      categoria: get(idx.categoria),
      ticket: get(idx.ticket),
      csat: get(idx.csat),
      team: get(idx.time),
      scores: null,
      nota,
      concept: parseConcept(get(idx.conceito)),
      flag: false,
      disregarded: false,
      attention: get(idx.atencao),
    });
  }

  return { records: raw, skipped, scaleNote: "", mapping: [] };
}

/* =====================================================================
   SUPABASE & HOOKS
   ===================================================================== */

async function sbFetchRows(table: string, session: SbSession): Promise<string[][]> {
  const res = await fetch(`${SB_URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${session.access_token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Erro ao buscar dados do Supabase.");
  const all = (await res.json()) as Record<string, unknown>[];
  if (all.length === 0) throw new Error("A tabela está vazia.");
  const headers = Array.from(new Set(all.flatMap((r) => Object.keys(r))));
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return [headers, ...all.map((r) => headers.map((h) => cell(r[h])))];
}

function useSheet(source: DataSource) {
  const [state, setState] = useState<SheetState>({ status: "loading", records: [], message: "", syncedAt: null, skipped: 0, scaleNote: "", mapping: [], authExpired: false });
  const load = useCallback(async () => {
    if (!source.load) return;
    try {
      const rows = await source.load();
      const result = recordsFromRows(rows);
      setState({ status: "ok", records: result.records, message: "", syncedAt: Date.now(), skipped: result.skipped, scaleNote: "", mapping: [], authExpired: false });
    } catch (err: any) {
      setState((s) => ({ ...s, status: "error", message: err.message }));
    }
  }, [source.key]);

  useEffect(() => { load(); }, [load]);
  return [state, load] as const;
}

function buildPeople(registered: Person[], records: Monitoria[]): Person[] {
  const known = new Map<string, Person>();
  registered.forEach((p) => known.set(norm(p.name), p));
  records.forEach((r) => {
    const key = norm(r.consultor);
    if (!known.has(key)) {
      known.set(key, { id: -(hashStr(key) + 1), name: r.consultor, team: r.team || NO_TEAM, initials: initialsOf(r.consultor), color: PALETTE[known.size % PALETTE.length] });
    }
  });
  return Array.from(known.values());
}

function buildTeamList(teams: string[], people: Person[]): string[] {
  const set = new Set<string>(teams);
  people.forEach((p) => { if (p.team !== NO_TEAM) set.add(p.team); });
  const list = Array.from(set);
  if (people.some((p) => p.team === NO_TEAM)) list.push(NO_TEAM);
  return list;
}

function computeRows(people: Person[], records: Monitoria[], w: Win): AgentRow[] {
  const cur = new Map<string, number[]>();
  const prev = new Map<string, number[]>();
  records.forEach((r) => {
    if (r.nota === null) return;
    const key = norm(r.consultor);
    if (inCurrent(r, w)) pushTo(cur, key, r.nota);
    else if (inPrev(r, w)) pushTo(prev, key, r.nota);
  });
  return people.map((p) => {
    const c = cur.get(norm(p.name)) ?? [];
    const pr = prev.get(norm(p.name)) ?? [];
    const score = avg(c);
    return { ...p, audits: c.length, score, trend: c.length && pr.length ? score - avg(pr) : null };
  });
}

/* =====================================================================
   COMPONENTES UI
   ===================================================================== */

function Icon() { return <span style={{ fontSize: 18, lineHeight: 1 }}>✦</span>; }

function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dropdown">
      <button className="filter" onClick={() => setOpen(!open)}><span>{label}</span><strong>{value} ▾</strong></button>
      {open && (
        <>
          <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="dropdown-menu">
            {options.map((option) => (
              <div key={option} className={option === value ? "selected" : ""} onClick={() => { onChange(option); setOpen(false); }}>{option}</div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Delta({ value, lowerIsBetter = false, unit = "%" }: { value: number | null; lowerIsBetter?: boolean; unit?: string }) {
  if (value === null) return <span className="muted-text">—</span>;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return <span className={good ? "positive" : "negative"}>{value >= 0 ? "+" : ""}{fmt(value)}{unit}</span>;
}

function ConceptPill({ concept }: { concept: Concept | null }) {
  if (!concept) return <span className="muted-text">—</span>;
  const color = CONCEPT_COLORS[concept];
  return <span className="pill" style={{ color, background: `${color}22` }}>{concept}</span>;
}

function ConceptDistribution({ list }: { list: Scored[] }) {
  const counts = conceptCounts(list);
  const total = CONCEPTS.reduce((sum, c) => sum + counts[c], 0);
  if (total === 0) return <p className="empty">Sem monitorias.</p>;
  return (
    <div className="concept-legend">
      {CONCEPTS.map((c) => (
        <div key={c}>
          <span><i className="dot" style={{ background: CONCEPT_COLORS[c] }} />{c}</span>
          <strong>{counts[c]}</strong>
          <small>{fmt((counts[c] / total) * 100, 0)}%</small>
        </div>
      ))}
    </div>
  );
}

function conceptCounts(list: Scored[]): Record<Concept, number> {
  const counts: Record<Concept, number> = { Excelente: 0, Adequado: 0, Atenção: 0, Crítico: 0 };
  list.forEach((r) => { if (r.concept) counts[r.concept]++; });
  return counts;
}

function ParamBars() { return <p className="empty">Parâmetros carregados.</p>; }

function Sidebar({ page, setPage, userEmail }: { page: string; setPage: (v: string) => void; userEmail?: string }) {
  const items = [["dashboard", "Dashboard"], ["monitorias", "Monitorias"], ["parameters", "Parâmetros"], ["team", "Equipe"], ["reports", "Relatórios"], ["settings", "Configurações"]];
  return (
    <aside className="sidebar">
      <div className="brand"><div className="logo-mark">Q</div><div><strong>Qualitá</strong><span>MONITORIA</span></div></div>
      <nav>
        {items.map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}><Icon /> {label}</button>
        ))}
      </nav>
      {userEmail && <div className="sidebar-user"><span>{userEmail}</span></div>}
    </aside>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div><h1>Qualitá Gerencial</h1><p>Monitoria de Qualidade</p></div>
      <div className="user-profile"><span className="avatar">PR</span><div><strong>Paulo Reis</strong><small>Analista</small></div></div>
    </header>
  );
}

function SourceBanner({ sheet, reload }: { sheet: SheetState; reload: () => void; goSettings: () => void }) {
  return (
    <div className="notice success source-banner">
      <span>Conectado ao Supabase: {sheet.records.length} linhas</span>
      <button className="secondary-button" onClick={reload}>Atualizar</button>
    </div>
  );
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */

function Dashboard({ people, records, teamList, scorecard, openAudit }: {
  people: Person[]; records: Monitoria[]; teamList: string[]; scorecard: Scorecard; goals: Goals; openAudit: (p?: Person) => void;
}) {
  const [period, setPeriod] = useState("Últimos 30 dias");
  const [team, setTeam] = useState(ALL_TEAMS);
  const [consultant, setConsultant] = useState(ALL_CONSULTANTS);

  const w = getWindow(period, Date.now());
  const teamOf = new Map(people.map((p) => [norm(p.name), p.team]));
  const matched = records.filter((r) => (team === ALL_TEAMS || (teamOf.get(norm(r.consultor)) ?? NO_TEAM) === team) && (consultant === ALL_CONSULTANTS || norm(r.consultor) === norm(consultant)));
  
  const current = matched.filter((r) => inCurrent(r, w));
  const previous = matched.filter((r) => inPrev(r, w));
  const cs = scored(current);
  const ps = scored(previous);

  const curAvg = avg(cs.map((r) => r.nota));
  const prevAvg = avg(ps.map((r) => r.nota));
  const critPct = cs.length ? (cs.filter((r) => r.concept === "Crítico").length / cs.length) * 100 : 0;
  
  const csatNotAnswered = csatNotAnsweredPercentage(current);
  const hasPrev = ps.length > 0;

  const rows = computeRows(people.filter((p) => (team === ALL_TEAMS || p.team === team)), records, w).filter((r) => r.audits > 0).sort((a, b) => b.score - a.score);
  const alerts = current.filter((r) => r.flag || r.concept === "Crítico").slice(0, 8);

  return (
    <main className="content">
      <section className="filterbar">
        <div className="filters">
          <Dropdown label="PERÍODO" value={period} options={PERIOD_NAMES} onChange={setPeriod} />
          <Dropdown label="TIME" value={team} options={[ALL_TEAMS, ...teamList]} onChange={setTeam} />
          <Dropdown label="CONSULTORES" value={consultant} options={[ALL_CONSULTANTS, ...people.map(p => p.name)]} onChange={setConsultant} />
        </div>
      </section>

      <section className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card" onClick={() => openAudit()} style={{ cursor: "pointer" }}>
          <div className="kpi-header"><small>NOTA MÉDIA</small><Delta value={hasPrev ? curAvg - prevAvg : null} unit=" pts" /></div>
          <div className="kpi-body"><strong>{fmt(curAvg)}</strong><span>/ 10</span></div>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>MONITORIAS AVALIADAS</small></div>
          <div className="kpi-body"><strong>{cs.length}</strong></div>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>TICKETS CRÍTICOS</small></div>
          <div className="kpi-body"><strong>{fmt(critPct)}%</strong></div>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>CSAT NÃO RESPONDIDO</small></div>
          <div className="kpi-body"><strong>{csatNotAnswered.pct === null ? "—" : `${fmt(csatNotAnswered.pct)}%`}</strong></div>
          <p>{csatNotAnswered.pct === null ? "sem registros" : `${csatNotAnswered.total - csatNotAnswered.answered} de ${csatNotAnswered.total} sem resposta`}</p>
        </article>
      </section>

      <div className="grid-2">
        <section className="panel"><h3>Distribuição por conceito</h3><ConceptDistribution list={cs} /></section>
        <section className="panel"><h3>Média por parâmetro</h3><ParamBars list={cs} scorecard={scorecard} /></section>
      </div>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h3>Alertas para a liderança</h3>
        {alerts.length === 0 ? <p className="empty">Nenhum alerta.</p> : (
          <table>
            <thead><tr><th>CONSULTOR</th><th>TICKET</th><th>NOTA</th><th>CONCEITO</th></tr></thead>
            <tbody>
              {alerts.map((r) => (
                <tr key={r.id}><td><strong>{r.consultor}</strong></td><td>#{r.ticket}</td><td>{r.nota}</td><td><ConceptPill concept={r.concept} /></td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel ranking-panel">
        <h3>Ranking da equipe</h3>
        <table>
          <thead><tr><th>#</th><th>CONSULTOR</th><th>TIME</th><th>NOTA MÉDIA</th></tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id} onClick={() => openAudit(row)} style={{ cursor: "pointer" }}>
                <td>{index + 1}</td><td><strong>{row.name}</strong></td><td>{row.team}</td><td><strong>{fmt(row.score)}</strong> / 10</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Monitorias({ records }: { records: Monitoria[] }) { return <main className="content"><div className="panel"><h3>Monitorias</h3><p className="muted">{records.length} registros.</p></div></main>; }
function Parameters() { return <main className="content"><div className="panel"><h3>Scorecard</h3></div></main>; }
function Team({ people }: { people: Person[] }) { return <main className="content"><div className="panel"><h3>Equipe</h3><p className="muted">{people.length} membros.</p></div></main>; }
function Reports() { return <main className="content"><div className="panel"><h3>Relatórios</h3></div></main>; }
function Settings() { return <main className="content"><div className="panel"><h3>Configurações</h3></div></main>; }

function AuditDrawer({ person, records, close }: { person: Person | null; records: Monitoria[]; close: () => void }) {
  const own = records.filter((r) => !person || norm(r.consultor) === norm(person.name));
  return (
    <div className="drawer-overlay" onClick={close}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: 450 }}>
        <h3>{person ? person.name : "Geral"}</h3>
        <p className="muted">{own.length} monitorias no total</p>
        <button className="secondary-button" onClick={close} style={{ marginTop: 20 }}>Fechar</button>
      </div>
    </div>
  );
}

/* =====================================================================
   APP PRINCIPAL
   ===================================================================== */

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditPerson, setAuditPerson] = useState<Person | null>(null);

  const [registered] = usePersistentState<Person[]>("qualita:v2:people", []);
  const [teams] = usePersistentState<string[]>("qualita:v3:teams", []);
  const [scorecard] = usePersistentState<Scorecard>("qualita:v3:scorecard", DEFAULT_SCORECARD);
  const [goals] = usePersistentState<Goals>("qualita:v3:goals", DEFAULT_GOALS);
  const [session] = usePersistentState<SbSession | null>("qualita:v3:session", { access_token: "token", refresh_token: "", expires_at: 9999999999, email: "paulo.moura@lg.com" });
  const [table] = usePersistentState<string>("qualita:v3:table", SB_DEFAULT_TABLE);

  const source: DataSource = {
    key: `sb|${table}`,
    load: () => sbFetchRows(table, session!),
  };

  const [sheet, reload] = useSheet(source);
  const records = useMemo(() => sheet.records.map((r) => r.nota === null || r.concept ? r : { ...r, concept: conceptOf(r.nota, scorecard) }), [sheet.records, scorecard]);
  const people = useMemo(() => buildPeople(registered, records), [registered, records]);
  const teamList = useMemo(() => buildTeamList(teams, people), [teams, people]);

  return (
    <div className="app-container">
      <Sidebar page={page} setPage={setPage} userEmail={session?.email} />
      <div className="workspace">
        <Header />
        <SourceBanner sheet={sheet} reload={reload} goSettings={() => setPage("settings")} />
        {page === "dashboard" && <Dashboard people={people} records={records} teamList={teamList} scorecard={scorecard} goals={goals} openAudit={(p) => { setAuditPerson(p ?? null); setAuditOpen(true); }} />}
        {page === "monitorias" && <Monitorias records={records} />}
        {page === "parameters" && <Parameters />}
        {page === "team" && <Team people={people} />}
        {page === "reports" && <Reports />}
        {page === "settings" && <Settings />}
      </div>
      {auditOpen && <AuditDrawer person={auditPerson} records={records} close={() => setAuditOpen(false)} />}
    </div>
  );
}
