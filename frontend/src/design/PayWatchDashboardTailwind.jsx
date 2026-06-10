import BrandLogo from "../components/BrandLogo";
import { paywatchTailwindTheme as tw } from "./paywatchTailwindTheme";

const kpis = [
  { label: "Transactions", value: "12.4k", helper: "+18.2% vs last week" },
  { label: "High Risk", value: "342", helper: "24 cases in the last hour" },
  { label: "Fraud Rate", value: "2.8%", helper: "Stable in current stream" },
  { label: "Alert SLA", value: "14m", helper: "3 breaches need triage" },
];

const actionCards = [
  {
    title: "Escalate mule-ring cluster",
    body: "5 linked transactions crossed the graph-risk threshold in the Chennai corridor.",
  },
  {
    title: "Claim the strongest anomaly",
    body: "An unassigned cash-out event has the top anomaly pressure in the last 15 minutes.",
  },
  {
    title: "Review champion rollout",
    body: "Model v2.5.1 is outperforming challenger precision by 4.2 points.",
  },
];

export default function PayWatchDashboardTailwind() {
  return (
    <div className={tw.page}>
      <div className={tw.shell}>
        <aside className={tw.sidebar}>
          <div className="mb-8 flex items-center gap-4">
            <BrandLogo size={60} animated title="PayWatch animated brand mark" />
            <div>
              <h1 className="text-lg font-semibold text-white">PayWatch AI</h1>
              <p className="text-sm text-slate-400">Real-time fraud intelligence</p>
            </div>
          </div>

          <nav className="grid gap-3">
            {["Dashboard", "Analytics", "Alerts", "Transactions", "Settings"].map((item, index) => (
              <button
                key={item}
                type="button"
                className={`flex items-center gap-4 rounded-[18px] px-4 py-3 text-left transition ${
                  index === 0
                    ? "bg-white/[0.08] text-white"
                    : "text-slate-400 hover:bg-white/[0.05] hover:text-white"
                }`}
              >
                <span className="w-6 text-center font-semibold text-cyan-300">{["Rs", "$", "!", "#", "*"][index]}</span>
                <span>{item}</span>
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 px-8 py-6">
          <div className="mb-5 flex items-start justify-between gap-5">
            <div>
              <p className={tw.eyebrow}>Fintech Fraud Platform</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-[-0.04em] text-white">
                Live monitoring and explainable decisions
              </h2>
            </div>
            <div className="flex w-full max-w-[780px] items-center justify-end gap-3">
              <div className={`${tw.search} max-w-[460px] flex-1`}>
                <span className="rounded-xl bg-cyan-300/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">
                  Search
                </span>
                <span className="truncate text-slate-400">Search users, alerts, transactions, models...</span>
                <span className="text-slate-500">Ctrl K</span>
              </div>
              <button className={tw.secondaryButton}>Command</button>
              <button className={tw.secondaryButton}>Report</button>
              <button className={tw.secondaryButton}>Refresh</button>
            </div>
          </div>

          <section className={tw.hero}>
            <div className={tw.heroGlow} />
            <div className="relative grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
              <div className="space-y-6">
                <div className="flex items-center gap-5">
                  <div className="rounded-[26px] border border-cyan-300/15 bg-slate-950/30 p-3 backdrop-blur-lg">
                    <BrandLogo size={88} animated title="PayWatch animated logo" />
                  </div>
                  <div>
                    <p className={tw.eyebrow}>Executive Command Center</p>
                    <h3 className={tw.title}>Fraud operations cockpit</h3>
                  </div>
                </div>
                <p className={`${tw.subtitle} max-w-3xl`}>
                  Weighted ML scoring, graph-linked investigation, SLA-aware triage, and stream health intelligence in one
                  coordinated analyst surface.
                </p>
                <div className="flex flex-wrap gap-3">
                  {["24H window", "Risk: Medium+", "Type: Debit", "Model: Ensemble"].map((chip) => (
                    <span key={chip} className={tw.chip}>
                      {chip}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {[
                    { label: "Kafka stream", value: "ONLINE" },
                    { label: "Redis cache", value: "SYNCED" },
                    { label: "Champion model", value: "v2.5.1" },
                    { label: "Stream freshness", value: "2.4s" },
                  ].map((item) => (
                    <article key={item.label} className={tw.glassCard}>
                      <p className={tw.label}>{item.label}</p>
                      <strong className="mt-3 block text-xl font-semibold text-white">{item.value}</strong>
                    </article>
                  ))}
                </div>
                <article className={`${tw.glassCard} border-amber-300/20 bg-[linear-gradient(140deg,rgba(255,193,77,0.08),rgba(255,255,255,0.03))]`}>
                  <p className={tw.eyebrow}>Next best action</p>
                  <strong className="mt-3 block text-xl font-semibold text-white">Escalate the Chennai mule-ring cluster</strong>
                  <p className="mt-3 text-sm leading-6 text-slate-300">
                    Linked destination accounts, repeated merchant reuse, and rising anomaly pressure suggest a coordinated fraud
                    pattern.
                  </p>
                </article>
              </div>
            </div>
          </section>

          <section className="mt-5 grid gap-4 xl:grid-cols-4">
            {kpis.map((item) => (
              <article key={item.label} className={tw.statCard}>
                <p className={tw.label}>{item.label}</p>
                <strong className="mt-4 block text-[2rem] font-semibold tracking-[-0.05em] text-white">{item.value}</strong>
                <span className="mt-3 block text-sm text-slate-400">{item.helper}</span>
              </article>
            ))}
          </section>

          <section className="mt-5 grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <article className={tw.panel}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className={tw.eyebrow}>Risk heatmap</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Transaction density by type and hour</h3>
                </div>
                <span className={tw.badge}>Hotspot ready</span>
              </div>
              <div className="grid gap-3">
                {["PAYMENT", "TRANSFER", "CASH_OUT", "DEBIT"].map((row, rowIndex) => (
                  <div key={row} className="grid grid-cols-[110px_1fr] items-center gap-4">
                    <div>
                      <strong className="block text-sm text-white">{row}</strong>
                      <span className="text-xs text-slate-500">{14 + rowIndex * 5} pts</span>
                    </div>
                    <div className="grid grid-cols-12 gap-2">
                      {Array.from({ length: 12 }).map((_, index) => (
                        <div
                          key={`${row}-${index}`}
                          className="flex h-11 items-center justify-center rounded-2xl border border-white/6 text-[11px] font-medium text-slate-200"
                          style={{
                            background:
                              index === rowIndex + 4
                                ? "linear-gradient(180deg, rgba(255,95,122,0.82), rgba(255,95,122,0.34))"
                                : index % 3 === 0
                                ? "linear-gradient(180deg, rgba(255,193,77,0.52), rgba(255,193,77,0.18))"
                                : "linear-gradient(180deg, rgba(92,200,255,0.28), rgba(92,200,255,0.08))",
                          }}
                        >
                          {index === rowIndex + 4 ? "9" : ""}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className={tw.panel}>
              <div className="mb-4 flex items-center justify-between gap-4">
                <div>
                  <p className={tw.eyebrow}>Action stack</p>
                  <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-white">Analyst guidance</h3>
                </div>
                <span className={tw.badge}>3 live cards</span>
              </div>
              <div className="grid gap-4">
                {actionCards.map((item) => (
                  <article key={item.title} className={tw.glassCard}>
                    <strong className="block text-lg font-semibold text-white">{item.title}</strong>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{item.body}</p>
                  </article>
                ))}
              </div>
            </article>
          </section>
        </main>
      </div>
    </div>
  );
}
