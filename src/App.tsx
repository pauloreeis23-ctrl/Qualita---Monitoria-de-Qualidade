import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =====================================================================
   TIPOS
   ===================================================================== */

type Person = { id: number; name: string; team: string; initials: string; color: string };

type Monitoria = {
  id: string;
  date: number | null; // timestamp (início do dia) ou null se a planilha não tiver data
  week: string;
  consultor: string;
  categoria: string;
  ticket: string;
  csat: string;
  resolvida: string;
  nota: number; // sempre na escala 0 a 100
  team: string; // vem da planilha, se existir coluna de time
};

type AgentRow = Person & { audits: number; score: number; trend: number | null };

type Block = { id: number; name: string; weight: number; desc: string };

type Config = { profile: string; minScore: number; targetAudits: number };

type FieldMapping = { field: string; label: string; header: string | null };

type SheetState = {
  status: "demo" | "loading" | "ok" | "error";
  records: Monitoria[];
  message: string;
  syncedAt: number | null;
  skipped: number;
  scaleNote: string;
  mapping: FieldMapping[];
};

/* =====================================================================
   CONSTANTES
   ===================================================================== */

const DAY = 86400000;
const NO_TEAM = "Sem time";
const ALL_TEAMS = "Todos os times";
const ALL_CONSULTANTS = "Todos os consultores";

const PALETTE = ["#826be0", "#61c5b2", "#e5a45c", "#5ea3e0", "#d46a8a", "#b86bd1", "#4fa3a5", "#d9776a"];

const PERIODS: Record<string, number | null> = {
  "Últimos 7 dias": 7,
  "Últimos 15 dias": 15,
  "Últimos 30 dias": 30,
  "Últimos 90 dias": 90,
  "Todo o período": null,
};

/* Link da planilha definido no Vercel (Settings > Environment Variables > VITE_SHEET_CSV_URL) */
const ENV_URL: string = (((import.meta as any).env?.VITE_SHEET_CSV_URL as string | undefined) ?? "").trim();

const DEFAULT_BLOCKS: Block[] = [
  { id: 1, name: "Empatia e Conexão com o Cliente", weight: 35, desc: "Avalia clareza, tom de voz e escuta ativa." },
  { id: 2, name: "Resolução Técnica e Processual", weight: 40, desc: "Verifica acurácia das informações e uso correto dos sistemas." },
  { id: 3, name: "Protocolo e Compliance (LGPD)", weight: 25, desc: "Checa cumprimento de normas de segurança e sigilo." },
];

const DEFAULT_CONFIG: Config = { profile: "Atendimento / SAC", minScore: 85, targetAudits: 12 };

/* Perfis de exemplo. Ajuste os valores conforme a realidade da sua operação. */
const MARKET_PROFILES: Record<
  string,
  { description: string; minScore: number; targetAudits: number; blocks: Omit<Block, "id">[] }
> = {
  "Atendimento / SAC": {
    description: "Foco em empatia, resolução no primeiro contato e conformidade.",
    minScore: 85,
    targetAudits: 12,
    blocks: [
      { name: "Empatia e Conexão com o Cliente", weight: 35, desc: "Avalia clareza, tom de voz e escuta ativa." },
      { name: "Resolução Técnica e Processual", weight: 40, desc: "Verifica acurácia das informações e uso dos sistemas." },
      { name: "Protocolo e Compliance (LGPD)", weight: 25, desc: "Checa cumprimento de normas de segurança e sigilo." },
    ],
  },
  "Vendas e Relacionamento": {
    description: "Foco em abordagem, negociação e acompanhamento do cliente.",
    minScore: 80,
    targetAudits: 10,
    blocks: [
      { name: "Abordagem e Diagnóstico", weight: 30, desc: "Qualidade das perguntas e entendimento da necessidade." },
      { name: "Negociação e Argumentação", weight: 40, desc: "Apresentação de valor e contorno de objeções." },
      { name: "Fechamento e Follow-up", weight: 30, desc: "Condução ao fechamento e próximos passos combinados." },
    ],
  },
  "Cobrança e Recuperação": {
    description: "Foco em conformidade legal, negociação e comunicação respeitosa.",
    minScore: 88,
    targetAudits: 15,
    blocks: [
      { name: "Conformidade Legal e Regulatória", weight: 45, desc: "Cumprimento de normas de cobrança e LGPD." },
      { name: "Negociação e Acordo", weight: 35, desc: "Proposta adequada e registro correto do acordo." },
      { name: "Comunicação e Postura", weight: 20, desc: "Tom respeitoso e clareza das informações." },
    ],
  },
  "Suporte Técnico": {
    description: "Foco em diagnóstico, aderência ao processo e comunicação técnica.",
    minScore: 85,
    targetAudits: 12,
    blocks: [
      { name: "Diagnóstico e Solução", weight: 45, desc: "Identificação correta da causa e solução aplicada." },
      { name: "Aderência ao Processo", weight: 30, desc: "Registro, escalonamento e uso da base de conhecimento." },
      { name: "Comunicação Técnica", weight: 25, desc: "Clareza das orientações passadas ao cliente." },
    ],
  },
};

/* =====================================================================
   UTILITÁRIOS
   ===================================================================== */

const norm = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");

const normHeader = (s: string) => norm(s).replace(/[^a-z0-9]+/g, " ").trim();

const initialsOf = (name: string) =>
  name.trim().split(/\s+/).map((n) => n[0] ?? "").join("").slice(0, 2).toUpperCase();

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const fmt = (n: number, digits = 1) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtDate = (t: number) => new Date(t).toLocaleDateString("pt-BR");

const fmtTime = (t: number) => new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const avg = (list: number[]) => (list.length ? list.reduce((a, b) => a + b, 0) / list.length : 0);

function hashStr(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function weekLabel(date: number) {
  const d = new Date(date);
  const monday = date - ((d.getDay() + 6) % 7) * DAY;
  const short = (t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${short(monday)} a ${short(monday + 4 * DAY)}`;
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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* armazenamento indisponível: segue sem persistir */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/* =====================================================================
   LEITURA DO GOOGLE SHEETS (CSV)
   ===================================================================== */

/* Aceita o link "Publicar na web" (CSV) ou o link normal da planilha (precisa estar como "qualquer pessoa com o link") */
function resolveSheetUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return "";
  if (/\/spreadsheets\/d\/e\//.test(url)) {
    url = url.replace("/pubhtml", "/pub");
    if (!/output=csv/.test(url)) url += (url.includes("?") ? "&" : "?") + "output=csv";
    return url;
  }
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) {
    const gid = url.match(/[#?&]gid=(\d+)/)?.[1];
    return `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv${gid ? `&gid=${gid}` : ""}`;
  }
  return url;
}

function parseCSV(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const delim = semicolons > commas ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const FIELDS = [
  { field: "consultor", label: "Consultor(a)", keys: ["consultor", "analista", "atendente", "agente", "colaborador"] },
  { field: "nota", label: "Nota final", keys: ["nota final", "nota geral", "nota", "pontuacao", "score"] },
  { field: "data", label: "Data", keys: ["data"] },
  { field: "semana", label: "Semana", keys: ["semana"] },
  { field: "categoria", label: "Categoria", keys: ["categoria", "fila", "assunto"] },
  { field: "ticket", label: "ID do ticket", keys: ["id ticket", "ticket", "protocolo", "chamado"] },
  { field: "csat", label: "Status CSAT", keys: ["status csat", "csat"] },
  { field: "resolvida", label: "Resolvida?", keys: ["resolvida", "resolvido", "resolucao"] },
  { field: "time", label: "Time / Equipe", keys: ["time", "equipe"] },
] as const;

function findCol(headers: string[], keys: readonly string[]): number {
  for (const k of keys) {
    const exact = headers.indexOf(k);
    if (exact >= 0) return exact;
  }
  for (const k of keys) {
    const i = headers.findIndex((h) => ` ${h} `.includes(` ${k} `));
    if (i >= 0) return i;
  }
  return -1;
}

function parseNumber(value: string): number {
  let s = value.trim().replace("%", "").replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (s.includes(",")) s = s.replace(",", ".");
  return Number(s);
}

function parseDateCell(value: string): number | null {
  const s = value.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]).getTime();
  m = s.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const day = +m[1];
  const month = +m[2];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  let year: number;
  if (m[3]) {
    year = +m[3];
    if (year < 100) year += 2000;
  } else {
    const now = Date.now();
    year = new Date(now).getFullYear();
    if (new Date(year, month - 1, day).getTime() > now + 7 * DAY) year -= 1;
  }
  return new Date(year, month - 1, day).getTime();
}

function recordsFromCSV(text: string) {
  const rows = parseCSV(text);

  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const h = rows[i].map(normHeader);
    if (findCol(h, FIELDS[0].keys) >= 0 && findCol(h, FIELDS[1].keys) >= 0) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      `Não encontrei as colunas de consultor e de nota. Cabeçalhos lidos na primeira linha: ${
        (rows[0] ?? []).filter((c) => c.trim()).join(" | ") || "(vazio)"
      }`
    );
  }

  const rawHeaders = rows[headerIdx];
  const headers = rawHeaders.map(normHeader);
  const idx: Record<string, number> = {};
  const mapping: FieldMapping[] = FIELDS.map((f) => {
    const c = findCol(headers, f.keys);
    idx[f.field] = c;
    return { field: f.field, label: f.label, header: c >= 0 ? rawHeaders[c].trim() : null };
  });

  type Raw = Omit<Monitoria, "nota"> & { nota: number };
  const raw: Raw[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
    const consultor = get(idx.consultor);
    const nota = parseNumber(get(idx.nota));
    if (!consultor || Number.isNaN(nota)) {
      skipped++;
      continue;
    }
    const semana = get(idx.semana);
    const date = parseDateCell(get(idx.data)) ?? parseDateCell(semana);
    raw.push({
      id: `r${i}`,
      date: date === null ? null : startOfDay(date),
      week: semana || (date !== null ? weekLabel(date) : ""),
      consultor,
      categoria: get(idx.categoria),
      ticket: get(idx.ticket).replace(/^#/, ""),
      csat: get(idx.csat),
      resolvida: get(idx.resolvida),
      nota,
      team: get(idx.time),
    });
  }

  if (raw.length === 0) {
    throw new Error("Encontrei as colunas, mas nenhuma linha tem consultor e nota válidos.");
  }

  const max = Math.max(...raw.map((x) => x.nota));
  const factor = max <= 1 ? 100 : max <= 10 ? 10 : 1;
  const scaleNote =
    factor === 1 ? "" : `Notas na escala de 0 a ${factor === 100 ? "1" : "10"} foram convertidas para 0 a 100.`;
  const records: Monitoria[] = raw.map((x) => ({ ...x, nota: Math.round(x.nota * factor * 10) / 10 }));

  return { records, skipped, scaleNote, mapping };
}

/* =====================================================================
   DADOS DE DEMONSTRAÇÃO (usados só enquanto nenhuma planilha estiver conectada)
   ===================================================================== */

const DEMO_TEAMS = ["Equipe Safira", "Equipe Esmeralda", "Equipe Rubi"];

const DEMO_DEFS = [
  { name: "Marina Costa", team: "Equipe Safira", base: 96, volume: 16, drift: 0.05 },
  { name: "Rafael Martins", team: "Equipe Safira", base: 94, volume: 15, drift: 0.04 },
  { name: "Ana Carolina", team: "Equipe Esmeralda", base: 91.5, volume: 14, drift: 0.02 },
  { name: "Carlos Lima", team: "Equipe Esmeralda", base: 87, volume: 12, drift: 0.03 },
  { name: "Bianca Oliveira", team: "Equipe Safira", base: 84.5, volume: 11, drift: 0.03 },
  { name: "Diego Freitas", team: "Equipe Esmeralda", base: 78.5, volume: 10, drift: -0.06 },
  { name: "Juliana Alves", team: "Equipe Rubi", base: 93, volume: 10, drift: 0.07 },
];

const DEMO_PEOPLE: Person[] = DEMO_DEFS.map((d, i) => ({
  id: i + 1,
  name: d.name,
  team: d.team,
  initials: initialsOf(d.name),
  color: PALETTE[i % PALETTE.length],
}));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildDemoRecords(): Monitoria[] {
  const rand = mulberry32(2026);
  const today = startOfDay(Date.now());
  const categories = ["Suporte Operacional", "Suporte Técnico", "eSocial", "Admissão Digital"];
  const out: Monitoria[] = [];
  DEMO_DEFS.forEach((d) => {
    const count = d.volume * 3;
    for (let k = 0; k < count; k++) {
      const offset = Math.floor(rand() * 90);
      const date = today - offset * DAY;
      const nota = clamp(Math.round((d.base + (rand() - 0.5) * 12 + (45 - offset) * d.drift) * 10) / 10, 40, 100);
      out.push({
        id: `d${out.length}`,
        date,
        week: weekLabel(date),
        consultor: d.name,
        categoria: categories[Math.floor(rand() * categories.length)],
        ticket: String(650000 + Math.floor(rand() * 20000)),
        csat: rand() < 0.8 ? "Respondido" : "Não respondido",
        resolvida: nota >= 85 ? (rand() < 0.92 ? "Sim" : "Não") : rand() < 0.5 ? "Sim" : "Não",
        nota,
        team: d.team,
      });
    }
  });
  return out;
}

const DEMO_STATE: SheetState = {
  status: "demo",
  records: buildDemoRecords(),
  message: "",
  syncedAt: null,
  skipped: 0,
  scaleNote: "",
  mapping: [],
};

/* =====================================================================
   HOOK DA PLANILHA
   ===================================================================== */

function useSheet(url: string) {
  const [state, setState] = useState<SheetState>(
    url ? { ...DEMO_STATE, status: "loading", records: [] } : DEMO_STATE
  );
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    if (!url) {
      setState(DEMO_STATE);
      return;
    }
    setState((s) => ({ ...s, status: "loading", message: "", records: s.status === "ok" ? s.records : [] }));
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        throw new Error(
          `O Google respondeu com erro ${res.status}. Confira se a planilha está publicada na web ou compartilhada como “qualquer pessoa com o link”.`
        );
      }
      const text = await res.text();
      if (/^\s*<(!doctype|html)/i.test(text)) {
        throw new Error(
          "O link devolveu uma página (login) em vez dos dados. Publique a planilha na web em formato CSV ou compartilhe como “qualquer pessoa com o link”."
        );
      }
      const result = recordsFromCSV(text);
      if (id !== requestId.current) return;
      setState({
        status: "ok",
        records: result.records,
        message: "",
        syncedAt: Date.now(),
        skipped: result.skipped,
        scaleNote: result.scaleNote,
        mapping: result.mapping,
      });
    } catch (err) {
      if (id !== requestId.current) return;
      const message =
        err instanceof TypeError
          ? "Não foi possível acessar a planilha (permissão ou bloqueio de rede). Confirme que ela está publicada na web em formato CSV."
          : err instanceof Error
          ? err.message
          : "Erro desconhecido ao ler a planilha.";
      setState((s) => ({ ...s, status: "error", message }));
    }
  }, [url]);

  useEffect(() => {
    load();
  }, [load]);

  return [state, load] as const;
}

/* =====================================================================
   CÁLCULOS
   ===================================================================== */

function buildPeople(registered: Person[], records: Monitoria[]): Person[] {
  /* Se o mesmo nome aparecer duas vezes, o cadastro mais recente (último da lista) vence */
  const known = new Map<string, Person>();
  registered.forEach((p) => known.set(norm(p.name), p));
  records.forEach((r) => {
    const key = norm(r.consultor);
    if (!known.has(key)) {
      known.set(key, {
        id: -(hashStr(key) + 1),
        name: r.consultor,
        team: r.team || NO_TEAM,
        initials: initialsOf(r.consultor),
        color: PALETTE[known.size % PALETTE.length],
      });
    }
  });
  return Array.from(known.values());
}

function buildTeamList(teams: string[], people: Person[]): string[] {
  const set = new Set<string>(teams);
  people.forEach((p) => {
    if (p.team !== NO_TEAM) set.add(p.team);
  });
  const list = Array.from(set);
  if (people.some((p) => p.team === NO_TEAM)) list.push(NO_TEAM);
  return list;
}

function pushTo(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function computeRows(people: Person[], records: Monitoria[], days: number | null, now: number): AgentRow[] {
  const curFrom = days === null ? -Infinity : now - days * DAY;
  const prevFrom = days === null ? -Infinity : now - 2 * days * DAY;
  const cur = new Map<string, number[]>();
  const prev = new Map<string, number[]>();

  records.forEach((r) => {
    const key = norm(r.consultor);
    const inCurrent = days === null || r.date === null || r.date >= curFrom;
    const inPrevious = days !== null && r.date !== null && r.date >= prevFrom && r.date < curFrom;
    if (inCurrent) pushTo(cur, key, r.nota);
    else if (inPrevious) pushTo(prev, key, r.nota);
  });

  return people.map((p) => {
    const c = cur.get(norm(p.name)) ?? [];
    const pr = prev.get(norm(p.name)) ?? [];
    const score = avg(c);
    const prevScore = avg(pr);
    return {
      ...p,
      audits: c.length,
      score,
      trend: c.length && pr.length && prevScore ? ((score - prevScore) / prevScore) * 100 : null,
    };
  });
}

function weightedScore(rows: AgentRow[]) {
  const total = rows.reduce((sum, r) => sum + r.audits, 0);
  return total ? rows.reduce((sum, r) => sum + r.score * r.audits, 0) / total : 0;
}

const isYes = (v: string) => ["sim", "s", "yes", "y", "true", "1", "resolvido", "resolvida"].includes(norm(v));
const isResponded = (v: string) => norm(v).startsWith("respondid");

function rateOf(list: Monitoria[], field: "resolvida" | "csat", test: (v: string) => boolean): number | null {
  const filled = list.filter((r) => r[field].trim());
  return filled.length ? (filled.filter((r) => test(r[field])).length / filled.length) * 100 : null;
}

/* =====================================================================
   COMPONENTES BASE
   ===================================================================== */

function Icon({ size = 18 }: { size?: number }) {
  return <span style={{ fontSize: size, lineHeight: 1, display: "inline-flex" }}>✦</span>;
}

function Dropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dropdown">
      <button className="filter" onClick={() => setOpen(!open)}>
        <span>{label}</span>
        <strong>{value} ▾</strong>
      </button>
      {open && (
        <>
          <div className="dropdown-backdrop" onClick={() => setOpen(false)} />
          <div className="dropdown-menu">
            {options.map((option) => (
              <div
                key={option}
                className={option === value ? "selected" : ""}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
              >
                {option}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={t.id === value ? "active" : ""} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

function Delta({ value, lowerIsBetter = false, unit = "%" }: { value: number | null; lowerIsBetter?: boolean; unit?: string }) {
  if (value === null) return <span className="muted-text">—</span>;
  const good = lowerIsBetter ? value <= 0 : value >= 0;
  return (
    <span className={good ? "positive" : "negative"}>
      {value >= 0 ? "+" : "-"}
      {fmt(Math.abs(value))}
      {unit}
    </span>
  );
}

function Sidebar({ page, setPage }: { page: string; setPage: (val: string) => void }) {
  const items = [
    ["dashboard", "Dashboard"],
    ["monitorias", "Monitorias"],
    ["parameters", "Parâmetros"],
    ["team", "Equipe"],
    ["reports", "Relatórios"],
  ];
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo-mark">Q</div>
        <div>
          <strong>Qualitá</strong>
          <span>MONITORIA</span>
        </div>
      </div>
      <nav>
        <p className="nav-label">MONITORIA</p>
        {items.map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
            <Icon size={19} /> {label}
          </button>
        ))}
        <p className="nav-label second">GESTÃO</p>
        <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
          <Icon size={19} /> Configurações
        </button>
      </nav>
      <div className="sidebar-help">
        <span className="help-icon">?</span>
        <div>
          <strong>Suporte Qualitá</strong>
          <span>Central de atendimento</span>
        </div>
      </div>
    </aside>
  );
}

function Header({ page }: { page: string }) {
  const pages: Record<string, [string, string]> = {
    dashboard: ["Dashboard gerencial", "Acompanhe o desempenho da sua operação em tempo real."],
    monitorias: ["Base de monitorias", "Registros lidos da planilha que alimenta toda a ferramenta."],
    parameters: ["Construtor de parâmetros", "Defina os critérios da avaliação e quanto cada um pesa na nota final."],
    team: ["Gestão de equipe", "Cadastre times e colaboradores e acompanhe os indicadores de cada um."],
    reports: ["Relatórios analíticos", "Explore tendências e consolidados da operação."],
    settings: ["Configurações e Governança", "Fonte de dados, perfis de mercado e metas."],
  };
  const [title, description] = pages[page] ?? pages.dashboard;
  return (
    <header className="topbar">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="user-profile">
        <span className="avatar">PR</span>
        <div>
          <strong>Paulo Reis</strong>
          <small>Gestor de Qualidade</small>
        </div>
      </div>
    </header>
  );
}

function SourceBanner({
  sheet,
  reload,
  goSettings,
}: {
  sheet: SheetState;
  reload: () => void;
  goSettings: () => void;
}) {
  if (sheet.status === "demo") {
    return (
      <div className="notice info source-banner">
        <span>
          <strong>Modo demonstração:</strong> os números abaixo são fictícios. Conecte a sua planilha para ver os dados reais.
        </span>
        <button className="secondary-button" onClick={goSettings}>Conectar planilha</button>
      </div>
    );
  }
  if (sheet.status === "loading") {
    return <div className="notice info source-banner">Carregando dados da planilha…</div>;
  }
  if (sheet.status === "error") {
    return (
      <div className="notice source-banner">
        <span><strong>Não consegui ler a planilha.</strong> {sheet.message}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="secondary-button" onClick={reload}>Tentar de novo</button>
          <button className="secondary-button" onClick={goSettings}>Ver configurações</button>
        </span>
      </div>
    );
  }
  return (
    <div className="notice success source-banner">
      <span>
        <strong>Planilha conectada:</strong> {sheet.records.length.toLocaleString("pt-BR")} monitorias
        {sheet.syncedAt ? ` · atualizado às ${fmtTime(sheet.syncedAt)}` : ""}
        {sheet.skipped > 0 ? ` · ${sheet.skipped} linhas ignoradas (sem consultor ou nota)` : ""}
        {sheet.scaleNote ? ` · ${sheet.scaleNote}` : ""}
      </span>
      <button className="secondary-button" onClick={reload}>Atualizar</button>
    </div>
  );
}

/* =====================================================================
   DASHBOARD
   ===================================================================== */

function Dashboard({
  people,
  records,
  teamList,
  config,
  openAudit,
}: {
  people: Person[];
  records: Monitoria[];
  teamList: string[];
  config: Config;
  openAudit: (person?: Person) => void;
}) {
  const [period, setPeriod] = useState("Últimos 30 dias");
  const [team, setTeam] = useState(ALL_TEAMS);
  const [consultant, setConsultant] = useState(ALL_CONSULTANTS);

  const days = PERIODS[period];
  const now = Date.now();
  const curFrom = days === null ? -Infinity : now - days * DAY;
  const prevFrom = days === null ? -Infinity : now - 2 * days * DAY;

  const teamOf = new Map(people.map((p) => [norm(p.name), p.team]));
  const matches = (r: Monitoria) =>
    (team === ALL_TEAMS || (teamOf.get(norm(r.consultor)) ?? NO_TEAM) === team) &&
    (consultant === ALL_CONSULTANTS || norm(r.consultor) === norm(consultant));

  const current = records.filter((r) => matches(r) && (days === null || r.date === null || r.date >= curFrom));
  const previous =
    days === null
      ? []
      : records.filter((r) => matches(r) && r.date !== null && r.date >= prevFrom && r.date < curFrom);

  const stats = (list: Monitoria[]) => ({
    count: list.length,
    score: avg(list.map((r) => r.nota)),
    dev: list.length ? (list.filter((r) => r.nota < config.minScore).length / list.length) * 100 : 0,
  });
  const cur = stats(current);
  const prev = stats(previous);
  const pct = (c: number, p: number) => (p ? ((c - p) / p) * 100 : null);
  const hasPrev = previous.length > 0;

  const consultantOptions = [
    ALL_CONSULTANTS,
    ...people
      .filter((p) => team === ALL_TEAMS || p.team === team)
      .map((p) => p.name)
      .sort((a, b) => a.localeCompare(b, "pt-BR")),
  ];

  const rows = computeRows(
    people.filter((p) => (team === ALL_TEAMS || p.team === team) && (consultant === ALL_CONSULTANTS || p.name === consultant)),
    records,
    days,
    now
  )
    .filter((r) => r.audits > 0)
    .sort((a, b) => b.score - a.score);

  const dated = records.filter((r) => r.date !== null).map((r) => r.date as number);
  const lastDate = dated.length ? Math.max(...dated) : null;

  const clearFilters = () => {
    setPeriod("Últimos 30 dias");
    setTeam(ALL_TEAMS);
    setConsultant(ALL_CONSULTANTS);
  };

  return (
    <main className="content">
      <section className="filterbar">
        <div className="filters">
          <Dropdown label="PERÍODO" value={period} options={Object.keys(PERIODS)} onChange={setPeriod} />
          <Dropdown
            label="TIME"
            value={team}
            options={[ALL_TEAMS, ...teamList]}
            onChange={(value) => {
              setTeam(value);
              setConsultant(ALL_CONSULTANTS);
            }}
          />
          <Dropdown label="CONSULTORES" value={consultant} options={consultantOptions} onChange={setConsultant} />
        </div>
        <button className="secondary-button" onClick={clearFilters}>Limpar filtros</button>
      </section>

      {current.length === 0 && records.length > 0 && (
        <div className="notice">
          Nenhuma monitoria encontrada com esses filtros.
          {lastDate !== null && ` A última monitoria com data na planilha é de ${fmtDate(lastDate)}.`} Experimente o período
          “Todo o período”.
        </div>
      )}

      <section className="kpis">
        <article className="kpi-card" onClick={() => openAudit()} style={{ cursor: "pointer" }}>
          <div className="kpi-header">
            <small>NOTA MÉDIA GERAL</small>
            <Delta value={hasPrev ? pct(cur.score, prev.score) : null} />
          </div>
          <div className="kpi-body"><strong>{fmt(cur.score)}</strong><span>/ 100</span></div>
          <p>{hasPrev ? `vs. ${fmt(prev.score)} no período anterior` : "sem período anterior para comparar"}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>MONITORIAS REALIZADAS</small>
            <Delta value={hasPrev ? pct(cur.count, prev.count) : null} />
          </div>
          <div className="kpi-body"><strong>{cur.count.toLocaleString("pt-BR")}</strong></div>
          <p>{hasPrev ? `vs. ${prev.count.toLocaleString("pt-BR")} no período anterior` : period.toLowerCase()}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>TAXA DE DESVIOS</small>
            <Delta value={hasPrev ? cur.dev - prev.dev : null} lowerIsBetter unit=" p.p." />
          </div>
          <div className="kpi-body"><strong>{fmt(cur.dev)}%</strong></div>
          <p>monitorias abaixo de {config.minScore} pontos</p>
        </article>
      </section>

      <section className="panel ranking-panel">
        <div className="panel-heading">
          <div>
            <h3>Ranking da equipe</h3>
            <p>Desempenho dos consultores no período selecionado</p>
          </div>
          <button className="secondary-button" onClick={() => openAudit()}>Ver monitorias</button>
        </div>
        {rows.length === 0 ? (
          <p className="empty">Nenhum consultor com monitorias para os filtros selecionados.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>CONSULTOR</th>
                  <th>TIME</th>
                  <th>MONITORIAS</th>
                  <th>NOTA MÉDIA</th>
                  <th>EVOLUÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={row.id} onClick={() => openAudit(row)} style={{ cursor: "pointer" }}>
                    <td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
                    <td>
                      <div className="agent">
                        <span className="avatar" style={{ background: row.color }}>{row.initials}</span>
                        <strong>{row.name}</strong>
                      </div>
                    </td>
                    <td>{row.team}</td>
                    <td>{row.audits}</td>
                    <td>
                      <strong className={row.score < config.minScore ? "negative" : ""}>{fmt(row.score)}</strong> / 100
                    </td>
                    <td><Delta value={row.trend} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

/* =====================================================================
   MONITORIAS (tabela da planilha)
   ===================================================================== */

function Monitorias({ records, config }: { records: Monitoria[]; config: Config }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("Todo o período");
  const [limit, setLimit] = useState(100);

  const days = PERIODS[period];
  const now = Date.now();
  const q = norm(search);

  const list = records
    .filter((r) => days === null || r.date === null || r.date >= now - days * DAY)
    .filter((r) => !q || norm(`${r.consultor} ${r.ticket} ${r.categoria}`).includes(q))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  return (
    <main className="content">
      <div className="page-actions" style={{ marginBottom: 16 }}>
        <div className="filters">
          <Dropdown label="PERÍODO" value={period} options={Object.keys(PERIODS)} onChange={(v) => { setPeriod(v); setLimit(100); }} />
          <input
            className="input search"
            placeholder="Buscar consultor, ticket ou categoria"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setLimit(100); }}
          />
        </div>
        <span className="muted-text">{list.length.toLocaleString("pt-BR")} monitorias</span>
      </div>

      <div className="panel">
        {list.length === 0 ? (
          <p className="empty">Nenhuma monitoria encontrada.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>SEMANA</th>
                    <th>CONSULTOR(A)</th>
                    <th>CATEGORIA</th>
                    <th>ID TICKET</th>
                    <th>STATUS CSAT</th>
                    <th>RESOLVIDA?</th>
                    <th>NOTA FINAL</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, limit).map((m) => (
                    <tr key={m.id}>
                      <td>{m.week || "—"}</td>
                      <td><strong>{m.consultor}</strong></td>
                      <td>{m.categoria || "—"}</td>
                      <td>{m.ticket ? <span className="ticket">#{m.ticket}</span> : "—"}</td>
                      <td>{m.csat || "—"}</td>
                      <td>{m.resolvida || "—"}</td>
                      <td>
                        <strong className={m.nota < config.minScore ? "negative" : ""}>{fmt(m.nota)}</strong> / 100
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > limit && (
              <div style={{ textAlign: "center", marginTop: 16 }}>
                <button className="secondary-button" onClick={() => setLimit(limit + 100)}>
                  Mostrar mais ({list.length - limit} restantes)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

/* =====================================================================
   PARÂMETROS
   ===================================================================== */

const BLOCK_COLORS = PALETTE;

function Parameters({
  blocks,
  setBlocks,
  config,
}: {
  blocks: Block[];
  setBlocks: (blocks: Block[]) => void;
  config: Config;
}) {
  const [tab, setTab] = useState<"edit" | "sim">("edit");
  const [selectedId, setSelectedId] = useState<number | null>(blocks[0]?.id ?? null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [samples, setSamples] = useState<Record<number, number>>({});

  const total = blocks.reduce((sum, b) => sum + b.weight, 0);
  const diff = 100 - total;
  const isValid = diff === 0;
  const selected = blocks.find((b) => b.id === selectedId) ?? blocks[0] ?? null;
  const colorOf = (id: number) => {
    const index = blocks.findIndex((b) => b.id === id);
    return BLOCK_COLORS[(index < 0 ? 0 : index) % BLOCK_COLORS.length];
  };

  const update = (id: number, patch: Partial<Block>) =>
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));

  const addBlock = () => {
    const block: Block = {
      id: Date.now(),
      name: "Novo bloco de avaliação",
      weight: Math.max(0, diff),
      desc: "Descreva o que este bloco avalia.",
    };
    setBlocks([...blocks, block]);
    setSelectedId(block.id);
    setConfirmRemove(false);
    setTab("edit");
  };

  const removeBlock = (id: number) => {
    const remaining = blocks.filter((b) => b.id !== id);
    setBlocks(remaining);
    setSelectedId(remaining[0]?.id ?? null);
    setConfirmRemove(false);
  };

  const normalize = () => {
    if (!total) return;
    let accumulated = 0;
    setBlocks(
      blocks.map((b, i) => {
        if (i === blocks.length - 1) return { ...b, weight: Math.max(0, 100 - accumulated) };
        const w = Math.round((b.weight / total) * 100);
        accumulated += w;
        return { ...b, weight: w };
      })
    );
  };

  const sampleOf = (id: number) => samples[id] ?? 90;
  const finalScore = total ? blocks.reduce((sum, b) => sum + sampleOf(b.id) * b.weight, 0) / total : 0;

  const statusText = isValid
    ? "Distribuição completa: os pesos somam 100%."
    : diff > 0
    ? `Faltam ${diff}% para completar 100%.`
    : `Os pesos excedem 100% em ${Math.abs(diff)}%.`;

  return (
    <main className="content parameters-page">
      <Tabs
        tabs={[
          { id: "edit", label: "Blocos e pesos" },
          { id: "sim", label: "Simulador de nota" },
        ]}
        value={tab}
        onChange={setTab}
      />

      <div className="panel">
        <div className="page-actions">
          <div>
            <h3>Distribuição dos pesos</h3>
            <p className="muted">{statusText}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!isValid && blocks.length > 0 && (
              <button className="secondary-button" onClick={normalize}>Ajustar proporcionalmente</button>
            )}
            <div className={`badge ${isValid ? "ok" : "warn"}`}>Total: {total}%</div>
          </div>
        </div>
        <div className="stack-bar">
          {blocks.map((b) => (
            <div
              key={b.id}
              className="stack-seg"
              title={`${b.name}: ${b.weight}%`}
              style={{ width: `${(b.weight / Math.max(total, 100)) * 100}%`, background: colorOf(b.id) }}
            />
          ))}
        </div>
        <div className="legend">
          {blocks.map((b) => (
            <span key={b.id}>
              <i className="dot" style={{ background: colorOf(b.id) }} /> {b.name} ({b.weight}%)
            </span>
          ))}
        </div>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          Observação: a nota final dos dashboards vem da coluna de nota da planilha. Estes pesos servem para definir o modelo de avaliação e para o simulador.
        </p>
      </div>

      {tab === "edit" && (
        <div className="param-layout">
          <div className="panel">
            <div className="page-actions" style={{ marginBottom: 14 }}>
              <h3>Blocos ({blocks.length})</h3>
              <button className="primary-button" onClick={addBlock}>+ Novo bloco</button>
            </div>
            <div className="block-items">
              {blocks.map((b, index) => (
                <button
                  key={b.id}
                  className={`block-item ${selected && selected.id === b.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedId(b.id);
                    setConfirmRemove(false);
                  }}
                >
                  <div className="block-item-top">
                    <span>
                      <i className="dot" style={{ background: colorOf(b.id) }} /> {index + 1}. {b.name}
                    </span>
                    <strong>{b.weight}%</strong>
                  </div>
                  <div className="mini-bar">
                    <div style={{ width: `${clamp(b.weight, 0, 100)}%`, background: colorOf(b.id) }} />
                  </div>
                </button>
              ))}
              {blocks.length === 0 && <p className="empty">Nenhum bloco ainda. Clique em “+ Novo bloco”.</p>}
            </div>
          </div>

          <div className="panel">
            {!selected ? (
              <p className="empty">Selecione ou crie um bloco para editar.</p>
            ) : (
              <>
                <div className="page-actions">
                  <div>
                    <h3>Editar bloco</h3>
                    <p className="muted">As alterações são salvas automaticamente.</p>
                  </div>
                  {confirmRemove ? (
                    <div style={{ display: "flex", gap: 8 }}>
                      <button className="secondary-button" onClick={() => setConfirmRemove(false)}>Cancelar</button>
                      <button className="danger-button" onClick={() => removeBlock(selected.id)}>Confirmar remoção</button>
                    </div>
                  ) : (
                    <button className="danger-button" onClick={() => setConfirmRemove(true)}>Remover bloco</button>
                  )}
                </div>

                <div className="editor-section">
                  <div className="editor-title">1. IDENTIFICAÇÃO</div>
                  <label className="field-label" style={{ marginTop: 12 }}>NOME DO BLOCO</label>
                  <input className="input" value={selected.name} onChange={(e) => update(selected.id, { name: e.target.value })} />
                  <label className="field-label" style={{ marginTop: 14 }}>O QUE ESTE BLOCO AVALIA</label>
                  <textarea
                    className="input"
                    rows={3}
                    value={selected.desc}
                    onChange={(e) => update(selected.id, { desc: e.target.value })}
                  />
                </div>

                <div className="editor-section">
                  <div className="editor-title">2. PESO NA NOTA FINAL</div>
                  <div className="weight-row">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={selected.weight}
                      onChange={(e) => update(selected.id, { weight: Number(e.target.value) })}
                    />
                    <div className="weight-input">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={100}
                        value={selected.weight}
                        onChange={(e) => update(selected.id, { weight: clamp(Number(e.target.value) || 0, 0, 100) })}
                      />
                      <span>%</span>
                    </div>
                  </div>
                  <p className="muted" style={{ fontSize: 13 }}>
                    Este bloco representa{" "}
                    <strong style={{ color: "var(--text)" }}>{fmt(total ? (selected.weight / total) * 100 : 0, 0)}%</strong>{" "}
                    da nota final.
                    {!isValid && " (Calculado sobre a soma atual dos pesos.)"}
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {tab === "sim" && (
        <div className="panel" style={{ marginTop: 20 }}>
          <h3>Simulador de nota final</h3>
          <p className="muted">Informe uma nota de 0 a 100 para cada bloco e veja o resultado ponderado pelos pesos definidos.</p>
          <div className="sim-grid">
            {blocks.map((b) => (
              <div key={b.id} className="sim-item">
                <span>
                  <i className="dot" style={{ background: colorOf(b.id) }} /> {b.name}{" "}
                  <small className="muted">({b.weight}%)</small>
                </span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={100}
                  value={sampleOf(b.id)}
                  onChange={(e) => setSamples({ ...samples, [b.id]: clamp(Number(e.target.value) || 0, 0, 100) })}
                />
              </div>
            ))}
          </div>
          <div className="sim-result">
            <span>Nota final ponderada</span>
            <strong>{fmt(finalScore)} / 100</strong>
            <span className={finalScore >= config.minScore ? "positive" : "negative"}>
              {finalScore >= config.minScore ? "Acima" : "Abaixo"} da nota mínima ({config.minScore})
            </span>
          </div>
          <p className="muted" style={{ fontSize: 12 }}>
            Fórmula: soma de (nota do bloco × peso) ÷ soma dos pesos. Se os pesos não somarem 100%, o resultado é normalizado automaticamente.
          </p>
        </div>
      )}
    </main>
  );
}

/* =====================================================================
   EQUIPE (Times + Colaboradores)
   ===================================================================== */

function Team({
  people,
  records,
  teams,
  teamList,
  setTeams,
  assignTeam,
  openAudit,
}: {
  people: Person[];
  records: Monitoria[];
  teams: string[];
  teamList: string[];
  setTeams: (teams: string[]) => void;
  assignTeam: (name: string, team: string) => void;
  openAudit: (person?: Person) => void;
}) {
  const [view, setView] = useState<"teams" | "people">("teams");
  const [modal, setModal] = useState<"none" | "team" | "person">("none");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [success, setSuccess] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [personName, setPersonName] = useState("");
  const [personTeam, setPersonTeam] = useState(NO_TEAM);
  const [error, setError] = useState("");

  const rows = computeRows(people, records, null, Date.now());
  const realTeams = teamList.filter((t) => t !== NO_TEAM);

  const closeModal = () => {
    setModal("none");
    setError("");
    setTeamName("");
    setPersonName("");
  };

  const addTeam = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = teamName.trim().replace(/\s+/g, " ");
    if (!clean) return setError("Informe o nome do time.");
    if (clean === NO_TEAM || teamList.some((t) => norm(t) === norm(clean))) return setError("Já existe um time com esse nome.");
    setTeams([...teams, clean]);
    setSuccess(`Time "${clean}" cadastrado com sucesso.`);
    closeModal();
  };

  const deleteTeam = (name: string) => {
    setTeams(teams.filter((t) => t !== name));
    setConfirmDelete(null);
    setSuccess(`Time "${name}" excluído.`);
  };

  const addPerson = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = personName.trim().replace(/\s+/g, " ");
    if (!clean) return setError("Informe o nome do colaborador.");
    const existing = people.find((p) => norm(p.name) === norm(clean));
    assignTeam(existing ? existing.name : clean, personTeam);
    setSuccess(
      existing
        ? `${existing.name} já existia; o time foi atualizado para ${personTeam}.`
        : `${clean} foi cadastrado(a) em ${personTeam}.`
    );
    closeModal();
  };

  const teamStats = teamList.map((name) => {
    const members = rows.filter((r) => r.team === name);
    return {
      name,
      members,
      audits: members.reduce((sum, m) => sum + m.audits, 0),
      score: members.some((m) => m.audits) ? weightedScore(members) : null,
    };
  });

  const peopleRows = rows
    .filter((r) => teamFilter === ALL_TEAMS || r.team === teamFilter)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <main className="content">
      <Tabs
        tabs={[
          { id: "teams", label: `Times (${teamList.length})` },
          { id: "people", label: `Colaboradores (${people.length})` },
        ]}
        value={view}
        onChange={(v) => {
          setView(v);
          setSuccess("");
        }}
      />

      {success && <div className="notice success" style={{ marginTop: 0, marginBottom: 16 }}>{success}</div>}

      {view === "teams" && (
        <>
          <section className="kpis">
            <article className="kpi-card">
              <div className="kpi-header"><small>TIMES ATIVOS</small></div>
              <div className="kpi-body"><strong>{realTeams.length}</strong></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-header"><small>COLABORADORES</small></div>
              <div className="kpi-body"><strong>{people.length}</strong></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-header"><small>NOTA MÉDIA GERAL</small></div>
              <div className="kpi-body"><strong>{fmt(weightedScore(rows))}</strong><span>/ 100</span></div>
            </article>
          </section>

          <div className="page-actions" style={{ marginBottom: 16 }}>
            <h3>Times</h3>
            <button
              className="primary-button"
              onClick={() => {
                setSuccess("");
                setModal("team");
              }}
            >
              + Cadastrar novo time
            </button>
          </div>

          {teamStats.length === 0 ? (
            <div className="panel"><p className="empty">Nenhum time cadastrado. Clique em “+ Cadastrar novo time”.</p></div>
          ) : (
            <div className="team-grid">
              {teamStats.map((t) => (
                <div key={t.name} className="team-card">
                  <div className="team-card-head">
                    <h4>{t.name}</h4>
                    <span className="badge ok">{t.members.length} {t.members.length === 1 ? "pessoa" : "pessoas"}</span>
                  </div>
                  <div className="avatar-stack">
                    {t.members.slice(0, 6).map((m) => (
                      <span key={m.id} className="avatar" style={{ background: m.color }} title={m.name}>{m.initials}</span>
                    ))}
                    {t.members.length === 0 && <span className="muted" style={{ fontSize: 13 }}>Sem colaboradores ainda</span>}
                  </div>
                  {t.name === NO_TEAM && (
                    <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                      Consultores da planilha ainda sem time. Atribua um time na aba Colaboradores.
                    </p>
                  )}
                  <div className="team-metrics">
                    <div><small>MONITORIAS</small><strong>{t.audits}</strong></div>
                    <div><small>NOTA MÉDIA</small><strong>{t.score === null ? "—" : fmt(t.score)}</strong></div>
                  </div>
                  <div className="team-actions">
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setTeamFilter(t.name);
                        setView("people");
                        setSuccess("");
                      }}
                    >
                      Ver colaboradores
                    </button>
                    {t.members.length === 0 &&
                      t.name !== NO_TEAM &&
                      (confirmDelete === t.name ? (
                        <button className="danger-button" onClick={() => deleteTeam(t.name)}>Confirmar</button>
                      ) : (
                        <button className="danger-button" onClick={() => setConfirmDelete(t.name)}>Excluir</button>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {view === "people" && (
        <>
          <div className="page-actions" style={{ marginBottom: 16 }}>
            <Dropdown label="TIME" value={teamFilter} options={[ALL_TEAMS, ...teamList]} onChange={setTeamFilter} />
            <button
              className="primary-button"
              onClick={() => {
                setSuccess("");
                setPersonTeam(teamFilter !== ALL_TEAMS ? teamFilter : realTeams[0] ?? NO_TEAM);
                setModal("person");
              }}
            >
              + Cadastrar novo colaborador
            </button>
          </div>

          <div className="panel">
            {peopleRows.length === 0 ? (
              <p className="empty">Nenhum colaborador neste filtro.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>COLABORADOR</th>
                      <th>TIME</th>
                      <th>MONITORIAS</th>
                      <th>NOTA MÉDIA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {peopleRows.map((a) => (
                      <tr key={a.id} onClick={() => openAudit(a)} style={{ cursor: "pointer" }}>
                        <td>
                          <div className="agent">
                            <span className="avatar" style={{ background: a.color }}>{a.initials}</span>
                            <strong>{a.name}</strong>
                          </div>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <select
                            className="input inline-select"
                            value={a.team}
                            onChange={(e) => assignTeam(a.name, e.target.value)}
                          >
                            {[NO_TEAM, ...realTeams].map((t) => <option key={t}>{t}</option>)}
                          </select>
                        </td>
                        <td>{a.audits}</td>
                        <td>{a.audits ? <><strong>{fmt(a.score)}</strong> / 100</> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {modal === "team" && (
        <div className="drawer-overlay" onClick={closeModal}>
          <div className="drawer" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3>Cadastrar novo time</h3>
            <p className="muted" style={{ fontSize: 13 }}>Depois de criado, o time aparece nos filtros e no cadastro de colaboradores.</p>
            <form onSubmit={addTeam} style={{ marginTop: 20, display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">NOME DO TIME</label>
                <input
                  className="input"
                  autoFocus
                  value={teamName}
                  onChange={(e) => {
                    setTeamName(e.target.value);
                    setError("");
                  }}
                  placeholder="Ex: Equipe Ametista"
                />
              </div>
              {error && <p className="negative" style={{ margin: 0 }}>{error}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button type="button" className="secondary-button" style={{ flex: 1 }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="primary-button" style={{ flex: 1 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modal === "person" && (
        <div className="drawer-overlay" onClick={closeModal}>
          <div className="drawer" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3>Cadastrar novo colaborador</h3>
            <p className="muted" style={{ fontSize: 13 }}>
              Informe o nome e o time. Se o nome for igual ao da planilha, as monitorias dele aparecem automaticamente.
            </p>
            <form onSubmit={addPerson} style={{ marginTop: 20, display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">NOME COMPLETO</label>
                <input
                  className="input"
                  autoFocus
                  value={personName}
                  onChange={(e) => {
                    setPersonName(e.target.value);
                    setError("");
                  }}
                  placeholder="Ex: Juliana Souza"
                />
              </div>
              <div>
                <label className="field-label">TIME</label>
                <select className="input" value={personTeam} onChange={(e) => setPersonTeam(e.target.value)}>
                  {[NO_TEAM, ...realTeams].map((t) => <option key={t}>{t}</option>)}
                </select>
              </div>
              {error && <p className="negative" style={{ margin: 0 }}>{error}</p>}
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button type="button" className="secondary-button" style={{ flex: 1 }} onClick={closeModal}>Cancelar</button>
                <button type="submit" className="primary-button" style={{ flex: 1 }}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}

/* =====================================================================
   RELATÓRIOS
   ===================================================================== */

function Reports({
  people,
  records,
  teamList,
  config,
}: {
  people: Person[];
  records: Monitoria[];
  teamList: string[];
  config: Config;
}) {
  const [period, setPeriod] = useState("Todo o período");
  const days = PERIODS[period];
  const now = Date.now();

  const list = records.filter((r) => days === null || r.date === null || r.date >= now - days * DAY);
  const rows = computeRows(people, records, days, now);

  const resolved = rateOf(list, "resolvida", isYes);
  const csat = rateOf(list, "csat", isResponded);
  const below = list.length ? (list.filter((r) => r.nota < config.minScore).length / list.length) * 100 : 0;

  const byCategory = new Map<string, Monitoria[]>();
  list.forEach((r) => {
    const key = r.categoria || "Sem categoria";
    const arr = byCategory.get(key);
    if (arr) arr.push(r);
    else byCategory.set(key, [r]);
  });
  const categoryRows = Array.from(byCategory.entries())
    .map(([name, items]) => ({
      name,
      count: items.length,
      score: avg(items.map((i) => i.nota)),
      resolved: rateOf(items, "resolvida", isYes),
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <main className="content">
      <div className="page-actions" style={{ marginBottom: 16 }}>
        <Dropdown label="PERÍODO" value={period} options={Object.keys(PERIODS)} onChange={setPeriod} />
      </div>

      <section className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card">
          <div className="kpi-header"><small>NOTA MÉDIA</small></div>
          <div className="kpi-body"><strong>{fmt(avg(list.map((r) => r.nota)))}</strong><span>/ 100</span></div>
          <p>{list.length.toLocaleString("pt-BR")} monitorias</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>ABAIXO DA NOTA MÍNIMA</small></div>
          <div className="kpi-body"><strong>{fmt(below)}%</strong></div>
          <p>nota mínima: {config.minScore}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>TAXA DE RESOLUÇÃO</small></div>
          <div className="kpi-body"><strong>{resolved === null ? "—" : `${fmt(resolved)}%`}</strong></div>
          <p>coluna “Resolvida?”</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>CSAT RESPONDIDO</small></div>
          <div className="kpi-body"><strong>{csat === null ? "—" : `${fmt(csat)}%`}</strong></div>
          <p>coluna “Status CSAT”</p>
        </article>
      </section>

      <div className="panel">
        <h3>Por time</h3>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>TIME</th>
                <th>COLABORADORES</th>
                <th>MONITORIAS</th>
                <th>NOTA MÉDIA</th>
              </tr>
            </thead>
            <tbody>
              {teamList.map((t) => {
                const members = rows.filter((r) => r.team === t);
                return (
                  <tr key={t}>
                    <td><strong>{t}</strong></td>
                    <td>{members.length}</td>
                    <td>{members.reduce((sum, a) => sum + a.audits, 0)}</td>
                    <td>{members.some((a) => a.audits) ? fmt(weightedScore(members)) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h3>Por categoria</h3>
        {categoryRows.length === 0 ? (
          <p className="empty">Sem monitorias no período.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>CATEGORIA</th>
                  <th>MONITORIAS</th>
                  <th>NOTA MÉDIA</th>
                  <th>RESOLVIDAS</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map((c) => (
                  <tr key={c.name}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.count}</td>
                    <td>{fmt(c.score)}</td>
                    <td>{c.resolved === null ? "—" : `${fmt(c.resolved)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

/* =====================================================================
   CONFIGURAÇÕES
   ===================================================================== */

function Settings({
  config,
  setConfig,
  setBlocks,
  sheet,
  reload,
  sheetUrlSetting,
  setSheetUrlSetting,
}: {
  config: Config;
  setConfig: (config: Config) => void;
  setBlocks: (blocks: Block[]) => void;
  sheet: SheetState;
  reload: () => void;
  sheetUrlSetting: string;
  setSheetUrlSetting: (url: string) => void;
}) {
  const profileNames = Object.keys(MARKET_PROFILES);
  const [selected, setSelected] = useState(profileNames.includes(config.profile) ? config.profile : profileNames[0]);
  const [minScore, setMinScore] = useState(String(config.minScore));
  const [targetAudits, setTargetAudits] = useState(String(config.targetAudits));
  const [message, setMessage] = useState("");
  const [urlInput, setUrlInput] = useState(sheetUrlSetting);
  const [urlError, setUrlError] = useState("");

  const profile = MARKET_PROFILES[selected];

  const connect = () => {
    const value = urlInput.trim();
    if (value && !/^https:\/\/docs\.google\.com\/spreadsheets\//.test(value)) {
      setUrlError("Cole um link do Google Sheets (começa com https://docs.google.com/spreadsheets/...).");
      return;
    }
    setUrlError("");
    if (value === sheetUrlSetting) reload();
    else setSheetUrlSetting(value);
  };

  const disconnect = () => {
    setUrlInput("");
    setUrlError("");
    setSheetUrlSetting("");
  };

  const applyProfile = () => {
    setBlocks(profile.blocks.map((b, i) => ({ ...b, id: Date.now() + i })));
    setConfig({ profile: selected, minScore: profile.minScore, targetAudits: profile.targetAudits });
    setMinScore(String(profile.minScore));
    setTargetAudits(String(profile.targetAudits));
    setMessage(`Perfil "${selected}" aplicado: nota mínima, meta de auditorias e blocos de parâmetros foram atualizados.`);
  };

  const save = () => {
    const min = Number(minScore);
    const target = Number(targetAudits);
    if (!(min >= 0 && min <= 100) || !(target >= 1)) {
      setMessage("Verifique os valores: a nota mínima vai de 0 a 100 e a meta deve ser de pelo menos 1 auditoria.");
      return;
    }
    const matchesProfile =
      MARKET_PROFILES[config.profile] &&
      MARKET_PROFILES[config.profile].minScore === min &&
      MARKET_PROFILES[config.profile].targetAudits === target;
    setConfig({ profile: matchesProfile ? config.profile : "Personalizado", minScore: min, targetAudits: target });
    setMessage("Configurações salvas com sucesso!");
  };

  const statusLabel =
    sheet.status === "ok"
      ? "Conectada"
      : sheet.status === "loading"
      ? "Carregando…"
      : sheet.status === "error"
      ? "Com erro"
      : "Não conectada (modo demonstração)";

  return (
    <main className="content">
      <div className="panel">
        <div className="page-actions">
          <div>
            <h3>Fonte de dados (Google Sheets)</h3>
            <p className="muted">A planilha é a base da ferramenta: Dashboard, Monitorias, Equipe e Relatórios leem dela.</p>
          </div>
          <div className={`badge ${sheet.status === "ok" ? "ok" : "warn"}`}>{statusLabel}</div>
        </div>

        <div className="inline-form" style={{ marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">LINK DA PLANILHA (CSV publicado ou link de compartilhamento)</label>
            <input
              className="input"
              value={urlInput}
              onChange={(e) => {
                setUrlInput(e.target.value);
                setUrlError("");
              }}
              placeholder="https://docs.google.com/spreadsheets/d/e/.../pub?output=csv"
            />
          </div>
          <button className="primary-button" onClick={connect}>Salvar e conectar</button>
          {sheetUrlSetting && <button className="secondary-button" onClick={disconnect}>Desconectar</button>}
        </div>
        {urlError && <p className="negative" style={{ margin: "10px 0 0" }}>{urlError}</p>}
        {ENV_URL && !sheetUrlSetting && (
          <p className="muted" style={{ fontSize: 12 }}>Usando o link padrão configurado no Vercel (VITE_SHEET_CSV_URL).</p>
        )}
        {sheet.status === "error" && <div className="notice">{sheet.message}</div>}

        <div className="rule-block" style={{ marginTop: 16 }}>
          <strong>Como conectar</strong>
          <ol className="steps">
            <li>Na planilha: <b>Arquivo → Compartilhar → Publicar na web</b>.</li>
            <li>Escolha a <b>aba</b> com as monitorias e o formato <b>Valores separados por vírgula (.csv)</b>, e clique em <b>Publicar</b>.</li>
            <li>Copie o link gerado e cole no campo acima. Para valer para todos os usuários, cadastre o mesmo link no Vercel como <b>VITE_SHEET_CSV_URL</b> e faça um novo deploy.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Atenção: quem tiver o link consegue ler os dados da aba publicada. Não publique nada que não possa ser visto por terceiros.
          </p>
        </div>

        {sheet.status === "ok" && (
          <div style={{ marginTop: 16 }}>
            <div className="editor-title">COLUNAS RECONHECIDAS</div>
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table>
                <thead>
                  <tr>
                    <th>CAMPO DA FERRAMENTA</th>
                    <th>COLUNA NA PLANILHA</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.mapping.map((m) => (
                    <tr key={m.field}>
                      <td>{m.label}</td>
                      <td>
                        {m.header ? (
                          <span className="positive">{m.header}</span>
                        ) : (
                          <span className="muted-text">não encontrada</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="page-actions">
          <div>
            <h3>Perfil padrão de mercado</h3>
            <p className="muted">Carregue um modelo pronto de critérios, pesos e metas e depois ajuste ao seu negócio.</p>
          </div>
          <div className="badge ok">Perfil ativo: {config.profile}</div>
        </div>

        <div className="inline-form" style={{ marginTop: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">PERFIL</label>
            <select className="input" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {profileNames.map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <button className="primary-button" onClick={applyProfile}>Aplicar perfil</button>
        </div>

        <div className="rule-block" style={{ marginTop: 14 }}>
          <strong>{selected}</strong>
          <p className="muted" style={{ fontSize: 12, margin: "4px 0 8px" }}>{profile.description}</p>
          <p style={{ fontSize: 13, margin: 0 }}>
            Nota mínima: <strong>{profile.minScore}</strong> · Meta mensal: <strong>{profile.targetAudits} auditorias</strong>
          </p>
          <ul className="profile-blocks">
            {profile.blocks.map((b) => (
              <li key={b.name}>{b.name} <span className="muted">({b.weight}%)</span></li>
            ))}
          </ul>
        </div>
        <p className="muted" style={{ fontSize: 12 }}>
          Valores de exemplo para ponto de partida, não são referências oficiais de mercado. Ao aplicar, os blocos atuais da página Parâmetros são substituídos.
        </p>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <h3>Metas e alertas</h3>
        <p className="muted">Ajuste os valores aplicados em toda a plataforma.</p>
        <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
          <div className="rule-block">
            <strong>Nota mínima</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
              Monitorias abaixo desta nota contam como desvio no Dashboard e nos Relatórios.
            </p>
            <input className="input" style={{ width: 120 }} type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </div>
          <div className="rule-block">
            <strong>Meta mensal de monitorias por consultor</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>
              Volume necessário para garantir a representatividade estatística da operação.
            </p>
            <input className="input" style={{ width: 120 }} type="number" min={1} value={targetAudits} onChange={(e) => setTargetAudits(e.target.value)} />
          </div>
        </div>
        <button className="primary-button" style={{ marginTop: 20 }} onClick={save}>Salvar configurações</button>
        {message && <div className="notice success" style={{ marginTop: 14 }}>{message}</div>}
      </div>
    </main>
  );
}

/* =====================================================================
   DETALHE (drawer)
   ===================================================================== */

function AuditDrawer({
  person,
  records,
  config,
  close,
}: {
  person: Person | null;
  records: Monitoria[];
  config: Config;
  close: () => void;
}) {
  const list = records
    .filter((r) => !person || norm(r.consultor) === norm(person.name))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, 10);

  return (
    <div className="drawer-overlay" onClick={close}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: 520, display: "flex", flexDirection: "column", padding: 0 }}>
        <div className="drawer-header" style={{ padding: 20, borderBottom: "1px solid var(--line)", marginBottom: 0 }}>
          <h3>{person ? person.name : "Últimas monitorias"}</h3>
          <button onClick={close} className="secondary-button">Fechar</button>
        </div>
        <div className="drawer-body" style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
            {person ? `${person.team} · ` : ""}as 10 monitorias mais recentes
          </p>
          {list.length === 0 ? (
            <p className="empty">Nenhuma monitoria registrada.</p>
          ) : (
            <div className="block-items">
              {list.map((r) => (
                <div key={r.id} className="rule-block" style={{ lineHeight: 1.7 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <strong>{person ? r.categoria || "Sem categoria" : r.consultor}</strong>
                    <strong className={r.nota < config.minScore ? "negative" : "positive"}>{fmt(r.nota)}</strong>
                  </div>
                  <div className="muted" style={{ fontSize: 12, margin: 0 }}>
                    {[r.week, r.ticket && `#${r.ticket}`, r.resolvida && `Resolvida: ${r.resolvida}`, r.csat].filter(Boolean).join(" · ")}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =====================================================================
   APP
   ===================================================================== */

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditPerson, setAuditPerson] = useState<Person | null>(null);

  const [registered, setRegistered] = usePersistentState<Person[]>("qualita:v2:people", []);
  const [teams, setTeams] = usePersistentState<string[]>("qualita:v2:teams", []);
  const [blocks, setBlocks] = usePersistentState<Block[]>("qualita:v1:blocks", DEFAULT_BLOCKS);
  const [config, setConfig] = usePersistentState<Config>("qualita:v1:config", DEFAULT_CONFIG);
  const [sheetUrlSetting, setSheetUrlSetting] = usePersistentState<string>("qualita:v2:sheetUrl", "");

  const sheetUrl = resolveSheetUrl(sheetUrlSetting || ENV_URL);
  const [sheet, reload] = useSheet(sheetUrl);
  const isDemo = sheet.status === "demo";
  const records = sheet.records;

  const people = useMemo(
    () => buildPeople(isDemo ? [...DEMO_PEOPLE, ...registered] : registered, records),
    [isDemo, registered, records]
  );
  const teamList = useMemo(
    () => buildTeamList(isDemo ? [...DEMO_TEAMS, ...teams] : teams, people),
    [isDemo, teams, people]
  );

  /* Define o time de uma pessoa (cria o cadastro se ela só existir na planilha) */
  const assignTeam = (name: string, team: string) => {
    const key = norm(name);
    const exists = registered.some((p) => norm(p.name) === key);
    if (exists) {
      setRegistered(registered.map((p) => (norm(p.name) === key ? { ...p, team } : p)));
    } else {
      const person: Person = {
        id: Date.now(),
        name,
        team,
        initials: initialsOf(name),
        color: PALETTE[people.length % PALETTE.length],
      };
      setRegistered([...registered, person]);
    }
  };

  const openAudit = (person?: Person) => {
    setAuditPerson(person ?? null);
    setAuditOpen(true);
  };

  return (
    <div className="app-container">
      <Sidebar page={page} setPage={setPage} />
      <div className="workspace">
        <Header page={page} />
        {page !== "settings" && <SourceBanner sheet={sheet} reload={reload} goSettings={() => setPage("settings")} />}
        {page === "dashboard" && (
          <Dashboard people={people} records={records} teamList={teamList} config={config} openAudit={openAudit} />
        )}
        {page === "monitorias" && <Monitorias records={records} config={config} />}
        {page === "parameters" && <Parameters blocks={blocks} setBlocks={setBlocks} config={config} />}
        {page === "team" && (
          <Team
            people={people}
            records={records}
            teams={teams}
            teamList={teamList}
            setTeams={setTeams}
            assignTeam={assignTeam}
            openAudit={openAudit}
          />
        )}
        {page === "reports" && <Reports people={people} records={records} teamList={teamList} config={config} />}
        {page === "settings" && (
          <Settings
            config={config}
            setConfig={setConfig}
            setBlocks={setBlocks}
            sheet={sheet}
            reload={reload}
            sheetUrlSetting={sheetUrlSetting}
            setSheetUrlSetting={setSheetUrlSetting}
          />
        )}
      </div>
      {auditOpen && <AuditDrawer person={auditPerson} records={records} config={config} close={() => setAuditOpen(false)} />}
    </div>
  );
}
