import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =====================================================================
   TIPOS
   ===================================================================== */

type Concept = "Excelente" | "Adequado" | "Atenção" | "Crítico";

type Person = { id: number; name: string; team: string; initials: string; color: string };

type Monitoria = {
  id: string;
  date: number | null; // início do dia, ou null se a planilha não tiver data
  week: string;
  consultor: string;
  categoria: string;
  ticket: string;
  csat: string;
  team: string;
  scores: (number | null)[] | null; // 5 parâmetros: 0, 1, 2 ou null ("-"); null se a planilha não tiver as colunas
  nota: number | null; // total de 0 a 10; null = Desconsiderado
  concept: Concept | null;
  flag: boolean; // alerta de prioridade possivelmente rebaixada
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
};

type Win = { from: number; to: number; prevFrom: number; prevTo: number; hasPrev: boolean };

/* =====================================================================
   CONSTANTES (baseadas no Processo de Monitoria de Qualidade V4)
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
  Crítico:
    "Não atende na maior parte, ou teve prioridade rebaixada indevidamente em caso de folha; entra nos alertas da liderança.",
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

/* Link da planilha definido na Vercel (Settings > Environment Variables > VITE_SHEET_CSV_URL) */
const ENV_URL: string = (((import.meta as any).env?.VITE_SHEET_CSV_URL as string | undefined) ?? "").trim();

const DEFAULT_GOALS: Goals = { csat: 94, agreement: 90, feedback: 100 };

const DEFAULT_SCORECARD: Scorecard = {
  version: "V4 (piloto, 05/11/2026)",
  excellentMin: 9,
  adequateMin: 7,
  attentionMin: 5,
  params: [
    {
      id: 1,
      name: "Classificação e triagem",
      evaluates:
        "Categoria, causa, solução e menu/funcionalidade corretos; justificativa técnica se a prioridade/FLAG foi alterada.",
      full: "Todos corretos e prioridade/FLAG justificada.",
      partial: "Um campo incorreto ou incompleto, sem impacto na priorização.",
      none: "Classificação errada, prioridade/FLAG alterada sem justificativa, ou ausente.",
      canBeNA: false,
      rule: "A causa deve ser a causa técnica do problema, e não o motivo do encerramento. A solução registrada deve refletir o que foi de fato entregue: paliativo não equivale a correção implementada.",
    },
    {
      id: 2,
      name: "Condução ativa",
      evaluates:
        "Iniciativa do consultor e atualizações periódicas de status em casos pendentes de N2 ou áreas internas.",
      full: "Proativo, com atualizações periódicas; cliente nunca precisou cobrar.",
      partial: "Condução razoável, com lacunas no status intermediário.",
      none: "Cliente teve que cobrar retorno ou ficou sem atualização.",
      canBeNA: true,
      rule: "Quando o atendimento é resolvido na primeira resposta, este parâmetro não se aplica (“-”) e a nota é calculada de forma proporcional.",
    },
    {
      id: 3,
      name: "Comunicação e prazos",
      evaluates: "Mensagens objetivas e profissionais, com prazo alinhado para próximos passos.",
      full: "Clara, adequada e com prazo ou horizonte alinhado.",
      partial: "Aceitável, mas com respostas genéricas.",
      none: "Confusa, inadequada ou sem previsão de retorno.",
      canBeNA: true,
      rule: "Resolvido na primeira resposta: não se aplica (“-”). Mensagens duplicadas ou coladas sem contexto reduzem a nota, por falta de profissionalismo.",
    },
    {
      id: 4,
      name: "Conclusão validada",
      evaluates: "Solicitação resolvida e próximo passo consolidado.",
      full: "Desfecho validado pelo cliente, solução evidenciada e próximo passo claro.",
      partial: "Há direcionamento para o encerramento, mas sem validação explícita.",
      none: "Encerrado de forma sumária, sem validação ou com resposta aberta.",
      canBeNA: false,
      rule: "Encerrar por vinculação a outro ticket, ou por “o cliente resolveu sozinho”, sem mensagem de confirmação e sem registro do que foi feito, não atinge a nota 2.",
    },
    {
      id: 5,
      name: "Registro interno",
      evaluates: "Observação interna com o que causou o problema e como foi resolvido.",
      full: "Causa e solução registradas de forma clara e estruturada.",
      partial: "Registro incompleto (só causa ou só solução, ou conteúdo genérico).",
      none: "Sem registro interno.",
      canBeNA: false,
      rule: "Registros corretos no ato da finalização do ticket, com a observação interna.",
    },
  ],
};

const GENERAL_RULES = [
  "A nota de cada parâmetro é inteira (0, 1 ou 2), sem meios-pontos, ou “-” quando o parâmetro não se aplica (somente parâmetros 2 e 3).",
  "O conceito final é sempre calculado a partir do total, nunca por impressão geral. Única exceção: prioridade/FLAG rebaixada indevidamente em caso com impacto em folha de pagamento leva o ticket direto para Crítico.",
  "Ticket tratado integralmente por bot, ou sem atendimento humano, não é pontuado: registrar “Desconsiderado” com uma frase de explicação.",
  "Se faltar algum dado de classificação, avaliar o parâmetro 1 pelo que o ticket mostra e declarar o que não pôde ser validado.",
  "CSAT recebido depois da avaliação é associado ao ticket, sem reavaliação.",
  "A avaliação usa somente evidências do ticket, sem presumir informações.",
];

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

const mondayOf = (t: number) => startOfDay(t) - ((new Date(t).getDay() + 6) % 7) * DAY;

function weekLabel(date: number) {
  const monday = mondayOf(date);
  const short = (t: number) => new Date(t).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${short(monday)} a ${short(monday + 4 * DAY)}`;
}

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
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* armazenamento indisponível: segue sem persistir */
    }
  }, [key, value]);
  return [value, setValue] as const;
}

/* =====================================================================
   REGRAS DO SCORECARD
   ===================================================================== */

/* Total proporcional: pontos obtidos ÷ pontos possíveis × 10, arredondado para o inteiro mais próximo.
   Parâmetros "-" (null) saem do cálculo. */
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
    concept === "Excelente"
      ? [sc.excellentMin, 10]
      : concept === "Adequado"
      ? [sc.adequateMin, sc.excellentMin - 1]
      : concept === "Atenção"
      ? [sc.attentionMin, sc.adequateMin - 1]
      : [0, sc.attentionMin - 1];
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

function csatClass(value: string): "pos" | "neg" | null {
  const s = norm(value);
  if (!s) return null;
  if (/^\d+([.,]\d+)?$/.test(s)) {
    const n = Number(s.replace(",", "."));
    if (n >= 1 && n <= 5) return n >= 4 ? "pos" : "neg";
    return null;
  }
  if (/detrator|insatisf|ruim|pessim|negativ|discord/.test(s)) return "neg";
  if (/satisf|otim|bom|excelente|positiv|promotor|concord/.test(s)) return "pos";
  return null;
}

function csatOf(list: Monitoria[]): { rate: number | null; answered: number } {
  let pos = 0;
  let neg = 0;
  list.forEach((r) => {
    const c = csatClass(r.csat);
    if (c === "pos") pos++;
    else if (c === "neg") neg++;
  });
  const answered = pos + neg;
  return { rate: answered ? (pos / answered) * 100 : null, answered };
}

const scored = (list: Monitoria[]): Scored[] => list.filter((r): r is Scored => r.nota !== null);

/* =====================================================================
   PERÍODOS
   ===================================================================== */

function getWindow(period: string, now: number): Win {
  if (period === "Todo o período") {
    return { from: -Infinity, to: Infinity, prevFrom: -Infinity, prevTo: -Infinity, hasPrev: false };
  }
  if (period === "Semana anterior") {
    const thisMonday = mondayOf(now);
    return {
      from: thisMonday - 7 * DAY,
      to: thisMonday,
      prevFrom: thisMonday - 14 * DAY,
      prevTo: thisMonday - 7 * DAY,
      hasPrev: true,
    };
  }
  const days = PERIOD_DAYS[period] ?? 30;
  return { from: now - days * DAY, to: Infinity, prevFrom: now - 2 * days * DAY, prevTo: now - days * DAY, hasPrev: true };
}

/* Registros sem data entram sempre no período atual (e nunca no anterior) */
const inCurrent = (r: Monitoria, w: Win) => r.date === null || (r.date >= w.from && r.date < w.to);
const inPrev = (r: Monitoria, w: Win) => w.hasPrev && r.date !== null && r.date >= w.prevFrom && r.date < w.prevTo;

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

const FIELDS: { field: string; label: string; keys: string[] }[] = [
  { field: "consultor", label: "Consultor(a)", keys: ["consultor", "atendente", "agente", "colaborador"] },
  { field: "nota", label: "Nota total (0 a 10)", keys: ["nota final", "nota total", "total", "pontuacao total", "nota geral", "nota", "pontuacao", "score"] },
  { field: "conceito", label: "Conceito", keys: ["conceito"] },
  { field: "p1", label: "1. Classificação e triagem", keys: ["classificacao e triagem", "triagem", "p1", "parametro 1", "param 1", "criterio 1"] },
  { field: "p2", label: "2. Condução ativa", keys: ["conducao ativa", "conducao", "p2", "parametro 2", "param 2", "criterio 2"] },
  { field: "p3", label: "3. Comunicação e prazos", keys: ["comunicacao e prazos", "comunicacao", "p3", "parametro 3", "param 3", "criterio 3"] },
  { field: "p4", label: "4. Conclusão validada", keys: ["conclusao validada", "conclusao", "p4", "parametro 4", "param 4", "criterio 4"] },
  { field: "p5", label: "5. Registro interno", keys: ["registro interno", "registro", "p5", "parametro 5", "param 5", "criterio 5"] },
  { field: "data", label: "Data", keys: ["data"] },
  { field: "semana", label: "Semana", keys: ["semana"] },
  { field: "categoria", label: "Categoria", keys: ["categoria"] },
  { field: "ticket", label: "ID do ticket", keys: ["id ticket", "ticket", "protocolo", "chamado"] },
  { field: "csat", label: "CSAT", keys: ["status csat", "csat"] },
  { field: "time", label: "Time / Torre", keys: ["time", "equipe", "torre"] },
  { field: "alerta", label: "Alerta de prioridade", keys: ["alerta", "alerta prioridade", "prioridade rebaixada"] },
  { field: "atencao", label: "Ponto de atenção", keys: ["ponto de atencao", "pontos de atencao"] },
];

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

/* Célula de parâmetro: 0, 1 ou 2; qualquer outra coisa ("-", vazio, N/A) vira null = não se aplica */
function parseScoreCell(value: string): number | null {
  const n = parseNumber(value);
  return n === 0 || n === 1 || n === 2 ? n : null;
}

const NO_ALERT = ["nao", "n", "-", "0", "false", "nenhum", "ok", "sem alerta"];

function recordsFromCSV(text: string) {
  const rows = parseCSV(text);
  const keysOf = (field: string) => FIELDS.find((f) => f.field === field)!.keys;
  const paramFields = ["p1", "p2", "p3", "p4", "p5"];

  let headerIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const h = rows[i].map(normHeader);
    const hasConsultor = findCol(h, keysOf("consultor")) >= 0;
    const hasNota = findCol(h, keysOf("nota")) >= 0;
    const paramsFound = paramFields.filter((p) => findCol(h, keysOf(p)) >= 0).length;
    if (hasConsultor && (hasNota || paramsFound >= 3)) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error(
      `Não encontrei a coluna do consultor e a da nota (ou das notas dos 5 parâmetros). Cabeçalhos lidos na primeira linha: ${
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
  const hasAllParams = paramFields.every((p) => idx[p] >= 0);

  const raw: Monitoria[] = [];
  let skipped = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");
    const consultor = get(idx.consultor);
    if (!consultor) {
      skipped++;
      continue;
    }

    const paramCells = paramFields.map((p) => get(idx[p]));
    const scores = hasAllParams && paramCells.some((c) => c !== "") ? paramCells.map(parseScoreCell) : null;

    const notaText = get(idx.nota);
    const conceptText = get(idx.conceito);
    const disregarded = /desconsider/.test(norm(notaText)) || /desconsider/.test(norm(conceptText));

    let nota: number | null = parseNumber(notaText);
    if (Number.isNaN(nota) && scores) nota = totalFromScores(scores);
    if (disregarded) nota = null;
    else if (nota === null || Number.isNaN(nota)) {
      skipped++;
      continue;
    }

    const semana = get(idx.semana);
    const date = parseDateCell(get(idx.data)) ?? parseDateCell(semana);
    const alertText = norm(get(idx.alerta));

    raw.push({
      id: `r${i}`,
      date: date === null ? null : startOfDay(date),
      week: semana || (date !== null ? weekLabel(date) : ""),
      consultor,
      categoria: get(idx.categoria),
      ticket: get(idx.ticket).replace(/^#/, ""),
      csat: get(idx.csat),
      team: get(idx.time),
      scores: disregarded ? null : scores,
      nota,
      concept: disregarded ? null : parseConcept(conceptText),
      flag: alertText !== "" && !NO_ALERT.includes(alertText),
      disregarded,
      attention: get(idx.atencao),
    });
  }

  if (raw.length === 0) {
    throw new Error("Encontrei as colunas, mas nenhuma linha tem consultor e nota válidos.");
  }

  /* A nota do processo vai de 0 a 10. Se a planilha usar 0 a 100, converte. */
  const values = raw.map((x) => x.nota).filter((n): n is number => n !== null);
  const max = values.length ? Math.max(...values) : 0;
  const factor = max > 10 ? 0.1 : 1;
  const scaleNote = factor === 1 ? "" : "Notas na escala de 0 a 100 foram convertidas para 0 a 10.";
  const records = raw.map((x) => (x.nota === null || factor === 1 ? x : { ...x, nota: Math.round(x.nota * factor * 10) / 10 }));

  return { records, skipped, scaleNote, mapping };
}

/* =====================================================================
   DADOS DE DEMONSTRAÇÃO (usados só enquanto nenhuma planilha estiver conectada)
   ===================================================================== */

const DEMO_TEAMS = ["Torre Safira", "Torre Esmeralda", "Torre Rubi"];

const DEMO_DEFS = [
  { name: "Marina Costa", team: "Torre Safira", skill: 0.9, volume: 16, drift: 0.05 },
  { name: "Rafael Martins", team: "Torre Safira", skill: 0.84, volume: 15, drift: 0.04 },
  { name: "Ana Carolina", team: "Torre Esmeralda", skill: 0.74, volume: 14, drift: 0.02 },
  { name: "Carlos Lima", team: "Torre Esmeralda", skill: 0.62, volume: 12, drift: 0.03 },
  { name: "Bianca Oliveira", team: "Torre Safira", skill: 0.55, volume: 11, drift: 0.03 },
  { name: "Diego Freitas", team: "Torre Esmeralda", skill: 0.38, volume: 10, drift: -0.08 },
  { name: "Juliana Alves", team: "Torre Rubi", skill: 0.7, volume: 10, drift: 0.09 },
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
      const base = {
        id: `d${out.length}`,
        date,
        week: weekLabel(date),
        consultor: d.name,
        categoria: categories[Math.floor(rand() * categories.length)],
        ticket: String(650000 + Math.floor(rand() * 20000)),
        team: d.team,
      };

      if (rand() < 0.04) {
        out.push({ ...base, csat: "", scores: null, nota: null, concept: null, flag: false, disregarded: true, attention: "Atendimento 100% por bot." });
        continue;
      }

      const skill = clamp(d.skill + ((45 - offset) / 45) * d.drift * 2, 0.12, 0.97);
      const scores: (number | null)[] = [0, 1, 2, 3, 4].map(() => {
        const u = rand();
        if (u < skill) return 2;
        return u < skill + (1 - skill) * 0.6 ? 1 : 0;
      });
      if (rand() < 0.25) {
        scores[1] = null;
        scores[2] = null;
      }
      const nota = totalFromScores(scores) as number;
      const lost = DEFAULT_SCORECARD.params.filter((_, i) => scores[i] !== null && (scores[i] as number) < 2).map((p) => p.name);
      const u = rand();
      out.push({
        ...base,
        csat: u < 0.22 ? "Sem resposta" : u < 0.22 + (0.5 + nota * 0.05) * 0.78 ? "Satisfeito" : "Detrator",
        scores,
        nota,
        concept: null,
        flag: nota <= 4 && rand() < 0.25,
        disregarded: false,
        attention: lost.length ? `Perdeu pontos em: ${lost.join(", ")}.` : "",
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

function weightedScore(rows: AgentRow[]) {
  const total = rows.reduce((sum, r) => sum + r.audits, 0);
  return total ? rows.reduce((sum, r) => sum + r.score * r.audits, 0) / total : 0;
}

function conceptCounts(list: Scored[]): Record<Concept, number> {
  const counts: Record<Concept, number> = { Excelente: 0, Adequado: 0, Atenção: 0, Crítico: 0 };
  list.forEach((r) => {
    if (r.concept) counts[r.concept]++;
  });
  return counts;
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

function ConceptPill({ concept }: { concept: Concept | null }) {
  if (!concept) return <span className="muted-text">—</span>;
  const color = CONCEPT_COLORS[concept];
  return (
    <span className="pill" style={{ color, background: `${color}22` }}>
      {concept}
    </span>
  );
}

function ScoreCell({ value }: { value: number | null }) {
  return <span className={`score-cell s${value === null ? "na" : value}`}>{value === null ? "-" : value}</span>;
}

function ConceptDistribution({ list }: { list: Scored[] }) {
  const counts = conceptCounts(list);
  const total = CONCEPTS.reduce((sum, c) => sum + counts[c], 0);
  if (total === 0) return <p className="empty">Sem monitorias pontuadas no período.</p>;
  return (
    <>
      <div className="stack-bar">
        {CONCEPTS.map((c) => (
          <div
            key={c}
            className="stack-seg"
            title={`${c}: ${counts[c]}`}
            style={{ width: `${(counts[c] / total) * 100}%`, background: CONCEPT_COLORS[c] }}
          />
        ))}
      </div>
      <div className="concept-legend">
        {CONCEPTS.map((c) => (
          <div key={c}>
            <span>
              <i className="dot" style={{ background: CONCEPT_COLORS[c] }} />
              {c}
            </span>
            <strong>{counts[c]}</strong>
            <small>{fmt((counts[c] / total) * 100, 0)}%</small>
          </div>
        ))}
      </div>
    </>
  );
}

function ParamBars({ list, scorecard }: { list: Scored[]; scorecard: Scorecard }) {
  const withScores = list.filter((r) => r.scores);
  if (withScores.length === 0) {
    return <p className="empty">A planilha ainda não tem as colunas dos 5 parâmetros, ou não há monitorias no período.</p>;
  }
  const averages = scorecard.params.map((_, i) => {
    const values = withScores.map((r) => (r.scores as (number | null)[])[i]).filter((v): v is number => v !== null);
    return values.length ? avg(values) : null;
  });
  const known = averages.filter((a): a is number => a !== null);
  const lowest = known.length ? Math.min(...known) : null;
  return (
    <div>
      {scorecard.params.map((p, i) => {
        const a = averages[i];
        return (
          <div key={p.id} className="bar-row">
            <span>{p.id}. {p.name}</span>
            <div className="bar-track">
              <div
                className={`bar-fill ${a !== null && a === lowest ? "weak" : ""}`}
                style={{ width: `${a === null ? 0 : (a / 2) * 100}%` }}
              />
            </div>
            <strong>{a === null ? "—" : `${fmt(a, 2)} / 2`}</strong>
          </div>
        );
      })}
      <p className="muted" style={{ fontSize: 12 }}>A barra em vermelho é o parâmetro em que a operação mais perde pontos.</p>
    </div>
  );
}

function WeeklyEvolution({ list }: { list: Monitoria[] }) {
  const byWeek = new Map<number, number[]>();
  list.forEach((r) => {
    if (r.nota === null || r.date === null) return;
    pushTo(byWeek, mondayOf(r.date), r.nota);
  });
  const weeks = Array.from(byWeek.entries()).sort((a, b) => a[0] - b[0]).slice(-8);
  if (weeks.length === 0) return <p className="empty">Sem monitorias datadas para montar a evolução.</p>;
  return (
    <div className="week-bars">
      {weeks.map(([monday, values]) => {
        const a = avg(values);
        return (
          <div key={monday} className="week-col" title={`${values.length} monitorias`}>
            <strong>{fmt(a)}</strong>
            <div className="col-bar" style={{ height: `${(a / 10) * 110}px` }} />
            <small>{new Date(monday).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</small>
          </div>
        );
      })}
    </div>
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
    dashboard: ["Dashboard gerencial", "Nota, conceitos, parâmetros e alertas da operação."],
    monitorias: ["Base de monitorias", "Avaliações lidas da planilha que alimenta toda a ferramenta."],
    parameters: ["Scorecard de monitoria", "Os 5 parâmetros, a régua de conceitos e o simulador do Processo de Monitoria."],
    team: ["Gestão de equipe", "Cadastre times e colaboradores e acompanhe os indicadores de cada um."],
    reports: ["Relatório semanal", "Resumo executivo, conceitos por time, parâmetros e alertas para a liderança."],
    settings: ["Configurações e Governança", "Fonte de dados e metas do processo."],
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
          <small>Analista de Qualidade</small>
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
        <strong>Planilha conectada:</strong> {sheet.records.length.toLocaleString("pt-BR")} linhas
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
  scorecard,
  goals,
  openAudit,
}: {
  people: Person[];
  records: Monitoria[];
  teamList: string[];
  scorecard: Scorecard;
  goals: Goals;
  openAudit: (person?: Person) => void;
}) {
  const [period, setPeriod] = useState("Últimos 30 dias");
  const [team, setTeam] = useState(ALL_TEAMS);
  const [consultant, setConsultant] = useState(ALL_CONSULTANTS);

  const now = Date.now();
  const w = getWindow(period, now);

  const teamOf = new Map(people.map((p) => [norm(p.name), p.team]));
  const matches = (r: Monitoria) =>
    (team === ALL_TEAMS || (teamOf.get(norm(r.consultor)) ?? NO_TEAM) === team) &&
    (consultant === ALL_CONSULTANTS || norm(r.consultor) === norm(consultant));

  const matched = records.filter(matches);
  const current = matched.filter((r) => inCurrent(r, w));
  const previous = matched.filter((r) => inPrev(r, w));
  const cs = scored(current);
  const ps = scored(previous);

  const curAvg = avg(cs.map((r) => r.nota));
  const prevAvg = avg(ps.map((r) => r.nota));
  const critPct = cs.length ? (cs.filter((r) => r.concept === "Crítico").length / cs.length) * 100 : 0;
  const prevCritPct = ps.length ? (ps.filter((r) => r.concept === "Crítico").length / ps.length) * 100 : 0;
  const csat = csatOf(current);
  const hasPrev = ps.length > 0;
  const disregardedCount = current.length - cs.length;

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
    w
  )
    .filter((r) => r.audits > 0)
    .sort((a, b) => b.score - a.score);

  const alerts = current
    .filter((r) => r.flag || r.concept === "Crítico")
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, 8);

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
          <Dropdown label="PERÍODO" value={period} options={PERIOD_NAMES} onChange={setPeriod} />
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

      <section className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card" onClick={() => openAudit()} style={{ cursor: "pointer" }}>
          <div className="kpi-header">
            <small>NOTA MÉDIA</small>
            <Delta value={hasPrev ? curAvg - prevAvg : null} unit=" pts" />
          </div>
          <div className="kpi-body"><strong>{fmt(curAvg)}</strong><span>/ 10</span></div>
          <p>{hasPrev ? `vs. ${fmt(prevAvg)} no período anterior` : "sem período anterior para comparar"}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>MONITORIAS AVALIADAS</small>
            <Delta value={hasPrev && ps.length ? ((cs.length - ps.length) / ps.length) * 100 : null} />
          </div>
          <div className="kpi-body"><strong>{cs.length.toLocaleString("pt-BR")}</strong></div>
          <p>{disregardedCount > 0 ? `${disregardedCount} desconsiderada(s) (bot)` : period.toLowerCase()}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>TICKETS CRÍTICOS</small>
            <Delta value={hasPrev ? critPct - prevCritPct : null} lowerIsBetter unit=" p.p." />
          </div>
          <div className="kpi-body"><strong>{fmt(critPct)}%</strong></div>
          <p>nota de {rangeLabel("Crítico", scorecard)} pontos</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>CSAT</small>
            {csat.rate !== null && (
              <span className={csat.rate >= goals.csat ? "positive" : "negative"}>
                {csat.rate >= goals.csat ? "na meta" : "abaixo da meta"}
              </span>
            )}
          </div>
          <div className="kpi-body"><strong>{csat.rate === null ? "—" : `${fmt(csat.rate)}%`}</strong></div>
          <p>
            meta {goals.csat}% ·{" "}
            {csat.rate === null ? "sem respostas reconhecidas na coluna CSAT" : `${csat.answered} respostas`}
          </p>
        </article>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h3>Distribuição por conceito</h3>
          <p className="muted" style={{ marginBottom: 4 }}>Quantidade de monitorias em cada faixa da régua.</p>
          <ConceptDistribution list={cs} />
        </section>
        <section className="panel">
          <h3>Média por parâmetro</h3>
          <p className="muted" style={{ marginBottom: 4 }}>Onde a operação perde mais pontos (de 0 a 2).</p>
          <ParamBars list={cs} scorecard={scorecard} />
        </section>
      </div>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h3>Evolução semanal</h3>
        <p className="muted" style={{ marginBottom: 0 }}>Nota média por semana (últimas 8 semanas com dados).</p>
        <WeeklyEvolution list={matched} />
      </section>

      <section className="panel" style={{ marginBottom: 24 }}>
        <div className="panel-heading">
          <div>
            <h3>Alertas para a liderança</h3>
            <p>Tickets Críticos e prioridade possivelmente rebaixada no período</p>
          </div>
          <span className={`badge ${alerts.length ? "warn" : "ok"}`}>{alerts.length ? `${alerts.length} em destaque` : "Nenhum alerta"}</span>
        </div>
        {alerts.length === 0 ? (
          <p className="empty">Nenhum ticket Crítico ou com alerta de prioridade no período.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>SEMANA</th>
                  <th>CONSULTOR</th>
                  <th>TICKET</th>
                  <th>NOTA</th>
                  <th>CONCEITO</th>
                  <th>ALERTA</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((r) => (
                  <tr key={r.id}>
                    <td>{r.week || "—"}</td>
                    <td><strong>{r.consultor}</strong></td>
                    <td>{r.ticket ? <span className="ticket">#{r.ticket}</span> : "—"}</td>
                    <td>{r.nota === null ? "—" : fmt(r.nota, 0)}</td>
                    <td><ConceptPill concept={r.concept} /></td>
                    <td>{r.flag ? "Prioridade possivelmente rebaixada" : "Ticket Crítico"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel ranking-panel">
        <div className="panel-heading">
          <div>
            <h3>Ranking da equipe</h3>
            <p>Nota média dos consultores no período selecionado</p>
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
                      <strong style={{ color: CONCEPT_COLORS[conceptOf(Math.round(row.score), scorecard)] }}>{fmt(row.score)}</strong> / 10
                    </td>
                    <td><Delta value={row.trend} unit=" pts" /></td>
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

function Monitorias({ records }: { records: Monitoria[] }) {
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("Todo o período");
  const [limit, setLimit] = useState(100);

  const w = getWindow(period, Date.now());
  const q = norm(search);
  const showParams = records.some((r) => r.scores);

  const list = records
    .filter((r) => inCurrent(r, w))
    .filter((r) => !q || norm(`${r.consultor} ${r.ticket} ${r.categoria}`).includes(q))
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  return (
    <main className="content">
      <div className="page-actions" style={{ marginBottom: 16 }}>
        <div className="filters">
          <Dropdown label="PERÍODO" value={period} options={PERIOD_NAMES} onChange={(v) => { setPeriod(v); setLimit(100); }} />
          <input
            className="input search"
            placeholder="Buscar consultor, ticket ou categoria"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setLimit(100); }}
          />
        </div>
        <span className="muted-text">{list.length.toLocaleString("pt-BR")} linhas</span>
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
                    <th>TICKET</th>
                    {showParams && [1, 2, 3, 4, 5].map((n) => <th key={n} title="Parâmetro">P{n}</th>)}
                    <th>NOTA</th>
                    <th>CONCEITO</th>
                    <th>CSAT</th>
                    <th>ALERTA</th>
                  </tr>
                </thead>
                <tbody>
                  {list.slice(0, limit).map((m) => (
                    <tr key={m.id}>
                      <td>{m.week || "—"}</td>
                      <td><strong>{m.consultor}</strong></td>
                      <td>{m.categoria || "—"}</td>
                      <td>{m.ticket ? <span className="ticket">#{m.ticket}</span> : "—"}</td>
                      {showParams &&
                        [0, 1, 2, 3, 4].map((i) => (
                          <td key={i}>{m.scores ? <ScoreCell value={m.scores[i]} /> : "—"}</td>
                        ))}
                      <td>{m.disregarded ? <span className="muted-text">Desconsiderado</span> : <strong>{fmt(m.nota ?? 0, 0)}</strong>}</td>
                      <td><ConceptPill concept={m.concept} /></td>
                      <td>{m.csat || "—"}</td>
                      <td>{m.flag ? <span className="negative">Prioridade</span> : "—"}</td>
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
   PARÂMETROS (scorecard do Processo de Monitoria)
   ===================================================================== */

function Parameters({
  scorecard,
  setScorecard,
}: {
  scorecard: Scorecard;
  setScorecard: (sc: Scorecard) => void;
}) {
  const [tab, setTab] = useState<"params" | "scale" | "sim">("params");
  const [editing, setEditing] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [sim, setSim] = useState<(number | null)[]>([2, 2, 2, 2, 2]);
  const [payroll, setPayroll] = useState(false);

  const updateParam = (id: number, patch: Partial<Param>) =>
    setScorecard({ ...scorecard, params: scorecard.params.map((p) => (p.id === id ? { ...p, ...patch } : p)) });

  const setThreshold = (key: "excellentMin" | "adequateMin" | "attentionMin", value: number) => {
    const next = { ...scorecard, [key]: value };
    if (next.excellentMin > next.adequateMin && next.adequateMin > next.attentionMin && next.attentionMin >= 1) {
      setScorecard(next);
    }
  };

  const reset = () => {
    setScorecard(DEFAULT_SCORECARD);
    setConfirmReset(false);
    setEditing(false);
  };

  const applicable = sim.filter((s): s is number => s !== null);
  const obtained = applicable.reduce((a, b) => a + b, 0);
  const possible = applicable.length * 2;
  const simTotal = totalFromScores(sim);
  const simConcept: Concept | null = payroll ? "Crítico" : simTotal === null ? null : conceptOf(simTotal, scorecard);

  const thresholdOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  return (
    <main className="content parameters-page">
      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="page-actions">
          <div>
            <h3>Scorecard {scorecard.version}</h3>
            <p className="muted">
              5 parâmetros, cada um vale 0 (não atende), 1 (parcial) ou 2 (atende plenamente). Total de 0 a 10 pontos por ticket.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {editing && (confirmReset ? (
              <>
                <button className="secondary-button" onClick={() => setConfirmReset(false)}>Cancelar</button>
                <button className="danger-button" onClick={reset}>Confirmar restauração</button>
              </>
            ) : (
              <button className="secondary-button" onClick={() => setConfirmReset(true)}>Restaurar padrão V4</button>
            ))}
            <button className={editing ? "primary-button" : "secondary-button"} onClick={() => { setEditing(!editing); setConfirmReset(false); }}>
              {editing ? "Concluir edição" : "Editar scorecard"}
            </button>
          </div>
        </div>
        {editing && (
          <div className="notice">
            Modo de edição: mudanças no scorecard só entram em vigor oficialmente após aprovação da diretoria de atendimento (processo, seção 7).
          </div>
        )}
      </div>

      <Tabs
        tabs={[
          { id: "params", label: "Parâmetros" },
          { id: "scale", label: "Régua e regras" },
          { id: "sim", label: "Simulador" },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === "params" && (
        <div style={{ display: "grid", gap: 16 }}>
          {scorecard.params.map((p) => (
            <section key={p.id} className="param-card">
              <div className="param-head">
                <span className="param-num">{p.id}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editing ? (
                    <input className="input" value={p.name} onChange={(e) => updateParam(p.id, { name: e.target.value })} />
                  ) : (
                    <h4>{p.name}</h4>
                  )}
                  {editing ? (
                    <textarea
                      className="input"
                      rows={2}
                      style={{ marginTop: 8 }}
                      value={p.evaluates}
                      onChange={(e) => updateParam(p.id, { evaluates: e.target.value })}
                    />
                  ) : (
                    <p className="muted">{p.evaluates}</p>
                  )}
                </div>
                {editing ? (
                  <label className="check">
                    <input type="checkbox" checked={p.canBeNA} onChange={(e) => updateParam(p.id, { canBeNA: e.target.checked })} />
                    pode ser “-”
                  </label>
                ) : (
                  p.canBeNA && <span className="badge ok">pode ser “-”</span>
                )}
              </div>

              <div className="rubric-grid">
                {(
                  [
                    ["full", "2 pontos · Atende", p.full],
                    ["partial", "1 ponto · Parcial", p.partial],
                    ["none", "0 ponto · Não atende", p.none],
                  ] as const
                ).map(([key, label, text]) => (
                  <div key={key} className={`rubric ${key}`}>
                    <small>{label.toUpperCase()}</small>
                    {editing ? (
                      <textarea
                        className="input"
                        rows={3}
                        value={text}
                        onChange={(e) => updateParam(p.id, { [key]: e.target.value } as Partial<Param>)}
                      />
                    ) : (
                      <p>{text}</p>
                    )}
                  </div>
                ))}
              </div>

              <div className="param-rule">
                <small>REGRA ESPECÍFICA</small>
                {editing ? (
                  <textarea className="input" rows={3} value={p.rule} onChange={(e) => updateParam(p.id, { rule: e.target.value })} />
                ) : (
                  <p>{p.rule}</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {tab === "scale" && (
        <>
          <section className="panel">
            <h3>Régua de conceitos</h3>
            <p className="muted">O conceito é sempre calculado a partir da nota total (0 a 10).</p>
            <div className="concept-cards">
              {CONCEPTS.map((c) => (
                <div key={c} className="concept-card" style={{ borderColor: `${CONCEPT_COLORS[c]}66` }}>
                  <ConceptPill concept={c} />
                  <strong className="concept-range">{rangeLabel(c, scorecard)}</strong>
                  <p>{CONCEPT_READING[c]}</p>
                </div>
              ))}
            </div>
            {editing && (
              <div className="inline-form">
                {(
                  [
                    ["excellentMin", "EXCELENTE A PARTIR DE"],
                    ["adequateMin", "ADEQUADO A PARTIR DE"],
                    ["attentionMin", "ATENÇÃO A PARTIR DE"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <label className="field-label">{label}</label>
                    <select className="input" value={scorecard[key]} onChange={(e) => setThreshold(key, Number(e.target.value))}>
                      {thresholdOptions.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
                <p className="muted" style={{ fontSize: 12, flexBasis: "100%", margin: 0 }}>
                  Os limites precisam ficar em ordem decrescente (Excelente &gt; Adequado &gt; Atenção). Valores inválidos são ignorados.
                </p>
              </div>
            )}
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <h3>Cálculo da nota</h3>
            <p className="muted">
              Soma dos 5 parâmetros (0 a 10). Quando algum parâmetro não se aplica (“-”), a nota é proporcional: pontos obtidos ÷ pontos
              possíveis × 10, arredondada para o inteiro mais próximo.
            </p>
            <div className="rule-block" style={{ marginTop: 12 }}>
              <strong>Exemplo:</strong> 5 de 6 pontos possíveis = 5 ÷ 6 × 10 = 8,33, que arredonda para <strong>8</strong>.
            </div>
            <p className="muted" style={{ fontSize: 12 }}>
              Quando o resultado cair exatamente em meio ponto (2,5 ou 7,5), a ferramenta arredonda para cima.
            </p>
          </section>

          <section className="panel" style={{ marginTop: 20 }}>
            <h3>Regras gerais da avaliação</h3>
            <ul className="rules-list">
              {GENERAL_RULES.map((r) => <li key={r}>{r}</li>)}
            </ul>
          </section>
        </>
      )}

      {tab === "sim" && (
        <section className="panel">
          <h3>Simulador de nota</h3>
          <p className="muted">Escolha a nota de cada parâmetro e veja o total e o conceito, com as mesmas regras do processo.</p>
          <div className="sim-grid" style={{ marginTop: 16 }}>
            {scorecard.params.map((p, i) => {
              const options: (number | null)[] = p.canBeNA ? [0, 1, 2, null] : [0, 1, 2];
              return (
                <div key={p.id} className="sim-item">
                  <span>{p.id}. {p.name}</span>
                  <div className="seg">
                    {options.map((v) => (
                      <button
                        key={String(v)}
                        className={sim[i] === v ? "on" : ""}
                        onClick={() => setSim(sim.map((s, j) => (j === i ? v : s)))}
                      >
                        {v === null ? "-" : v}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <label className="check" style={{ marginTop: 16 }}>
            <input type="checkbox" checked={payroll} onChange={(e) => setPayroll(e.target.checked)} />
            Prioridade/FLAG rebaixada indevidamente em caso com impacto em folha de pagamento
          </label>

          <div className="sim-result">
            <span>
              {possible === 0 ? "Sem pontos possíveis" : `${obtained} de ${possible} pontos`}
              {possible > 0 && possible < 10 ? " (proporcional)" : ""}
            </span>
            <strong>{simTotal === null ? "—" : simTotal} / 10</strong>
            <ConceptPill concept={simConcept} />
          </div>
          {payroll && (
            <p className="muted" style={{ fontSize: 12 }}>
              Exceção do processo: prioridade rebaixada indevidamente em caso de folha leva o ticket direto para Crítico, independentemente do total.
            </p>
          )}
        </section>
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

  const rows = computeRows(people, records, getWindow("Todo o período", Date.now()));
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
              <div className="kpi-body"><strong>{fmt(weightedScore(rows))}</strong><span>/ 10</span></div>
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
                        <td>{a.audits ? <><strong>{fmt(a.score)}</strong> / 10</> : "—"}</td>
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
                  placeholder="Ex: Torre Ametista"
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
   RELATÓRIO SEMANAL
   ===================================================================== */

function Reports({
  people,
  records,
  teamList,
  scorecard,
  goals,
}: {
  people: Person[];
  records: Monitoria[];
  teamList: string[];
  scorecard: Scorecard;
  goals: Goals;
}) {
  const [period, setPeriod] = useState("Semana anterior");
  const w = getWindow(period, Date.now());

  const list = records.filter((r) => inCurrent(r, w));
  const prevList = records.filter((r) => inPrev(r, w));
  const cs = scored(list);
  const ps = scored(prevList);

  const avgNow = avg(cs.map((r) => r.nota));
  const avgPrev = avg(ps.map((r) => r.nota));
  const csat = csatOf(list);
  const criticalCount = cs.filter((r) => r.concept === "Crítico").length;
  const alerts = list
    .filter((r) => r.flag || r.concept === "Crítico")
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  const teamOf = new Map(people.map((p) => [norm(p.name), p.team]));
  const teamRows = teamList.map((t) => {
    const items = cs.filter((r) => (teamOf.get(norm(r.consultor)) ?? NO_TEAM) === t);
    return { name: t, count: items.length, score: avg(items.map((r) => r.nota)), counts: conceptCounts(items) };
  });

  const byCategory = new Map<string, Scored[]>();
  cs.forEach((r) => {
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
      critical: items.filter((i) => i.concept === "Crítico").length,
    }))
    .sort((a, b) => b.count - a.count);

  const periodNote =
    period === "Semana anterior"
      ? `${fmtDate(w.from)} a ${fmtDate(w.to - DAY)}`
      : period === "Todo o período"
      ? "histórico completo"
      : period.toLowerCase();

  return (
    <main className="content">
      <div className="page-actions" style={{ marginBottom: 16 }}>
        <Dropdown label="PERÍODO" value={period} options={PERIOD_NAMES} onChange={setPeriod} />
        <span className="muted-text">Período do relatório: {periodNote}</span>
      </div>

      <section className="kpis" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <article className="kpi-card">
          <div className="kpi-header"><small>TICKETS AVALIADOS</small></div>
          <div className="kpi-body"><strong>{cs.length.toLocaleString("pt-BR")}</strong></div>
          <p>{list.length - cs.length > 0 ? `${list.length - cs.length} desconsiderado(s)` : "100% pontuados"}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>NOTA MÉDIA (DE 10)</small>
            <Delta value={ps.length ? avgNow - avgPrev : null} unit=" pts" />
          </div>
          <div className="kpi-body"><strong>{fmt(avgNow)}</strong></div>
          <p>{ps.length ? `vs. ${fmt(avgPrev)} no período anterior` : "sem período anterior"}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>CSAT</small>
            {csat.rate !== null && (
              <span className={csat.rate >= goals.csat ? "positive" : "negative"}>
                {csat.rate >= goals.csat ? "na meta" : "abaixo da meta"}
              </span>
            )}
          </div>
          <div className="kpi-body"><strong>{csat.rate === null ? "—" : `${fmt(csat.rate)}%`}</strong></div>
          <p>meta {goals.csat}%</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>TICKETS CRÍTICOS</small></div>
          <div className="kpi-body"><strong>{criticalCount}</strong></div>
          <p>{cs.length ? `${fmt((criticalCount / cs.length) * 100)}% dos avaliados` : "—"}</p>
        </article>
      </section>

      <div className="grid-2">
        <section className="panel">
          <h3>Distribuição por conceito</h3>
          <ConceptDistribution list={cs} />
        </section>
        <section className="panel">
          <h3>Média por parâmetro</h3>
          <ParamBars list={cs} scorecard={scorecard} />
        </section>
      </div>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h3>Conceitos por time</h3>
        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>TIME</th>
                <th>AVALIADOS</th>
                <th>NOTA MÉDIA</th>
                {CONCEPTS.map((c) => <th key={c}>{c.toUpperCase()}</th>)}
              </tr>
            </thead>
            <tbody>
              {teamRows.map((t) => (
                <tr key={t.name}>
                  <td><strong>{t.name}</strong></td>
                  <td>{t.count}</td>
                  <td>{t.count ? fmt(t.score) : "—"}</td>
                  {CONCEPTS.map((c) => (
                    <td key={c}>
                      {t.counts[c]} <span className="muted-text">({t.count ? fmt((t.counts[c] / t.count) * 100, 0) : 0}%)</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 24 }}>
        <h3>Alertas para a liderança</h3>
        <p className="muted">Prioridade possivelmente rebaixada e tickets Críticos (nota de {rangeLabel("Crítico", scorecard)}).</p>
        {alerts.length === 0 ? (
          <p className="empty">Nenhum alerta no período.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>SEMANA</th>
                  <th>CONSULTOR</th>
                  <th>TICKET</th>
                  <th>NOTA</th>
                  <th>ALERTA</th>
                  <th>PONTO DE ATENÇÃO</th>
                </tr>
              </thead>
              <tbody>
                {alerts.slice(0, 30).map((r) => (
                  <tr key={r.id}>
                    <td>{r.week || "—"}</td>
                    <td><strong>{r.consultor}</strong></td>
                    <td>{r.ticket ? <span className="ticket">#{r.ticket}</span> : "—"}</td>
                    <td>{r.nota === null ? "—" : fmt(r.nota, 0)}</td>
                    <td>{r.flag ? "Prioridade possivelmente rebaixada" : "Ticket Crítico"}</td>
                    <td className="wrap-cell">{r.attention || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h3>Por categoria</h3>
        {categoryRows.length === 0 ? (
          <p className="empty">Sem monitorias no período.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>CATEGORIA</th>
                  <th>AVALIADOS</th>
                  <th>NOTA MÉDIA</th>
                  <th>CRÍTICOS</th>
                </tr>
              </thead>
              <tbody>
                {categoryRows.map((c) => (
                  <tr key={c.name}>
                    <td><strong>{c.name}</strong></td>
                    <td>{c.count}</td>
                    <td>{fmt(c.score)}</td>
                    <td>{c.critical}</td>
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
   CONFIGURAÇÕES
   ===================================================================== */

function Settings({
  goals,
  setGoals,
  sheet,
  reload,
  sheetUrlSetting,
  setSheetUrlSetting,
}: {
  goals: Goals;
  setGoals: (goals: Goals) => void;
  sheet: SheetState;
  reload: () => void;
  sheetUrlSetting: string;
  setSheetUrlSetting: (url: string) => void;
}) {
  const [csat, setCsat] = useState(String(goals.csat));
  const [agreement, setAgreement] = useState(String(goals.agreement));
  const [feedback, setFeedback] = useState(String(goals.feedback));
  const [message, setMessage] = useState("");
  const [urlInput, setUrlInput] = useState(sheetUrlSetting);
  const [urlError, setUrlError] = useState("");

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

  const saveGoals = () => {
    const c = Number(csat);
    const a = Number(agreement);
    const f = Number(feedback);
    if ([c, a, f].some((n) => !(n >= 0 && n <= 100))) {
      setMessage("Verifique os valores: cada meta deve ficar entre 0 e 100.");
      return;
    }
    setGoals({ csat: c, agreement: a, feedback: f });
    setMessage("Metas salvas com sucesso!");
  };

  const statusLabel =
    sheet.status === "ok"
      ? "Conectada"
      : sheet.status === "loading"
      ? "Carregando…"
      : sheet.status === "error"
      ? "Com erro"
      : "Não conectada (modo demonstração)";

  const paramMissing = sheet.status === "ok" && sheet.mapping.filter((m) => /^p[1-5]$/.test(m.field) && !m.header).length > 0;

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
          <p className="muted" style={{ fontSize: 12 }}>Usando o link padrão configurado na Vercel (VITE_SHEET_CSV_URL).</p>
        )}
        {sheet.status === "error" && <div className="notice">{sheet.message}</div>}

        <div className="rule-block" style={{ marginTop: 16 }}>
          <strong>Como conectar</strong>
          <ol className="steps">
            <li>Na planilha: <b>Arquivo → Compartilhar → Publicar na web</b>.</li>
            <li>Escolha a <b>aba</b> com as monitorias e o formato <b>Valores separados por vírgula (.csv)</b>, e clique em <b>Publicar</b>.</li>
            <li>Copie o link gerado e cole no campo acima. Para valer para todos os usuários, cadastre o mesmo link na Vercel como <b>VITE_SHEET_CSV_URL</b> e faça um novo deploy.</li>
          </ol>
          <p className="muted" style={{ fontSize: 12, margin: 0 }}>
            Atenção: quem tiver o link consegue ler os dados da aba publicada. Não publique nada que não possa ser visto por terceiros.
          </p>
        </div>

        {sheet.status === "ok" && (
          <div style={{ marginTop: 16 }}>
            <div className="editor-title">COLUNAS RECONHECIDAS</div>
            {paramMissing && (
              <div className="notice">
                Algumas colunas dos 5 parâmetros não foram encontradas. Sem elas, a ferramenta usa só a nota total e não mostra a média por parâmetro.
              </div>
            )}
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
        <h3>Metas do processo</h3>
        <p className="muted">Indicadores da seção 8 do Processo de Monitoria. Os pesos e a régua ficam na página Parâmetros.</p>
        <div style={{ marginTop: 16, display: "grid", gap: 16 }}>
          <div className="rule-block">
            <strong>CSAT (meta, %)</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>Indicador de resultado. Usado nos cards de CSAT do Dashboard e do relatório.</p>
            <input className="input" style={{ width: 120 }} type="number" min={0} max={100} value={csat} onChange={(e) => setCsat(e.target.value)} />
          </div>
          <div className="rule-block">
            <strong>Concordância IA × analista (meta, %)</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>Referência para a liberação do agente de IA (fase 06). Ainda não calculada pela ferramenta.</p>
            <input className="input" style={{ width: 120 }} type="number" min={0} max={100} value={agreement} onChange={(e) => setAgreement(e.target.value)} />
          </div>
          <div className="rule-block">
            <strong>Feedbacks aplicados no prazo (meta, %)</strong>
            <p className="muted" style={{ fontSize: 12, margin: "4px 0 10px" }}>Execução do ciclo pela liderança (até sexta-feira). Ainda não calculada pela ferramenta.</p>
            <input className="input" style={{ width: 120 }} type="number" min={0} max={100} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          </div>
        </div>
        <button className="primary-button" style={{ marginTop: 20 }} onClick={saveGoals}>Salvar metas</button>
        {message && <div className="notice success" style={{ marginTop: 14 }}>{message}</div>}
      </div>
    </main>
  );
}

/* =====================================================================
   SCORECARD DO CONSULTOR (drawer)
   ===================================================================== */

function AuditDrawer({
  person,
  records,
  scorecard,
  close,
}: {
  person: Person | null;
  records: Monitoria[];
  scorecard: Scorecard;
  close: () => void;
}) {
  const own = records.filter((r) => !person || norm(r.consultor) === norm(person.name));
  const cs = scored(own);
  const latest = [...own].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)).slice(0, 10);

  return (
    <div className="drawer-overlay" onClick={close}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: 560, display: "flex", flexDirection: "column", padding: 0 }}>
        <div className="drawer-header" style={{ padding: 20, borderBottom: "1px solid var(--line)", marginBottom: 0 }}>
          <div>
            <h3>{person ? `Scorecard de ${person.name}` : "Scorecard geral"}</h3>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 12 }}>{person ? person.team : "Todos os consultores"}</p>
          </div>
          <button onClick={close} className="secondary-button">Fechar</button>
        </div>
        <div className="drawer-body" style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {own.length === 0 ? (
            <p className="empty">Nenhuma monitoria registrada.</p>
          ) : (
            <>
              <div className="kpi-body" style={{ marginTop: 0 }}>
                <strong>{fmt(avg(cs.map((r) => r.nota)))}</strong>
                <span>/ 10 · nota média em {cs.length} monitorias</span>
              </div>

              <div className="editor-title" style={{ marginTop: 20 }}>DISTRIBUIÇÃO POR CONCEITO</div>
              <ConceptDistribution list={cs} />

              <div className="editor-title" style={{ marginTop: 24 }}>MÉDIA POR PARÂMETRO</div>
              <ParamBars list={cs} scorecard={scorecard} />

              <div className="editor-title" style={{ marginTop: 24 }}>ÚLTIMAS MONITORIAS</div>
              <div className="block-items" style={{ marginTop: 10 }}>
                {latest.map((r) => (
                  <div key={r.id} className="rule-block" style={{ lineHeight: 1.7 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                      <strong>{person ? r.categoria || "Sem categoria" : r.consultor}</strong>
                      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        {r.disregarded ? <span className="muted-text">Desconsiderado</span> : <strong>{fmt(r.nota ?? 0, 0)}</strong>}
                        <ConceptPill concept={r.concept} />
                      </span>
                    </div>
                    <div className="muted" style={{ fontSize: 12, margin: 0 }}>
                      {[r.week, r.ticket && `#${r.ticket}`, r.csat && `CSAT: ${r.csat}`, r.flag && "Prioridade possivelmente rebaixada"]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {r.scores && (
                      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                        {r.scores.map((s, i) => <ScoreCell key={i} value={s} />)}
                      </div>
                    )}
                    {r.attention && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{r.attention}</div>}
                  </div>
                ))}
              </div>
            </>
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
  const [scorecard, setScorecard] = usePersistentState<Scorecard>("qualita:v3:scorecard", DEFAULT_SCORECARD);
  const [goals, setGoals] = usePersistentState<Goals>("qualita:v3:goals", DEFAULT_GOALS);
  const [sheetUrlSetting, setSheetUrlSetting] = usePersistentState<string>("qualita:v2:sheetUrl", "");

  const sheetUrl = resolveSheetUrl(sheetUrlSetting || ENV_URL);
  const [sheet, reload] = useSheet(sheetUrl);
  const isDemo = sheet.status === "demo";

  /* O conceito vem da planilha quando existir; senão é calculado pela régua do scorecard */
  const records = useMemo(
    () =>
      sheet.records.map((r) =>
        r.nota === null || r.concept ? r : { ...r, concept: conceptOf(r.nota, scorecard) }
      ),
    [sheet.records, scorecard]
  );

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
          <Dashboard
            people={people}
            records={records}
            teamList={teamList}
            scorecard={scorecard}
            goals={goals}
            openAudit={openAudit}
          />
        )}
        {page === "monitorias" && <Monitorias records={records} />}
        {page === "parameters" && <Parameters scorecard={scorecard} setScorecard={setScorecard} />}
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
        {page === "reports" && (
          <Reports people={people} records={records} teamList={teamList} scorecard={scorecard} goals={goals} />
        )}
        {page === "settings" && (
          <Settings
            goals={goals}
            setGoals={setGoals}
            sheet={sheet}
            reload={reload}
            sheetUrlSetting={sheetUrlSetting}
            setSheetUrlSetting={setSheetUrlSetting}
          />
        )}
      </div>
      {auditOpen && <AuditDrawer person={auditPerson} records={records} scorecard={scorecard} close={() => setAuditOpen(false)} />}
    </div>
  );
}
