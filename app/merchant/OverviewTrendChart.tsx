"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type TrendPoint = { date: string; events: number };

export default function OverviewTrendChart({ points }: { points: TrendPoint[] }) {
  const hasHistory = points.length > 1 && points.some((point) => point.events > 0);
  return (
    <section className="workspace-card" aria-labelledby="overview-trend-title">
      <div className="card-heading">
        <div><span className="section-label">Server activity</span><h3 id="overview-trend-title">Commerce evidence</h3></div>
        <span className="prompt-lock">Real audit events</span>
      </div>
      {hasHistory ? <div style={{ width: "100%", height: 220, marginTop: 18 }}><ResponsiveContainer width="100%" height="100%"><LineChart data={points} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}><XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7c8495" }} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: "#7c8495" }} /><Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e6e9f0", boxShadow: "0 8px 24px rgba(22,28,45,.08)", fontSize: 12 }} labelStyle={{ color: "#1d2433", fontWeight: 700 }} /><Line type="monotone" dataKey="events" name="Events" stroke="#4e5cff" strokeWidth={3} dot={{ r: 3, strokeWidth: 2, fill: "#fff" }} activeDot={{ r: 5 }} /></LineChart></ResponsiveContainer></div> : <div className="compile-empty" style={{ minHeight: 180, marginTop: 8 }}><span className="compile-empty-mark">◌</span><strong>Insufficient history</strong><p>Verified commerce activity will appear here after the first server-recorded loop.</p></div>}
      <p className="runtime-footnote">This view is intentionally empty until the server has enough recorded activity to show a useful trend.</p>
    </section>
  );
}
