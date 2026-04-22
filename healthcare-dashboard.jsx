import { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, ScatterChart, Scatter,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  AreaChart, Area
} from "recharts";

// ─── Synthetic Data Generation ───────────────────────────────────────────────
const DIAGNOSES = ["Heart Failure", "Pneumonia", "COPD", "Diabetes", "Hip Fracture", "Sepsis", "Stroke", "Renal Failure"];
const DEPARTMENTS = ["Cardiology", "Pulmonology", "Endocrinology", "Orthopedics", "Neurology", "ICU", "General Medicine"];
const GENDERS = ["Male", "Female"];
const INSURANCE = ["Medicare", "Medicaid", "Private", "Uninsured"];

function seededRand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 4294967296;
  };
}

function generatePatients(n = 800) {
  const r = seededRand(42);
  return Array.from({ length: n }, (_, i) => {
    const age = Math.floor(r() * 70 + 18);
    const diagnosis = DIAGNOSES[Math.floor(r() * DIAGNOSES.length)];
    const dept = DEPARTMENTS[Math.floor(r() * DEPARTMENTS.length)];
    const los = Math.floor(r() * 14 + 1); // length of stay
    const comorbidities = Math.floor(r() * 5);
    const prevAdmissions = Math.floor(r() * 4);
    const gender = GENDERS[Math.floor(r() * 2)];
    const insurance = INSURANCE[Math.floor(r() * 4)];
    const dischargeScore = r() * 10;

    // Risk model: higher age, more comorbidities, prev admissions → higher readmission risk
    const riskScore = Math.min(1,
      (age / 100) * 0.3 +
      (comorbidities / 5) * 0.3 +
      (prevAdmissions / 4) * 0.25 +
      (los / 14) * 0.1 +
      r() * 0.05
    );
    const readmitted = riskScore > 0.45 + r() * 0.15;

    return {
      id: i + 1, age, diagnosis, dept, los, comorbidities,
      prevAdmissions, gender, insurance, dischargeScore: dischargeScore.toFixed(1),
      riskScore: (riskScore * 100).toFixed(1),
      readmitted,
      month: Math.floor(r() * 12)
    };
  });
}

const PATIENTS = generatePatients(800);

// ─── Colours ─────────────────────────────────────────────────────────────────
const C = {
  bg: "#0a0e1a",
  surface: "#111827",
  card: "#151e2e",
  border: "#1e2d45",
  accent1: "#00d4ff",
  accent2: "#7c3aed",
  accent3: "#10b981",
  accent4: "#f59e0b",
  danger: "#ef4444",
  text: "#e2e8f0",
  muted: "#64748b",
};

const PALETTE = ["#00d4ff", "#7c3aed", "#10b981", "#f59e0b", "#ef4444", "#ec4899", "#14b8a6", "#f97316"];

// ─── Utilities ────────────────────────────────────────────────────────────────
const pct = (v, t) => t ? ((v / t) * 100).toFixed(1) + "%" : "0%";
const avg = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 0;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// ─── Subcomponents ────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = C.accent1, icon }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: "20px 24px", display: "flex", flexDirection: "column", gap: 6,
      borderLeft: `3px solid ${color}`, position: "relative", overflow: "hidden"
    }}>
      <div style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" }}>{label}</div>
      <div style={{ color, fontSize: 32, fontWeight: 800, lineHeight: 1, fontFamily: "'DM Mono', monospace" }}>{value}</div>
      {sub && <div style={{ color: C.muted, fontSize: 12 }}>{sub}</div>}
      <div style={{ position: "absolute", right: 16, top: 16, fontSize: 28, opacity: 0.15 }}>{icon}</div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      color: C.accent1, fontSize: 11, letterSpacing: 3, textTransform: "uppercase",
      fontFamily: "monospace", borderBottom: `1px solid ${C.border}`, paddingBottom: 8, marginBottom: 16
    }}>
      {children}
    </div>
  );
}

function ChartCard({ title, children, span = 1 }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
      padding: 20, gridColumn: `span ${span}`
    }}>
      <div style={{ color: C.text, fontWeight: 600, fontSize: 13, marginBottom: 16, letterSpacing: 0.5 }}>{title}</div>
      {children}
    </div>
  );
}

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0d1420", border: `1px solid ${C.border}`, borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      {label && <div style={{ color: C.muted, marginBottom: 4 }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || C.text }}>{p.name}: <b>{typeof p.value === 'number' ? p.value.toFixed(1) : p.value}</b></div>
      ))}
    </div>
  );
};

// ─── Risk Predictor ───────────────────────────────────────────────────────────
function RiskPredictor() {
  const [form, setForm] = useState({ age: 65, comorbidities: 2, prevAdmissions: 1, los: 5, diagnosis: "Heart Failure" });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const predict = async () => {
    setLoading(true);
    setResult(null);
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          messages: [{
            role: "user",
            content: `You are a clinical data analyst AI. Based on the following patient features, predict the 30-day hospital readmission risk and provide a clinical insight.

Patient Data:
- Age: ${form.age}
- Diagnosis: ${form.diagnosis}
- Length of Stay: ${form.los} days
- Comorbidities: ${form.comorbidities}
- Previous Admissions (past year): ${form.prevAdmissions}

Respond ONLY with a JSON object (no markdown, no backticks):
{
  "risk_level": "Low" | "Moderate" | "High",
  "risk_score": <number 0-100>,
  "key_factors": [<3 strings>],
  "recommendation": "<2-sentence clinical recommendation>",
  "similar_cohort_readmission_rate": "<percentage string>"
}`
          }]
        })
      });
      const data = await resp.json();
      const text = data.content.map(b => b.text || "").join("");
      const clean = text.replace(/```json|```/g, "").trim();
      setResult(JSON.parse(clean));
    } catch (e) {
      setResult({ error: "Prediction failed. Please try again." });
    }
    setLoading(false);
  };

  const riskColor = result?.risk_level === "High" ? C.danger : result?.risk_level === "Moderate" ? C.accent4 : C.accent3;

  const inputStyle = {
    background: "#0d1420", border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, padding: "8px 12px", fontSize: 13, width: "100%", outline: "none",
    fontFamily: "monospace"
  };
  const labelStyle = { color: C.muted, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 4, display: "block" };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      {/* Input Panel */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label style={labelStyle}>Age</label>
          <input type="range" min={18} max={95} value={form.age} onChange={e => setForm(f => ({...f, age: +e.target.value}))}
            style={{ width: "100%", accentColor: C.accent1 }} />
          <div style={{ color: C.accent1, fontFamily: "monospace", fontSize: 13 }}>{form.age} years</div>
        </div>
        <div>
          <label style={labelStyle}>Diagnosis</label>
          <select value={form.diagnosis} onChange={e => setForm(f => ({...f, diagnosis: e.target.value}))} style={inputStyle}>
            {DIAGNOSES.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Length of Stay (days)</label>
          <input type="range" min={1} max={30} value={form.los} onChange={e => setForm(f => ({...f, los: +e.target.value}))}
            style={{ width: "100%", accentColor: C.accent2 }} />
          <div style={{ color: C.accent2, fontFamily: "monospace", fontSize: 13 }}>{form.los} days</div>
        </div>
        <div>
          <label style={labelStyle}>Comorbidities (0–5)</label>
          <input type="range" min={0} max={5} value={form.comorbidities} onChange={e => setForm(f => ({...f, comorbidities: +e.target.value}))}
            style={{ width: "100%", accentColor: C.accent4 }} />
          <div style={{ color: C.accent4, fontFamily: "monospace", fontSize: 13 }}>{form.comorbidities}</div>
        </div>
        <div>
          <label style={labelStyle}>Previous Admissions (past year)</label>
          <input type="range" min={0} max={5} value={form.prevAdmissions} onChange={e => setForm(f => ({...f, prevAdmissions: +e.target.value}))}
            style={{ width: "100%", accentColor: C.danger }} />
          <div style={{ color: C.danger, fontFamily: "monospace", fontSize: 13 }}>{form.prevAdmissions}</div>
        </div>
        <button onClick={predict} disabled={loading} style={{
          background: loading ? C.border : `linear-gradient(135deg, ${C.accent1}, ${C.accent2})`,
          border: "none", borderRadius: 8, color: "#fff", padding: "12px 20px",
          fontWeight: 700, fontSize: 13, cursor: loading ? "default" : "pointer", letterSpacing: 1,
          fontFamily: "monospace", transition: "opacity 0.2s"
        }}>
          {loading ? "⏳ ANALYSING..." : "⚡ PREDICT READMISSION RISK"}
        </button>
      </div>

      {/* Result Panel */}
      <div style={{
        background: "#0d1420", border: `1px solid ${C.border}`, borderRadius: 10, padding: 20,
        display: "flex", flexDirection: "column", gap: 14
      }}>
        {!result && !loading && (
          <div style={{ color: C.muted, textAlign: "center", marginTop: 40, fontSize: 13 }}>
            🧠 Configure patient parameters and click Predict to get an AI-powered readmission risk assessment.
          </div>
        )}
        {loading && (
          <div style={{ color: C.accent1, textAlign: "center", marginTop: 40, fontFamily: "monospace", fontSize: 13 }}>
            Consulting clinical AI model...
          </div>
        )}
        {result?.error && <div style={{ color: C.danger }}>{result.error}</div>}
        {result && !result.error && (
          <>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace" }}>Risk Level</div>
              <div style={{ color: riskColor, fontSize: 42, fontWeight: 900, fontFamily: "monospace", lineHeight: 1.1 }}>{result.risk_level}</div>
              <div style={{ color: riskColor, fontSize: 22, fontWeight: 700, fontFamily: "monospace" }}>{result.risk_score}%</div>
            </div>
            <div>
              <div style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 8 }}>Key Risk Factors</div>
              {result.key_factors?.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 6 }}>
                  <span style={{ color: C.accent1, marginTop: 2 }}>▸</span>
                  <span style={{ color: C.text, fontSize: 12 }}>{f}</span>
                </div>
              ))}
            </div>
            <div style={{ background: C.surface, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
              <div style={{ color: C.muted, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", fontFamily: "monospace", marginBottom: 6 }}>Clinical Recommendation</div>
              <div style={{ color: C.text, fontSize: 12, lineHeight: 1.7 }}>{result.recommendation}</div>
            </div>
            <div style={{ color: C.muted, fontSize: 11, fontFamily: "monospace", textAlign: "center" }}>
              Similar cohort readmission rate: <span style={{ color: C.accent3 }}>{result.similar_cohort_readmission_rate}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main Dashboard ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [filterDept, setFilterDept] = useState("All");
  const [filterDiag, setFilterDiag] = useState("All");

  const filtered = useMemo(() => {
    return PATIENTS.filter(p =>
      (filterDept === "All" || p.dept === filterDept) &&
      (filterDiag === "All" || p.diagnosis === filterDiag)
    );
  }, [filterDept, filterDiag]);

  // Derived stats
  const totalPatients = filtered.length;
  const readmitted = filtered.filter(p => p.readmitted).length;
  const readmitRate = pct(readmitted, totalPatients);
  const avgLOS = avg(filtered.map(p => p.los));
  const avgAge = avg(filtered.map(p => p.age));
  const highRisk = filtered.filter(p => +p.riskScore > 65).length;

  // Charts data
  const byDiag = DIAGNOSES.map(d => {
    const pts = filtered.filter(p => p.diagnosis === d);
    return {
      name: d.length > 12 ? d.slice(0, 12) + "…" : d,
      fullName: d,
      total: pts.length,
      readmitted: pts.filter(p => p.readmitted).length,
      avgLOS: +avg(pts.map(p => p.los)),
      rate: pts.length ? +((pts.filter(p => p.readmitted).length / pts.length) * 100).toFixed(1) : 0
    };
  }).filter(d => d.total > 0);

  const byDept = DEPARTMENTS.map(d => {
    const pts = filtered.filter(p => p.dept === d);
    return {
      name: d.length > 12 ? d.slice(0, 11) + "…" : d,
      total: pts.length,
      readmitted: pts.filter(p => p.readmitted).length,
      rate: pts.length ? +((pts.filter(p => p.readmitted).length / pts.length) * 100).toFixed(1) : 0
    };
  }).filter(d => d.total > 0);

  const byMonth = MONTHS.map((m, i) => {
    const pts = filtered.filter(p => p.month === i);
    return {
      month: m,
      patients: pts.length,
      readmitted: pts.filter(p => p.readmitted).length,
      avgLOS: +avg(pts.map(p => p.los))
    };
  });

  const ageGroups = [
    { group: "18–34", min: 18, max: 34 },
    { group: "35–49", min: 35, max: 49 },
    { group: "50–64", min: 50, max: 64 },
    { group: "65–79", min: 65, max: 79 },
    { group: "80+", min: 80, max: 120 },
  ].map(g => {
    const pts = filtered.filter(p => p.age >= g.min && p.age <= g.max);
    return {
      group: g.group,
      total: pts.length,
      readmitted: pts.filter(p => p.readmitted).length,
      rate: pts.length ? +((pts.filter(p => p.readmitted).length / pts.length) * 100).toFixed(1) : 0
    };
  });

  const genderData = GENDERS.map(g => ({
    name: g,
    value: filtered.filter(p => p.gender === g).length,
    readmitted: filtered.filter(p => p.gender === g && p.readmitted).length
  }));

  const insuranceData = INSURANCE.map(ins => {
    const pts = filtered.filter(p => p.insurance === ins);
    return {
      name: ins, total: pts.length,
      readmitRate: pts.length ? +((pts.filter(p => p.readmitted).length / pts.length) * 100).toFixed(1) : 0
    };
  });

  const radarData = DIAGNOSES.slice(0, 6).map(d => {
    const pts = filtered.filter(p => p.diagnosis === d);
    return {
      diagnosis: d.split(" ")[0],
      readmitRate: pts.length ? +((pts.filter(p => p.readmitted).length / pts.length) * 100).toFixed(0) : 0,
      avgLOS: +avg(pts.map(p => p.los)),
      avgComorbidities: +avg(pts.map(p => p.comorbidities)) * 10
    };
  });

  const scatterData = filtered.slice(0, 300).map(p => ({
    age: p.age, los: p.los, risk: +p.riskScore,
    readmitted: p.readmitted
  }));

  const tabs = ["overview", "diagnoses", "demographics", "risk predictor"];

  const tabStyle = (t) => ({
    padding: "8px 18px", border: "none", borderRadius: 8, cursor: "pointer",
    fontFamily: "monospace", fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: 700,
    background: activeTab === t ? C.accent1 : "transparent",
    color: activeTab === t ? "#0a0e1a" : C.muted,
    transition: "all 0.2s"
  });

  const selectStyle = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
    color: C.text, padding: "6px 12px", fontSize: 12, fontFamily: "monospace", outline: "none"
  };

  return (
    <div style={{ background: C.bg, minHeight: "100vh", color: C.text, fontFamily: "'Inter', sans-serif", fontSize: 13 }}>
      {/* Header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "16px 28px", display: "flex", alignItems: "center", justifyContent: "space-between"
      }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: -0.5, color: C.text }}>
            <span style={{ color: C.accent1 }}>◈</span> Healthcare Analytics
          </div>
          <div style={{ color: C.muted, fontSize: 11, letterSpacing: 1, fontFamily: "monospace" }}>
            PATIENT OUTCOMES & READMISSION ANALYSIS · {totalPatients} PATIENTS
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <select value={filterDept} onChange={e => setFilterDept(e.target.value)} style={selectStyle}>
            <option>All</option>
            {DEPARTMENTS.map(d => <option key={d}>{d}</option>)}
          </select>
          <select value={filterDiag} onChange={e => setFilterDiag(e.target.value)} style={selectStyle}>
            <option>All</option>
            {DIAGNOSES.map(d => <option key={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ padding: "14px 28px 0", display: "flex", gap: 8, borderBottom: `1px solid ${C.border}`, background: C.surface }}>
        {tabs.map(t => <button key={t} style={tabStyle(t)} onClick={() => setActiveTab(t)}>{t}</button>)}
      </div>

      <div style={{ padding: 24 }}>
        {/* KPI Row */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 24 }}>
          <KpiCard label="Total Patients" value={totalPatients.toLocaleString()} icon="🏥" color={C.accent1} sub="Filtered cohort" />
          <KpiCard label="Readmitted (30d)" value={readmitted} sub={`${readmitRate} readmission rate`} icon="🔄" color={C.danger} />
          <KpiCard label="Avg Length of Stay" value={`${avgLOS}d`} sub="Days per patient" icon="📅" color={C.accent2} />
          <KpiCard label="Avg Patient Age" value={`${avgAge}y`} sub="Years" icon="👤" color={C.accent3} />
          <KpiCard label="High Risk Patients" value={highRisk} sub="Risk score > 65%" icon="⚠️" color={C.accent4} />
        </div>

        {/* OVERVIEW TAB */}
        {activeTab === "overview" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="Monthly Admissions & Readmissions" span={2}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={byMonth}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.accent1} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.accent1} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={C.danger} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={C.danger} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="month" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: C.muted }} />
                  <Area type="monotone" dataKey="patients" name="Admissions" stroke={C.accent1} fill="url(#g1)" strokeWidth={2} dot={false} />
                  <Area type="monotone" dataKey="readmitted" name="Readmissions" stroke={C.danger} fill="url(#g2)" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Readmission Rate by Department">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byDept} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} unit="%" />
                  <YAxis type="category" dataKey="name" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} width={90} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="rate" name="Readmit Rate %" radius={[0, 4, 4, 0]}>
                    {byDept.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Insurance Type vs Readmission Rate">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={insuranceData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="total" name="Total Patients" fill={C.accent2} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="readmitRate" name="Readmit Rate %" fill={C.danger} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* DIAGNOSES TAB */}
        {activeTab === "diagnoses" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="Readmission Rate by Diagnosis" span={2}>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byDiag}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="name" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="total" name="Total" fill={C.accent2} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="readmitted" name="Readmitted" fill={C.danger} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Avg Length of Stay by Diagnosis">
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={byDiag} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} horizontal={false} />
                  <XAxis type="number" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} unit="d" />
                  <YAxis type="category" dataKey="name" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} width={90} />
                  <Tooltip content={<TT />} />
                  <Bar dataKey="avgLOS" name="Avg LOS (days)" radius={[0, 4, 4, 0]}>
                    {byDiag.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Multi-metric Radar by Diagnosis">
              <ResponsiveContainer width="100%" height={240}>
                <RadarChart data={radarData}>
                  <PolarGrid stroke={C.border} />
                  <PolarAngleAxis dataKey="diagnosis" tick={{ fill: C.muted, fontSize: 11 }} />
                  <PolarRadiusAxis stroke={C.border} tick={{ fill: C.muted, fontSize: 9 }} />
                  <Radar name="Readmit Rate" dataKey="readmitRate" stroke={C.danger} fill={C.danger} fillOpacity={0.15} />
                  <Radar name="Avg LOS" dataKey="avgLOS" stroke={C.accent1} fill={C.accent1} fillOpacity={0.15} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </RadarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* DEMOGRAPHICS TAB */}
        {activeTab === "demographics" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <ChartCard title="Readmission Rate by Age Group" span={2}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={ageGroups}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="group" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip content={<TT />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="total" name="Total" fill={C.accent2} radius={[4, 4, 0, 0]} />
                  <Bar dataKey="readmitted" name="Readmitted" fill={C.danger} radius={[4, 4, 0, 0]} />
                  <Line type="monotone" dataKey="rate" name="Readmit Rate %" stroke={C.accent1} strokeWidth={2} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Gender Distribution">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={genderData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name}: ${value}`}>
                    {genderData.map((_, i) => <Cell key={i} fill={[C.accent1, C.accent2][i]} />)}
                  </Pie>
                  <Tooltip content={<TT />} />
                </PieChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Age vs LOS Scatter (Risk)">
              <ResponsiveContainer width="100%" height={220}>
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="age" name="Age" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis dataKey="los" name="LOS" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} content={<TT />} />
                  <Scatter
                    name="Not Readmitted"
                    data={scatterData.filter(d => !d.readmitted)}
                    fill={C.accent3}
                    fillOpacity={0.5}
                  />
                  <Scatter
                    name="Readmitted"
                    data={scatterData.filter(d => d.readmitted)}
                    fill={C.danger}
                    fillOpacity={0.6}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                </ScatterChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Avg LOS Trend by Month">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
                  <XAxis dataKey="month" stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <YAxis stroke={C.muted} tick={{ fontSize: 11, fill: C.muted }} />
                  <Tooltip content={<TT />} />
                  <Line type="monotone" dataKey="avgLOS" name="Avg LOS" stroke={C.accent4} strokeWidth={2} dot={{ fill: C.accent4, r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>
        )}

        {/* RISK PREDICTOR TAB */}
        {activeTab === "risk predictor" && (
          <div>
            <SectionTitle>AI-Powered 30-Day Readmission Risk Predictor</SectionTitle>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 24
            }}>
              <RiskPredictor />
            </div>
            <div style={{ marginTop: 16, color: C.muted, fontSize: 11, fontFamily: "monospace", textAlign: "center" }}>
              Risk prediction powered by Claude AI · For research and educational purposes only
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
