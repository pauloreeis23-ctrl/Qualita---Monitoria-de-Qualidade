import React, { useState } from "react";

const agents = [
  { rank: 1, name: "Marina Costa", team: "Equipe Safira", audits: 48, score: 96.8, trend: 2.4, initials: "MC", color: "#826be0" },
  { rank: 2, name: "Rafael Martins", team: "Equipe Safira", audits: 45, score: 94.2, trend: 1.8, initials: "RM", color: "#61c5b2" },
  { rank: 3, name: "Ana Carolina", team: "Equipe Esmeralda", audits: 41, score: 91.7, trend: 0.6, initials: "AC", color: "#e5a45c" },
  { rank: 4, name: "Carlos Lima", team: "Equipe Esmeralda", audits: 37, score: 87.4, trend: 1.2, initials: "CL", color: "#5ea3e0" },
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <span style={{ fontSize: size, lineHeight: 1, display: "inline-flex" }}>✦</span>;
}

function Sidebar({ page, setPage }: { page: string; setPage: (value: string) => void }) {
  const items = [
    ["dashboard", "grid", "Dashboard"],
    ["parameters", "sliders", "Parâmetros"],
    ["team", "users", "Equipe"],
    ["reports", "chart", "Relatórios"],
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
        {items.map(([id, icon, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => setPage(id)}>
            <Icon name={icon} size={19} /> {label}
          </button>
        ))}
        <p className="nav-label second">GESTÃO</p>
        <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
          <Icon name="settings" size={19} /> Configurações
        </button>
      </nav>
      <div className="sidebar-help">
        <span className="help-icon">?</span>
        <div>
          <strong>Precisa de ajuda?</strong>
          <span>Fale com nosso suporte</span>
        </div>
      </div>
    </aside>
  );
}

function Header({ page }: { page: string }) {
  const pages: Record<string, [string, string]> = {
    dashboard: ["Dashboard gerencial", "Acompanhe o desempenho da sua operação em tempo real."],
    parameters: ["Construtor de parâmetros", "Configure critérios, pesos e regras da avaliação de qualidade."],
    team: ["Gestão de equipe", "Acompanhe resultados individuais e a saúde dos seus times."],
    reports: ["Relatórios analíticos", "Explore tendências e exporte dados consolidados da operação."],
    settings: ["Configurações", "Gerencie acessos, notificações e preferências do sistema."],
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

function Dashboard({ openAudit }: { openAudit: () => void }) {
  return (
    <main className="content">
      <section className="filterbar">
        <div className="filters">
          <button className="filter"><span>PERÍODO</span><strong>Últimos 30 dias</strong></button>
          <button className="filter"><span>TIME</span><strong>Todos os times</strong></button>
          <button className="filter"><span>CONSULTORES</span><strong>Todos os consultores</strong></button>
        </div>
        <button className="secondary-button">Limpar filtros</button>
      </section>

      <section className="kpis">
        <article className="kpi-card" onClick={openAudit} style={{ cursor: "pointer" }}>
          <div className="kpi-header"><small>NOTA MÉDIA GERAL</small><span className="positive">+4,2%</span></div>
          <div className="kpi-body"><strong>91,4</strong><span>/ 100</span></div>
          <p>vs. 87,7 no período anterior</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>AUDITORIAS REALIZADAS</small><span className="positive">+12,5%</span></div>
          <div className="kpi-body"><strong>1.284</strong></div>
          <p>142 auditorias esta semana</p>
        </article>
        <article className="kpi-card">
          <div className="kpi-header"><small>TAXA DE DESVIOS</small><span className="negative">-2,1%</span></div>
          <div className="kpi-body"><strong>6,8%</strong></div>
          <p>87 itens críticos identificados</p>
        </article>
      </section>

      <section className="panel ranking-panel">
        <div className="panel-heading">
          <div>
            <h3>Ranking da equipe</h3>
            <p>Desempenho dos consultores no período</p>
          </div>
          <button className="secondary-button">Ver ranking completo</button>
        </div>
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
            {agents.map((agent) => (
              <tr key={agent.name} onClick={openAudit} style={{ cursor: "pointer" }}>
                <td><span className={`rank rank-${agent.rank}`}>{agent.rank}</span></td>
                <td>
                  <div className="agent">
                    <span className="avatar" style={{ background: agent.color }}>{agent.initials}</span>
                    <strong>{agent.name}</strong>
                  </div>
                </td>
                <td>{agent.team}</td>
                <td>{agent.audits}</td>
                <td><strong>{agent.score}</strong> / 100</td>
                <td><span className="positive">+{agent.trend}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function Parameters() {
  return (
    <main className="content parameters-page">
      <div className="panel" style={{ padding: "24px" }}>
        <h3>Construtor Modular de Parâmetros</h3>
        <p style={{ color: "var(--muted)", marginTop: "6px" }}>Gerencie os pesos e blocos avaliativos da sua operação.</p>
        <div style={{ marginTop: "20px", display: "grid", gap: "12px" }}>
          <div className="rule-block">
            <strong>1. Empatia e Comunicação (Peso: 35%)</strong>
            <p style={{ color: "var(--muted)", fontSize: "12px" }}>Avalia clareza, tom de voz e conexão com o cliente.</p>
          </div>
          <div className="rule-block">
            <strong>2. Resolução Técnica e Processo (Peso: 40%)</strong>
            <p style={{ color: "var(--muted)", fontSize: "12px" }}>Verifica acurácia das informações e uso correto dos sistemas.</p>
          </div>
          <div className="rule-block">
            <strong>3. Protocolo e Compliance (Peso: 25%)</strong>
            <p style={{ color: "var(--muted)", fontSize: "12px" }}>Checa cumprimento de normas de segurança e LGPD.</p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Team() {
  return (
    <main className="content">
      <div className="panel" style={{ padding: "24px" }}>
        <h3>Gestão de Equipe</h3>
        <p style={{ color: "var(--muted)", marginTop: "6px" }}>Todos os colaboradores ativos no sistema.</p>
        <div style={{ marginTop: "16px" }}>
          {agents.map((a) => (
            <div key={a.name} style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderBottom: "1px solid var(--line)" }}>
              <span>{a.name} ({a.team})</span>
              <strong>Nota: {a.score}</strong>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}

function Reports() {
  return (
    <main className="content">
      <div className="panel" style={{ padding: "24px" }}>
        <h3>Relatórios Analíticos</h3>
        <p style={{ color: "var(--muted)", marginTop: "6px" }}>Dados consolidados e histórico de conformidade.</p>
      </div>
    </main>
  );
}

function Settings() {
  return (
    <main className="content">
      <div className="panel" style={{ padding: "24px" }}>
        <h3>Configurações do Sistema</h3>
        <p style={{ color: "var(--muted)", marginTop: "6px" }}>Preferências e governança geral.</p>
      </div>
    </main>
  );
}

function AuditDrawer({ close }: { close: () => void }) {
  return (
    <div className="drawer-overlay" onClick={close}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h3>Detalhes da Auditoria</h3>
          <button onClick={close} className="secondary-button">Fechar</button>
        </div>
        <div className="drawer-body" style={{ padding: "20px" }}>
          <p>Visualização e edição cirúrgica de notas em tempo real.</p>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div className="app-container">
      <Sidebar page={page} setPage={setPage} />
      <div className="workspace">
        <Header page={page} />
        {page === "dashboard" && <Dashboard openAudit={() => setAuditOpen(true)} />}
        {page === "parameters" && <Parameters />}
        {page === "team" && <Team />}
        {page === "reports" && <Reports />}
        {page === "settings" && <Settings />}
      </div>
      {auditOpen && <AuditDrawer close={() => setAuditOpen(false)} />}
    </div>
  );
}
