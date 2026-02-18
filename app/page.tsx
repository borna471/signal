const navItems = ["Home", "Issues", "Sessions", "Integrations", "Settings"];
const statCards = [
  { label: "Sessions analyzed (24h)", value: "18,432", trend: "+14%" },
  { label: "New issues detected", value: "37", trend: "-8%" },
  { label: "Crash-free sessions", value: "99.82%", trend: "+0.12%" }
];
const openIssues = [
  { id: "ISS-412", title: "Checkout hangs after Apple Pay", impact: "High", hits: 59 },
  { id: "ISS-406", title: "Role selector resets on onboarding", impact: "High", hits: 41 },
  { id: "ISS-397", title: "Dashboard filters clear on refresh", impact: "Medium", hits: 24 }
];

export default function DashboardPage() {
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="logo-tile">
            <div className="logo-sphere" />
          </div>
          <div>
            <p className="brand-title">Lucent</p>
            <p className="brand-subtitle">Product Signal</p>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {navItems.map((item) => (
            <a
              key={item}
              className={`nav-item ${item === "Home" ? "nav-item-active" : ""}`}
              href="#"
            >
              {item}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          <p>PostHog</p>
          <span>Connected</span>
        </div>
      </aside>

      <div className="main-wrap">
        <header className="topbar">
          <div>
            <p className="breadcrumb">Home</p>
            <h1>Signal Dashboard</h1>
          </div>
          <div className="profile">
            <span className="connection-pill">Live sync enabled</span>
            <div>
              <p className="profile-name">Borna</p>
              <p className="profile-email">borna@cloverlabs.ai</p>
            </div>
            <div className="profile-avatar">BS</div>
          </div>
        </header>

        <main className="main-content">
          <section className="stat-grid">
            {statCards.map((card) => (
              <article key={card.label} className="stat-card">
                <p>{card.label}</p>
                <h2>{card.value}</h2>
                <span>{card.trend} vs previous day</span>
              </article>
            ))}
          </section>

          <section className="content-grid">
            <article className="panel">
              <div className="panel-header">
                <h3>Issue velocity</h3>
                <span>Last 7 days</span>
              </div>
              <div className="chart-grid">
                <div className="bar bar-1" />
                <div className="bar bar-2" />
                <div className="bar bar-3" />
                <div className="bar bar-4" />
                <div className="bar bar-5" />
                <div className="bar bar-6" />
                <div className="bar bar-7" />
              </div>
            </article>

            <article className="panel">
              <div className="panel-header">
                <h3>Ingestion health</h3>
                <span className="status-ok">Healthy</span>
              </div>
              <ul className="health-list">
                <li>Replay stream latency: 1.4s</li>
                <li>Capture events dropped: 0.03%</li>
                <li>Ticket sync success: 100%</li>
              </ul>
            </article>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>Top open issues</h3>
              <button className="primary-button" type="button">
                Create triage report
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Issue</th>
                    <th>Impact</th>
                    <th>Replay hits</th>
                  </tr>
                </thead>
                <tbody>
                  {openIssues.map((issue) => (
                    <tr key={issue.id}>
                      <td>
                        <strong>{issue.id}</strong>
                        <p>{issue.title}</p>
                      </td>
                      <td>{issue.impact}</td>
                      <td>{issue.hits}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
