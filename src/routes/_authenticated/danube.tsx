import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { DANUBE_STATIONS } from "@/lib/markets";
import { getDanubeDischarge } from "@/lib/data.functions";
import { useDateRange } from "@/lib/date-range";
import { DataBadge } from "@/components/data-badge";
import { Download } from "lucide-react";
import { downloadCSV } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/danube")({
  head: () => ({ meta: [{ title: "Danube — SEE Trading Desk" }] }),
  component: DanubePage,
});

interface Row { date: string; [station: string]: string | number; }

function DanubePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { range } = useDateRange();

  const fn = useServerFn(getDanubeDischarge);
  const q = useQuery({
    queryKey: ["danube", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  // Build chart data: merge stations by date.
  const live = q.data?.stations ?? [];
  const dates = new Set<string>();
  for (const s of live) for (const p of s.data) dates.add(p.date);
  const liveRows: Row[] = Array.from(dates).sort().map(d => {
    const row: Row = { date: d };
    for (const s of live) {
      const p = s.data.find(x => x.date === d);
      if (p) row[s.name] = p.discharge_m3s;
    }
    return row;
  });

  const chartRows = rows ?? liveRows;
  const stations = rows && rows.length
    ? Object.keys(rows[0]).filter(k => k !== "date")
    : live.length ? live.map(s => s.name) : DANUBE_STATIONS;
  const COLORS = ["#1ec8c8", "#5aa9e6", "#f5b14c", "#a78bfa", "#34d399", "#fb7185", "#22d3ee"];

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].split(/[,;\t]/).map(s => s.trim());
      const dateIdx = header.findIndex(h => /date|datum|day/i.test(h));
      const parsed: Row[] = lines.slice(1).map(l => {
        const cols = l.split(/[,;\t]/);
        const row: Row = { date: cols[dateIdx >= 0 ? dateIdx : 0] };
        header.forEach((h, i) => {
          if (i === dateIdx) return;
          const v = parseFloat(cols[i]);
          if (Number.isFinite(v)) row[h] = v;
        });
        return row;
      });
      setRows(parsed);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "parse_error");
    }
  };

  const sources = Array.from(new Set(live.map(s => s.source)));

  return (
    <>
      <TopBar title="Danube" subtitle="River discharge (Open-Meteo flood API, Visual Crossing fallback)" onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">
        <Panel
          title="Auto-fetched discharge"
          actions={
            <div className="flex items-center gap-2">
              {sources.map(s => <DataBadge key={s} source={s} />)}
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => downloadCSV("danube.csv", liveRows as never)}>
                <Download className="w-3.5 h-3.5" />CSV
              </Button>
            </div>
          }
        >
          {q.isLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {q.error && <p className="text-xs text-destructive">{(q.error as Error).message}</p>}
          {!q.isLoading && liveRows.length === 0 && (
            <p className="text-xs text-muted-foreground">No discharge data returned for this range.</p>
          )}
        </Panel>

        <Panel title="Optional CSV upload (overrides auto-fetch)">
          <div className="flex items-center gap-3">
            <Input type="file" accept=".csv,text/csv" onChange={onUpload} className="max-w-xs" />
            {rows && <Button size="sm" variant="outline" onClick={() => setRows(null)}>Clear & use live</Button>}
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          <p className="text-xs text-muted-foreground mt-2">
            Columns: a date column plus one column per station (e.g. {DANUBE_STATIONS.slice(0, 3).join(", ")}…)
          </p>
        </Panel>

        {chartRows.length > 0 && (
          <Panel title={rows ? "Uploaded river levels by station" : "River discharge by station (m³/s)"}>
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={chartRows}>
                  <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke="var(--color-muted-foreground)" fontSize={11} />
                  <YAxis stroke="var(--color-muted-foreground)" fontSize={11} />
                  <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {stations.map((s, i) => <Line key={s} dataKey={s} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={1.4} />)}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Panel>
        )}
      </div>
    </>
  );
}
