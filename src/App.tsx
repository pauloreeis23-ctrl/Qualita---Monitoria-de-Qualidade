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
type Scorecard = { version: string; params: any[]; excellentMin: number; adequateMin: number; attentionMin: number };
type SheetState = { status: string; records: Monitoria[]; message: string; syncedAt: number | null; skipped: number; scaleNote: string; mapping: any[]; authExpired: boolean };

const DAY = 86400000;
const NO_TEAM = "Sem time";
const ALL_TEAMS = "Todos os times";
const ALL_CONSULTANTS = "Todos os consultores";
const ALL_WEEKS = "Todas as semanas";
const PALETTE = ["#826be0", "#61c5b2", "#e5a45c", "#5ea3e0", "#d46a8a", "#b86bd1", "#4fa3a5", "#d9776a"];
const CONCEPTS: Concept[] = ["Excelente", "Adequado", "Atenção", "Crítico"];
const CONCEPT_COLORS: Record<Concept, string> = { Excelente: "#62c9b5", Adequado: "#5ea3e0", Atenção: "#e5a45c", Crítico: "#ef8d85" };

const SB_URL = "https://xkrlnvksgouijbwvtphq.supabase.co";
const SB_KEY = "sb_publishable_3jHVyCvqdY-aU_L9VfmvIA_nV2P9SOo";
const SB_DEFAULT_TABLE = "monitorias";

const DEFAULT_SCORECARD: Scorecard = { version: "V4", params: [], excellentMin: 9, adequateMin: 7, attentionMin: 5 };

/* Utilitários */
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

function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : initial; } catch { return initial; }
  });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]);
  return [value, setValue] as const;
}

function conceptOf(total: number, sc: Scorecard): Concept {
  if (total >= sc.excellentMin) return "Excelente";
  if (total >= sc.adequateMin) return "Adequado";
  if (total >= sc.attentionMin) return "Atenção";
  return "Crítico";
}

function parseConcept(value: string): Concept | null {
  const s = norm(value);
  if (s.startsWith("excelente")) return "Excelente";
  if (s.startsWith("adequad")) return "Adequado";
  if (s.startsWith("atencao")) return "Atenção";
  if (s.startsWith("critic")) return "Crítico";
  return null;
}

const scored = (list: Monitoria[]): Scored[] => list.filter((r): r is Scored => r.nota !== null);

/* Parser */
function recordsFromRows(rows: string[][]) {
  const rawHeaders = rows[0] || [];
  const headers = rawHeaders.map(normHeader);
  const findIdx = (keys: string[]) => headers.findIndex((h) => keys.some((k) => h.includes(k)));
  
  const idx = {
    consultor: findIdx(["consultor", "atendente", "agente"]),
    nota: findIdx(["nota final", "nota total", "total", "nota"]),
    conceito: findIdx(["conceito"]),
    data: findIdx(["data"]),
    semana: findIdx(["semana"]),
    categoria: findIdx(["categoria"]),
    ticket: findIdx(["ticket", "protocolo"]),
    csat: findIdx(["csat"]),
    time: findIdx(["time", "equipe"]),
    atencao: findIdx(["atencao", "ponto de atencao"]),
    alerta: findIdx(["alerta"]),
  };

  const raw: Monitoria[] = [];
  let skipped = 0;

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (c: number) => (c >= 0 && r[c] ? String(r[c]).trim() : "");
    const consultor = get(idx.consultor);
    if (!consultor) { skipped++; continue; }

    const notaStr = get(idx.nota).replace(",", ".");
    const nota = Number(notaStr);
    if (isNaN(nota)) { skipped++; continue; }

    const alertText = norm(get(idx.alerta));
    const flag = /rebaix/.test(alertText) || (alertText !== "" && !["nao", "n", "-", "0", "false", "nenhum", "ok"].includes(alertText));

    raw.push({
      id: `r${i}`,
      date: get(idx.data) ? new Date(get(idx.data)).getTime() : null,
      week: get(idx.semana) || "Semana não informada",
      consultor,
      categoria: get(idx.categoria),
      ticket: get(idx.ticket),
      csat: get(idx.csat),
      team: get(idx.time),
      scores: null,
      nota,
      concept: parseConcept(get(idx.conceito)),
      flag,
      disregarded: false,
      attention: get(idx.atencao),
    });
  }

  return { records: raw, skipped, scaleNote: "", mapping: [] };
}

async function sbFetchRows(table: string): Promise<string[][]> {
  const res = await fetch(`${SB_URL}/rest/v1/${encodeURIComponent(table)}?select=*`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer token`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error("Erro ao buscar dados do Supabase.");
  const all = (await res.json()) as Record<string, unknown>[];
  if (all.length === 0) throw new Error("A tabela está vazia.");
  const headers = Array.from(new Set(all.flatMap((r) => Object.keys(r))));
  const cell = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return [headers, ...all.map((r) => headers.map((h) => cell(r[h])))];
}

function useSheet(table: string) {
  const [state, setState] = useState<SheetState>({ status: "loading", records: [], message: "", syncedAt: null, skipped: 0, scaleNote: "", mapping: [], authExpired: false });
  const load = useCallback(async () => {
    try {
      const rows = await sbFetchRows(table);
      const result = recordsFromRows(rows);
      setState({ status: "ok", records: result.records, message: "", syncedAt: Date.now(), skipped: result.skipped, scaleNote: "", mapping: [], authExpired: false });
    } catch (err: any) {
      setState((s) => ({ ...s, status: "error", message: err.message }));
    }
  }, [table]);

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

function computeRows(people: Person[], records: Monitoria[], weekFilter: string): AgentRow[] {
  const cur = new Map<string, number[]>();
  records.forEach((r) => {
    if (r.nota === null) return;
    if (weekFilter !== ALL_WEEKS && r.week !== weekFilter) return;
    const key = norm(r.consultor);
    const list = cur.get(key);
    if (list) list.push(r.nota);
    else cur.set(key, [r.nota]);
  });
  return people.map((p) => {
    const c = cur.get(norm(p.name)) ?? [];
    const score = avg(c);
    return { ...p, audits: c.length, score, trend: null };
  });
}

/* Componentes Visuais */
function Dropdown({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dropdown" style={{ position: "relative" }}>
      <button className="filter" onClick={() => setOpen(!open)} style={{ background: "#16171b", border: "1px solid #292a31", color: "#f2f2f5", padding: "8px 12px", borderRadius: 6, cursor: "pointer" }}>
        <span>{label}: </span><strong>{value} ▾</strong>
      </button>
      {open && (
        <div className="dropdown-menu" style={{ position: "absolute", top: "100%", left: 0, background: "#16171b", border: "1px solid #292a31", zIndex: 99, padding: 8, minWidth: 180, borderRadius: 6, boxShadow: "0 4px 12px rgba(0,0,0,0.4)" }}>
          {options.map((option) => (
            <div key={option} onClick={() => { onChange(option); setOpen(false); }} style={{ padding: "6px 8px", cursor: "pointer", borderRadius: 4, background: option === value ? "#292a31" : "transparent" }}>{option}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConceptPill({ concept }: { concept: Concept | null }) {
  if (!concept) return <span className="muted-text">—</span>;
  const color = CONCEPT_COLORS[concept];
  return <span className="pill" style={{ color, background: `${color}22`, padding: "2px 8px", borderRadius: 4, fontSize: 12, fontWeight: 600 }}>{concept}</span>;
}

function ConceptDistribution({ list }: { list: Scored[] }) {
  const counts = CONCEPTS.reduce((acc, c) => ({ ...acc, [c]: list.filter((r) => r.concept === c).length }), {} as Record<Concept, number>);
  const total = list.length;
  if (total === 0) return <p className="empty" style={{ color: "#8f919c" }}>Sem monitorias.</p>;
  return (
    <div className="concept-legend">
      {CONCEPTS.map((c) => (
        <div key={c} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <span>{c}</span><strong>{counts[c]}</strong><small style={{ color: "#8f919c" }}>{fmt((counts[c] / total) * 100, 0)}%</small>
        </div>
      ))}
    </div>
  );
}

function AuditDrawer({ monitoria, close }: { monitoria: Monitoria | null; close: () => void }) {
  if (!monitoria) return null;
  return (
    <div className="drawer-overlay" onClick={close} style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", justifyContent: "flex-end" }}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: 480, background: "#16171b", borderLeft: "1px solid #292a31", padding: 24, overflowY: "auto", color: "#f2f2f5" }}>
        <h3>Detalhes da Monitoria</h3>
        <p style={{ color: "#8f919c", fontSize: 13, marginBottom: 20 }}>Ticket #{monitoria.ticket || "—"}</p>
        
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div><small style={{ color: "#8f919c" }}>CONSULTOR(A)</small><div><strong>{monitoria.consultor}</strong></div></div>
          <div><small style={{ color: "#8f919c" }}>SEMANA / PERÍODO</small><div>{monitoria.week}</div></div>
          <div><small style={{ color: "#8f919c" }}>TIME</small><div>{monitoria.team || "—"}</div></div>
          <div><small style={{ color: "#8f919c" }}>CATEGORIA</small><div>{monitoria.categoria || "—"}</div></div>
          <div><small style={{ color: "#8f919c" }}>NOTA FINAL</small><div><strong>{monitoria.nota !== null ? fmt(monitoria.nota) : "—"} / 10</strong></div></div>
          <div><small style={{ color: "#8f919c" }}>CONCEITO</small><div><ConceptPill concept={monitoria.concept} /></div></div>
          <div><small style={{ color: "#8f919c" }}>STATUS CSAT</small><div>{monitoria.csat || "—"}</div></div>
          <div><small style={{ color: "#8f919c" }}>PONTO DE ATENÇÃO / OBSERVAÇÃO</small><div style={{ background: "#121316", padding: 12, borderRadius: 6, marginTop: 4, border: "1px solid #292a31" }}>{monitoria.attention || "Nenhum ponto registrado."}</div></div>
        </div>

        <button onClick={close} style={{ marginTop: 24, background: "#745ed4", color: "#fff", border: "none", padding: "10px 16px", borderRadius: 6, cursor: "pointer", width: "100%" }}>Fechar</button>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [selectedWeek, setSelectedWeek] = useState(ALL_WEEKS);
  const [team, setTeam] = useState(ALL_TEAMS);
  const [consultant, setConsultant] = useState(ALL_CONSULTANTS);
  const [activeAudit, setActiveAudit] = useState<Monitoria | null>(null);

  const [registered] = usePersistentState<Person[]>("qualita:v2:people", []);
  const [teams] = usePersistentState<string[]>("qualita:v3:teams", []);
  const [scorecard] = usePersistentState<Scorecard>("qualita:v3:scorecard", DEFAULT_SCORECARD);
  const [table] = usePersistentState<string>("qualita:v3:table", SB_DEFAULT_TABLE);

  const [sheet, reload] = useSheet(table);
  const records = useMemo(() => sheet.records.map((r) => r.nota === null || r.concept ? r : { ...r, concept: conceptOf(r.nota, scorecard) }), [sheet.records, scorecard]);
  const people = useMemo(() => buildPeople(registered, records), [registered, records]);
  const teamList = useMemo(() => buildTeamList(teams, people), [teams, people]);
  
  const weekList =
