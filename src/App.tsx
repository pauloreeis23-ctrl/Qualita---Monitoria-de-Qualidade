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
  authExpired: boolean;
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
      name: "Comunicação e praz
