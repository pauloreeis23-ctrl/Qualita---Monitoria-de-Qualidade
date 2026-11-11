import React, { useEffect, useState } from "react";

/* ============================== Tipos ============================== */

type Agent = {
  id: number;
  name: string;
  team: string;
  audits: number;
  score: number;
  trend: number;
  initials: string;
  color: string;
};

type Block = { id: number; name: string; weight: number; desc: string };

type Config = { profile: string; minScore: number; targetAudits: number };

/* ============================== Dados iniciais ============================== */

const DEFAULT_TEAMS = ["Equipe Safira", "Equipe Esmeralda", "Equipe Rubi"];
const PALETTE = ["#826be0", "#61c5b2", "#e5a45c", "#5ea3e0", "#d46a8a", "#b86bd1"];
const BLOCK_COLORS = ["#826be0", "#61c5b2", "#e5a45c", "#5ea3e0", "#d46a8a", "#b86bd1", "#4fa3a5", "#d9776a"];

const INITIAL_AGENTS: Agent[] = [
  { id: 1, name: "Marina Costa", team: "Equipe Safira", audits: 48, score: 96.8, trend: 2.4, initials: "MC", color: "#826be0" },
  { id: 2, name: "Rafael Martins", team: "Equipe Safira", audits: 45, score: 94.2, trend: 1.8, initials: "RM", color: "#61c5b2" },
  { id: 3, name: "Ana Carolina", team: "Equipe Esmeralda", audits: 41, score: 91.7, trend: 0.6, initials: "AC", color: "#e5a45c" },
  { id: 4, name: "Carlos Lima", team: "Equipe Esmeralda", audits: 37, score: 87.4, trend: 1.2, initials: "CL", color: "#5ea3e0" },
  { id: 5, name: "Bianca Oliveira", team: "Equipe Safira", audits: 34, score: 84.9, trend: 1.1, initials: "BO", color: "#b86bd1" },
  { id: 6, name: "Diego Freitas", team: "Equipe Esmeralda", audits: 32, score: 78.6, trend: -2.3, initials: "DF", color: "#d9776a" },
  { id: 7, name: "Juliana Alves", team: "Equipe Rubi", audits: 29, score: 93.1, trend: 3.2, initials: "JA", color: "#4fa3a5" },
];

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

const PERIODS: Record<string, { factor: number; scoreDelta: number; auditsDelta: number }> = {
  "Últimos 7 dias": { factor: 0.23, scoreDelta: 1.1, auditsDelta: 3.4 },
  "Últimos 15 dias": { factor: 0.5, scoreDelta: 2.3, auditsDelta: 6.8 },
  "Últimos 30 dias": { factor: 1, scoreDelta: 4.2, auditsDelta: 12.5 },
  "Últimos 90 dias": { factor: 3, scoreDelta: 5.6, auditsDelta: 18.9 },
};

const ALL_TEAMS = "Todos os times";
const ALL_CONSULTANTS = "Todos os consultores";

/* ============================== Utilitários ============================== */

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

const fmt = (n: number, digits = 1) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

const fmtTrend = (t: number) => `${t >= 0 ? "+" : "-"}${fmt(Math.abs(t))}%`;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

function weightedScore(list: Agent[]) {
  const total = list.reduce((sum, a) => sum + a.audits, 0);
  if (!total) return 0;
  return list.reduce((sum, a) => sum + a.score * a.audits, 0) / total;
}

/* Junta os times cadastrados com qualquer time que ainda apareça em algum colaborador */
function unionTeams(teams: string[], agents: Agent[]) {
  return Array.from(new Set([...teams, ...agents.map((a) => a.team)]));
}

/* ============================== Componentes base ============================== */

function Icon({ size = 18 }: { name?: string; size?: number }) {
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

function Sidebar({ page, setPage }: { page: string; setPage: (val: string) => void }) {
  const items = [
    ["dashboard", "Dashboard"],
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
    parameters: ["Construtor de parâmetros", "Defina os critérios da avaliação e quanto cada um pesa na nota final."],
    team: ["Gestão de equipe", "Cadastre times e colaboradores e acompanhe os indicadores de cada um."],
    reports: ["Relatórios analíticos", "Explore tendências e exporte dados consolidados da operação."],
    settings: ["Configurações e Governança", "Gerencie perfis de mercado, metas e preferências."],
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

/* ============================== Dashboard ============================== */

function Dashboard({
  agents,
  teamList,
  config,
  openAudit,
}: {
  agents: Agent[];
  teamList: string[];
  config: Config;
  openAudit: (agent?: Agent) => void;
}) {
  const [period, setPeriod] = useState("Últimos 30 dias");
  const [team, setTeam] = useState(ALL_TEAMS);
  const [consultant, setConsultant] = useState(ALL_CONSULTANTS);

  const meta = PERIODS[period];
  const teamOptions = [ALL_TEAMS, ...teamList];
  const consultantOptions = [
    ALL_CONSULTANTS,
    ...agents.filter((a) => team === ALL_TEAMS || a.team === team).map((a) => a.name),
  ];

  const filtered = agents
    .map((a) => ({ ...a, audits: Math.round(a.audits * meta.factor) }))
    .filter((a) => (team === ALL_TEAMS || a.team === team) && (consultant === ALL_CONSULTANTS || a.name === consultant))
    .sort((a, b) => b.score - a.score);

  const avg = weightedScore(filtered);
  const previousAvg = avg / (1 + meta.scoreDelta / 100);
  const totalAudits = filtered.reduce((sum, a) => sum + a.audits, 0);
  const below = filtered.filter((a) => a.audits > 0 && a.score < config.minScore);
  const deviationRate = totalAudits ? (below.reduce((sum, a) => sum + a.audits, 0) / totalAudits) * 100 : 0;

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
            options={teamOptions}
            onChange={(value) => {
              setTeam(value);
              setConsultant(ALL_CONSULTANTS);
            }}
          />
          <Dropdown label="CONSULTORES" value={consultant} options={consultantOptions} onChange={setConsultant} />
        </div>
        <button className="secondary-button" onClick={clearFilters}>Limpar filtros</button>
      </section>

      <section className="kpis">
        <article className="kpi-card" onClick={() => openAudit()} style={{ cursor: "pointer" }}>
          <div className="kpi-header">
            <small>NOTA MÉDIA GERAL</small>
            <span className="positive">+{fmt(meta.scoreDelta)}%</span>
          </div>
          <div className="kpi-body"><strong>{fmt(avg)}</strong><span>/ 100</span></div>
          <p>vs. {fmt(previousAvg)} no período anterior</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>AUDITORIAS REALIZADAS</small>
            <span className="positive">+{fmt(meta.auditsDelta)}%</span>
          </div>
          <div className="kpi-body"><strong>{totalAudits.toLocaleString("pt-BR")}</strong></div>
          <p>{period.toLowerCase()}</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header">
            <small>TAXA DE DESVIOS</small>
            <span className={below.length ? "negative" : "positive"}>{below.length} abaixo da meta</span>
          </div>
          <div className="kpi-body"><strong>{fmt(deviationRate)}%</strong></div>
          <p>auditorias de consultores abaixo de {config.minScore} pontos</p>
        </article>
      </section>

      <section className="panel ranking-panel">
        <div className="panel-heading">
          <div>
            <h3>Ranking da equipe</h3>
            <p>Desempenho dos consultores no período selecionado</p>
          </div>
          <button className="secondary-button" onClick={() => openAudit()}>Ver auditorias</button>
        </div>
        {filtered.length === 0 ? (
          <p className="empty">Nenhum consultor encontrado para os filtros selecionados.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>CONSULTOR</th>
                <th>TIME</th>
                <th>AUDITORIAS</th>
                <th>NOTA MÉDIA</th>
                <th>EVOLUÇÃO</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent, index) => (
                <tr key={agent.id} onClick={() => openAudit(agent)} style={{ cursor: "pointer" }}>
                  <td><span className={`rank rank-${index + 1}`}>{index + 1}</span></td>
                  <td>
                    <div className="agent">
                      <span className="avatar" style={{ background: agent.color }}>{agent.initials}</span>
                      <strong>{agent.name}</strong>
                    </div>
                  </td>
                  <td>{agent.team}</td>
                  <td>{agent.audits}</td>
                  <td>{agent.audits ? <><strong>{fmt(agent.score)}</strong> / 100</> : "—"}</td>
                  <td>
                    <span className={agent.trend >= 0 ? "positive" : "negative"}>{fmtTrend(agent.trend)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

/* ============================== Parâmetros ============================== */

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

      {/* Resumo da distribuição de pesos (aparece nas duas abas) */}
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
      </div>

      {tab === "edit" && (
        <div className="param-layout">
          {/* Coluna esquerda: lista de blocos */}
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

          {/* Coluna direita: edição do bloco selecionado */}
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

/* ============================== Equipe (Times + Colaboradores) ============================== */

function Team({
  agents,
  setAgents,
  teams,
  setTeams,
  openAudit,
}: {
  agents: Agent[];
  setAgents: (agents: Agent[]) => void;
  teams: string[];
  setTeams: (teams: string[]) => void;
  openAudit: (agent?: Agent) => void;
}) {
  const [view, setView] = useState<"teams" | "people">("teams");
  const [modal, setModal] = useState<"none" | "team" | "person">("none");
  const [teamFilter, setTeamFilter] = useState(ALL_TEAMS);
  const [success, setSuccess] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const [teamName, setTeamName] = useState("");
  const [personName, setPersonName] = useState("");
  const [personTeam, setPersonTeam] = useState("");
  const [error, setError] = useState("");

  const teamList = unionTeams(teams, agents);

  const closeModal = () => {
    setModal("none");
    setError("");
    setTeamName("");
    setPersonName("");
  };

  const openTeamModal = () => {
    setSuccess("");
    setModal("team");
  };

  const openPersonModal = () => {
    setSuccess("");
    setPersonTeam(teamFilter !== ALL_TEAMS ? teamFilter : teamList[0] ?? "");
    setModal("person");
  };

  const addTeam = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = teamName.trim().replace(/\s+/g, " ");
    if (!clean) {
      setError("Informe o nome do time.");
      return;
    }
    if (teamList.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setError("Já existe um time com esse nome.");
      return;
    }
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
    if (!clean) {
      setError("Informe o nome do colaborador.");
      return;
    }
    if (!personTeam) {
      setError("Selecione um time.");
      return;
    }
    if (agents.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
      setError("Já existe um colaborador com esse nome.");
      return;
    }
    const newMember: Agent = {
      id: Date.now(),
      name: clean,
      team: personTeam,
      audits: 0,
      score: 0,
      trend: 0,
      initials: clean.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(),
      color: PALETTE[agents.length % PALETTE.length],
    };
    setAgents([...agents, newMember]);
    setSuccess(`${clean} foi cadastrado(a) em ${personTeam}.`);
    closeModal();
  };

  const teamStats = teamList.map((name) => {
    const members = agents.filter((a) => a.team === name);
    return {
      name,
      members,
      audits: members.reduce((sum, a) => sum + a.audits, 0),
      avg: members.some((a) => a.audits) ? weightedScore(members) : null,
    };
  });

  const people = agents
    .filter((a) => teamFilter === ALL_TEAMS || a.team === teamFilter)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  return (
    <main className="content">
      <Tabs
        tabs={[
          { id: "teams", label: `Times (${teamList.length})` },
          { id: "people", label: `Colaboradores (${agents.length})` },
        ]}
        value={view}
        onChange={(v) => {
          setView(v);
          setSuccess("");
        }}
      />

      {success && <div className="notice success" style={{ marginTop: 0, marginBottom: 16 }}>{success}</div>}

      {/* ---------- DASH DE TIMES ---------- */}
      {view === "teams" && (
        <>
          <section className="kpis">
            <article className="kpi-card">
              <div className="kpi-header"><small>TIMES ATIVOS</small></div>
              <div className="kpi-body"><strong>{teamList.length}</strong></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-header"><small>COLABORADORES</small></div>
              <div className="kpi-body"><strong>{agents.length}</strong></div>
            </article>
            <article className="kpi-card">
              <div className="kpi-header"><small>NOTA MÉDIA GERAL</small></div>
              <div className="kpi-body"><strong>{fmt(weightedScore(agents))}</strong><span>/ 100</span></div>
            </article>
          </section>

          <div className="page-actions" style={{ marginBottom: 16 }}>
            <h3>Times</h3>
            <button className="primary-button" onClick={openTeamModal}>+ Cadastrar novo time</button>
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
                  <div className="team-metrics">
                    <div><small>AUDITORIAS</small><strong>{t.audits}</strong></div>
                    <div><small>NOTA MÉDIA</small><strong>{t.avg === null ? "—" : fmt(t.avg)}</strong></div>
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

      {/* ---------- DASH DE COLABORADORES ---------- */}
      {view === "people" && (
        <>
          <div className="page-actions" style={{ marginBottom: 16 }}>
            <Dropdown label="TIME" value={teamFilter} options={[ALL_TEAMS, ...teamList]} onChange={setTeamFilter} />
            <button className="primary-button" onClick={openPersonModal}>+ Cadastrar novo colaborador</button>
          </div>

          <div className="panel">
            {people.length === 0 ? (
              <p className="empty">Nenhum colaborador neste filtro.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>COLABORADOR</th>
                    <th>TIME</th>
                    <th>AUDITORIAS</th>
                    <th>NOTA MÉDIA</th>
                    <th>EVOLUÇÃO</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((a) => (
                    <tr key={a.id} onClick={() => openAudit(a)} style={{ cursor: "pointer" }}>
                      <td>
                        <div className="agent">
                          <span className="avatar" style={{ background: a.color }}>{a.initials}</span>
                          <strong>{a.name}</strong>
                        </div>
                      </td>
                      <td>{a.team}</td>
                      <td>{a.audits}</td>
                      <td>{a.audits ? <><strong>{fmt(a.score)}</strong> / 100</> : "—"}</td>
                      <td>
                        {a.audits ? <span className={a.trend >= 0 ? "positive" : "negative"}>{fmtTrend(a.trend)}</span> : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ---------- Painel: novo time ---------- */}
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

      {/* ---------- Painel: novo colaborador ---------- */}
      {modal === "person" && (
        <div className="drawer-overlay" onClick={closeModal}>
          <div className="drawer" style={{ width: 400 }} onClick={(e) => e.stopPropagation()}>
            <h3>Cadastrar novo colaborador</h3>
            <p className="muted" style={{ fontSize: 13 }}>Informe o nome e o time do novo membro.</p>
            {teamList.length === 0 ? (
              <>
                <div className="notice" style={{ marginTop: 20 }}>Cadastre ao menos um time antes de adicionar colaboradores.</div>
                <button className="secondary-button" style={{ marginTop: 14 }} onClick={closeModal}>Fechar</button>
              </>
            ) : (
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
                    {teamList.map((t) => <option key={t}>{t}</option>)}
                  </select>
                </div>
                {error && <p className="negative" style={{ margin: 0 }}>{error}</p>}
                <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                  <button type="button" className="secondary-button" style={{ flex: 1 }} onClick={closeModal}>Cancelar</button>
                  <button type="submit" className="primary-button" style={{ flex: 1 }}>Salvar</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/* ============================== Relatórios ============================== */

function Reports({ agents, teamList, config }: { agents: Agent[]; teamList: string[]; config: Config }) {
  const totalAudits = agents.reduce((sum, a) => sum + a.audits, 0);
  const avg = weightedScore(agents);
  const below = agents.filter((a) => a.audits > 0 && a.score < config.minScore).length;

  return (
    <main className="content">
      <div className="panel">
        <h3>Relatórios Analíticos e Exportação</h3>
        <p className="muted">Consolidado de conformidade e auditorias da operação (últimos 30 dias).</p>
        <div className="kpis" style={{ marginTop: 20 }}>
          <div className="kpi-card">
            <small>NOTA MÉDIA GERAL</small>
            <div className="kpi-body"><strong>{fmt(avg)}</strong><span>/ 100</span></div>
          </div>
          <div className="kpi-card">
            <small>AUDITORIAS CONCLUÍDAS</small>
            <div className="kpi-body"><strong>{totalAudits.toLocaleString("pt-BR")}</strong></div>
          </div>
          <div className="kpi-card">
            <small>ABAIXO DA NOTA MÍNIMA</small>
            <div className="kpi-body"><strong>{below}</strong><span>colaboradores</span></div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>TIME</th>
              <th>COLABORADORES</th>
              <th>AUDITORIAS</th>
              <th>NOTA MÉDIA</th>
            </tr>
          </thead>
          <tbody>
            {teamList.map((t) => {
              const members = agents.filter((a) => a.team === t);
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
    </main>
  );
}

/* ============================== Configurações ============================== */

function Settings({
  config,
  setConfig,
  setBlocks,
}: {
  config: Config;
  setConfig: (config: Config) => void;
  setBlocks: (blocks: Block[]) => void;
}) {
  const profileNames = Object.keys(MARKET_PROFILES);
  const [selected, setSelected] = useState(profileNames.includes(config.profile) ? config.profile : profileNames[0]);
  const [minScore, setMinScore] = useState(String(config.minScore));
  const [targetAudits, setTargetAudits] = useState(String(config.targetAudits));
  const [message, setMessage] = useState("");

  const profile = MARKET_PROFILES[selected];

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

  return (
    <main className="content">
      <div className="panel">
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
              Consultores abaixo desta nota são contados como desvio no Dashboard e nos Relatórios.
            </p>
            <input className="input" style={{ width: 120 }} type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
          </div>
          <div className="rule-block">
            <strong>Meta mensal de auditorias por consultor</strong>
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

/* ============================== Auditoria (drawer) ============================== */

function AuditDrawer({ agent, close }: { agent: Agent | null; close: () => void }) {
  return (
    <div className="drawer-overlay" onClick={close}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} style={{ width: 500, display: "flex", flexDirection: "column", padding: 0 }}>
        <div className="drawer-header" style={{ padding: 20, borderBottom: "1px solid var(--line)", marginBottom: 0 }}>
          <h3>Detalhes da Auditoria e Checklist</h3>
          <button onClick={close} className="secondary-button">Fechar</button>
        </div>
        <div className="drawer-body" style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          <p className="muted" style={{ fontSize: 13 }}>
            Visualização do atendimento, histórico e recálculo de notas em tempo real.
          </p>
          <div className="rule-block" style={{ lineHeight: 1.8 }}>
            <strong>Cliente:</strong> João Silva<br />
            <strong>Atendente:</strong> {agent ? agent.name : "Marina Costa"}<br />
            <strong>Nota atual:</strong> {agent ? (agent.audits ? fmt(agent.score) : "—") : "96,8"} / 100
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================== App ============================== */

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditAgent, setAuditAgent] = useState<Agent | null>(null);

  const [agents, setAgents] = usePersistentState<Agent[]>("qualita:v1:agents", INITIAL_AGENTS);
  const [teams, setTeams] = usePersistentState<string[]>("qualita:v1:teams", DEFAULT_TEAMS);
  const [blocks, setBlocks] = usePersistentState<Block[]>("qualita:v1:blocks", DEFAULT_BLOCKS);
  const [config, setConfig] = usePersistentState<Config>("qualita:v1:config", DEFAULT_CONFIG);

  const teamList = unionTeams(teams, agents);

  const openAudit = (agent?: Agent) => {
    setAuditAgent(agent ?? null);
    setAuditOpen(true);
  };

  return (
    <div className="app-container">
      <Sidebar page={page} setPage={setPage} />
      <div className="workspace">
        <Header page={page} />
        {page === "dashboard" && <Dashboard agents={agents} teamList={teamList} config={config} openAudit={openAudit} />}
        {page === "parameters" && <Parameters blocks={blocks} setBlocks={setBlocks} config={config} />}
        {page === "team" && (
          <Team agents={agents} setAgents={setAgents} teams={teams} setTeams={setTeams} openAudit={openAudit} />
        )}
        {page === "reports" && <Reports agents={agents} teamList={teamList} config={config} />}
        {page === "settings" && <Settings config={config} setConfig={setConfig} setBlocks={setBlocks} />}
      </div>
      {auditOpen && <AuditDrawer agent={auditAgent} close={() => setAuditOpen(false)} />}
    </div>
  );
}
