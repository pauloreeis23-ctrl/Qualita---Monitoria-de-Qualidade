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

const CONCEPT_READING: Record<Concept, string> = {
  Excelente: "Atende plenamente em praticamente todos os parâmetros.",
  Adequado: "Atende, com pequenas lacunas pontuais.",
  Atenção: "Lacunas relevantes; pede acompanhamento.",
  Crítico: "Não atende na maior parte, ou teve prioridade rebaixada indevidamente.",
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

const ENV_URL: string = (((import.meta as any).env?.VITE_SHEET_CSV_URL as string | undefined) ?? "").trim();
const DEFAULT_GOALS: Goals = { csat: 94, agreement: 90, feedback: 100 };

const DEFAULT_SCORECARD: Scorecard = {
  version: "V4 (piloto, 05/11/2026)",
  excellentMin: 9,
  adequateMin: 7,
  attentionMin: 5,
  params: [
    { id: 1, name: "Classificação e triagem", evaluates: "Categoria, causa, solução corretos.", full: "Todos corretos.", partial: "Um incorreto.", none: "Errado.", canBeNA: false, rule: "" },
    { id: 2, name: "Condução ativa", evaluates: "Iniciativa e atualizações.", full: "Proativo.", partial: "Razoável.", none: "Sem atualização.", canBeNA: true, rule: "" },
    { id: 3, name: "Comunicação e prazos", evaluates: "Mensagens objetivas.", full: "Clara.", partial: "Genérica.", none: "Confusa.", canBeNA: true, rule: "" },
    { id: 4, name: "Conclusão validada", evaluates: "Solicitação resolvida.", full: "Validado.", partial: "Sem validação explícita.", none: "Sumária.", canBeNA: false, rule: "" },
    { id: 5, name: "Registro interno", evaluates: "Observação interna.", full: "Clara e estruturada.", partial: "Incompleto.", none: "Sem registro.", canBeNA: false, rule: "" },
  ],
};

const GENERAL_RULES = [
  "A nota de cada parâmetro é inteira (0, 1 ou 2).",
  "O conceito final é calculado a partir do total.",
];

/* =====================================================================
   UTILITÁRIOS
   ===================================================================== */

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const normHeader = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();
const initialsOf = (name: string) => name.trim().split(/\s+/).map((n) => n[0] ?? "").join("").slice(0, 2).toUpperCase();
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const fmt = (n: number, digits = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const fmtDate = (t: number) => new Date(t).toLocaleDateString("pt-BR");
const fmtTime = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const mondayOf = (t: number) => startOfDay(t) - ((new Date(t).getDay() + 6) % 7) * DAY;

function weekLabel(date: number) {
  const monday = mondayOf(date);
  const short = (t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${short(monday)} a ${short(monday + 4 * DAY)}`; }  function pushTo<K>(map: Map<K, number[]>, key: K, value: number) { const list = map.get(key); if (list) list.push(value); else map.set(key, [value]); }  function usePersistentState<T>(key: string, initial: T) { const [value, setValue] = useState<T>(() => { try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } }); useEffect(() => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, [key, value]); return [value, setValue] as const; }  /* ===================================================================== REGRAS DO SCORECARD E CSAT ===================================================================== */  function totalFromScores(scores: (number \vert{} null)[]): number \vert{} null { const applicable = scores.filter((s): s is number => s !== null); if (applicable.length === 0) return null; const obtained = applicable.reduce((a, b) => a + b, 0); return Math.round((obtained / (applicable.length * 2)) * 10); }  function conceptOf(total: number, sc: Scorecard): Concept { if (total >= sc.excellentMin) return "Excelente"; if (total >= sc.adequateMin) return "Adequado"; if (total >= sc.attentionMin) return "Atenção"; return "Crítico"; }  function rangeLabel(concept: Concept, sc: Scorecard) { const [lo, hi] = concept === "Excelente" ? [sc.excellentMin, 10] : concept === "Adequado" ? [sc.adequateMin, sc.excellentMin - 1] : concept === "Atenção" ? [sc.attentionMin, sc.adequateMin - 1] : [0, sc.attentionMin - 1]; return lo === hi ? `${lo}` : `${lo} a${hi}`;
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
   PARSER DE DADOS
   ===================================================================== */

const FIELDS = [
  { field: "consultor", keys: ["consultor", "atendente", "agente", "colaborador"] },
  { field: "nota", keys: ["nota final", "nota total", "total", "nota"] },
  { field: "conceito", keys: ["conceito"] },
  { field: "p1", keys: ["p1", "parametro 1"] },
  { field: "p2", keys: ["p2", "parametro 2"] },
  { field: "p3", keys: ["p3", "parametro 3"] },
  { field: "p4", keys: ["p4", "parametro 4"] },
  { field: "p5", keys: ["p5", "parametro 5"] },
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
  for (const k of keys) {
    const i = headers.findIndex((h) => ` ${h} `.includes(` ${k}
