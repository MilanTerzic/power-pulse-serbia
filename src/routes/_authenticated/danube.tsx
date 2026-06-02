import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { DANUBE_STATIONS } from "@/lib/markets";

export const Route = createFileRoute("/_authenticated/danube")({
  head: () => ({ meta: [{ title: "Danube — SEE Trading Desk" }] }),
  component: DanubePage,
});

interface Row { date: string; [station: string]: string | number; }

function DanubePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);

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

  const stations = rows.length ? Object.keys(rows[0]).filter(k => k !== "date") : DANUBE_STATIONS;
  const COLORS = ["#1ec8c8", "#5aa9e6", "#f5b14c", "#a78bfa", "#34d399", "#fb7185", "#22d3ee"];

  return (
    <>
      <TopBar title="Danube" subtitle="Upload river-level CSV (date + station columns) for hydro proxy" />
      <div className="p-6 space-y-5">
        <Panel title="CSV upload">
          <div className="flex items-center gap-3">
            <Input type="file" accept=".csv,text/csv" onChange={onUpload} className="max-w-xs" />
            {rows.length > 0 && <Button size="sm" variant="outline" onClick={() => setRows([])}>Clear</Button>}
          </div>
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
          <p className="text-xs text-muted-foreground mt-2">Expected columns: a date column plus one column per station (e.g. {DANUBE_STATIONS.slice(0, 3).join(", ")}…)</p>
        </Panel>

        {rows.length > 0 && (
          <Panel title="River levels by station">
            <div className="h-80">
              <ResponsiveContainer>
                <LineChart data={rows}>
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
