import React, { useState } from "react";

function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  const icons: Record<string, string> = {
    dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z",
    parameters: "M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
    team: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75",
    reports: "M18 20V10M12 20V4M6 20v-6",
    settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z",
    search: "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.35-4.35",
    arrowUp: "M18 15l-6-6-6 6",
    arrowDown: "M6 9l6 6 6-6",
    check: "M20 6L9 17l-5-5",
    warning: "M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0zM12 9v4M12 17h.01",
    plus: "M12 5v14M5 12h14",
    more: "M12 13a1 1 0 100-2 1 1 0 000 2zM19 13a1 1 0 100-2 1 1 0 000 2zM5 13a1 1 0 100-2 1 1 0 000 2z",
    calendar: "M19 4h-1V2h-2v2H8V2H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10z",
    edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
    sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
    users: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8z"
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={icons[name] || icons.dashboard} />
    </svg>
  );
}

const agents = [
  { rank: 1, name: "Marina Costa", team: "Equipe Safira", audits: 48, score: 96.8, trend: 2.4, initials: "MC", color: "#e1b85c" },
  { rank: 2, name: "Rafael Martins", team: "Equipe Safira", audits: 45, score: 94.2, trend: 1.8, initials: "RM", color: "#c0c3cc" },
  { rank: 3, name: "Ana Carolina", team: "Equipe Esmeralda", audits: 41, score: 91.7, trend: 0.6, initials: "AC", color: "#d79b71" },
  { rank: 4, name: "Carlos Lima", team: "Equipe Esmeralda", audits: 37, score: 87.4, trend: -1.2, initials: "CL", color: "#a9abb4" }
];

export default function App() {
  const [page, setPage] = useState("dashboard");
  const [auditOpen, setAuditOpen] = useState(false);

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo-icon">Q</div>
          <div>
            <strong>Qualitá</strong>
            <span>MONITORIA</span>
          </div>
        </div>
        <nav>
          <button className={page === "dashboard" ? "active" : ""} onClick={() => setPage("dashboard")}>
            <Icon name="dashboard" /> Visão geral
          </button>
          <button className={page === "parameters" ? "active" : ""} onClick={() => setPage("parameters")}>
            <Icon name="parameters" /> Parâmetros
          </button>
          <button className={page === "team" ? "active" : ""} onClick={() => setPage("team")}>
            <Icon name="team" /> Equipe
          </button>
          <button className={page === "reports" ? "active" : ""} onClick={() => setPage("reports")}>
            <Icon name="reports" /> Relatórios
          </button>
          <p className="nav-label">GESTÃO</p>
          <button className={page === "settings" ? "active" : ""} onClick={() => setPage("settings")}>
            <Icon name="settings" /> Configurações
          </button>
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>{page === "dashboard" ? "Dashboard Gerencial" : page === "parameters" ? "Construtor de Parâmetros" : page === "team" ? "Gestão de Equipe" : page === "reports" ? "Relatórios Analíticos" : "Configurações do Sistema"}</h1>
            <p>Sistema inteligente de monitoria de qualidade e auditoria em tempo real.</p>
          </div>
        </header>

        {page === "dashboard" && (
          <div className="dashboard-content">
            <section className="kpis">
              <article className="kpi-card">
                <small>NOTA MÉDIA GERAL</small>
                <strong>91.4 / 100</strong>
                <span className="positive">vs. 87.7 período anterior</span>
              </article>
              <article className="kpi-card">
                <small>AUDITORIAS REALIZADAS</small>
                <strong>1.284</strong>
                <span className="positive">+142 esta semana</span>
              </article>
              <article className="kpi-card">
                <small>TAXA DE DESVIOS</small>
                <strong>6.8%</strong>
                <span className="negative">87 itens críticos</span>
              </article>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h3>Ranking da Equipe</h3>
                  <p>Desempenho dos consultores no período</p>
                </div>
              </div>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>CONSULTOR</th>
                    <th>EQUIPE</th>
                    <th>AUDITORIAS</th>
                    <th>NOTA MÉDIA</th>
                  </tr>
                </thead>
                <tbody>
                  {agents.map((agent) => (
                    <tr key={agent.name} onClick={() => setAuditOpen(true)} style={{ cursor: "pointer" }}>
                      <td><span className="rank">{agent.rank}</span></td>
                      <td><strong>{agent.name}</strong></td>
                      <td>{agent.team}</td>
                      <td>{agent.audits}</td>
                      <td><strong>{agent.score}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        )}

        {page === "parameters" && (
          <div className="parameters-content">
            <div className="panel">
              <h3>Construtor de Critérios de Qualidade</h3>
              <p>Gerencie pesos e regras modulares para o cálculo automático das notas.</p>
              <div style={{ marginTop: "20px", padding: "16px", background: "#1b1c21", borderRadius: "8px" }}>
                <strong>Critério 1: Clareza e Empatia no Atendimento</strong>
                <p style={{ color: "#8f919c", fontSize: "14px", marginTop: "4px" }}>Peso atual: 35% • Validação por IA ativa</p>
              </div>
            </div>
          </div>
        )}

        {page === "team" && (
          <div className="team-content">
            <div className="panel">
              <h3>Visão Geral dos Consultores</h3>
              <p>Todos os colaboradores cadastrados nas torres de suporte.</p>
            </div>
          </div>
        )}

        {page === "reports" && (
          <div className="reports-content">
            <div className="panel">
              <h3>Relatório Consolidado de Qualidade</h3>
              <p>Métricas e histórico de conformidade por período.</p>
            </div>
          </div>
        )}

        {page === "settings" && (
          <div className="settings-content">
            <div className="panel">
              <h3>Governança e Permissões</h3>
              <p>Configure perfis de acesso, notificações e parâmetros gerais da operação.</p>
            </div>
          </div>
        )}
      </main>

      {auditOpen && (
        <div className="drawer-overlay" onClick={() => setAuditOpen(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <h2>Auditoria de Atendimento</h2>
            <p>Visualização detalhada do chat e checklist de avaliação em tempo real.</p>
            <button className="primary-button" onClick={() => setAuditOpen(false)} style={{ marginTop: "20px" }}>Fechar</button>
          </div>
        </div>
      )}
    </div>
  );
}
