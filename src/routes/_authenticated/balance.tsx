import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getBalance } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { fmtMW } from "@/lib/format";
import { ResponsiveContainer, ComposedChart, Line, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import { Button } from "@/components/ui/button";
import { useDateRange } from "@/lib/date-range";

export const Route = createFileRoute("/_authenticated/balance")({
  head: () => ({ meta: [{ title: "Balance — SEE Trading Desk" }] }),
  component: BalancePage,
});

function BalancePage() {
  const fn = useServerFn(getBalance);
  const { range } = useDateRange();
  const q = useQuery({ queryKey: ["balance", range.from, range.to], queryFn: () => fn({ data: { from: range.from, to: range.to } }) });

  const data = (q.data?.points ?? []).map((p, i) => ({
    hour: i, load: p.load_mw, gen: p.gen_mw, delta: p.gen_mw - p.load_mw,
  }));
  const sumLoad = data.reduce((a, x) => a + x.load, 0);
  const sumGen = data.reduce((a, x) => a + x.gen, 0);
  const net = sumGen - sumLoad;

  return (
    <>
      <TopBar title="Balance" subtitle="Serbia load vs generation" onRefresh={() => q.refetch()} />
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-3 gap-3">

          <KPI label="Total load (MWh)" value={fmtMW(sumLoad)} source={q.data?.source} />
          <KPI label="Total generation (MWh)" value={fmtMW(sumGen)} source={q.data?.source} />
          <KPI label="Net balance" value={fmtMW(net)} sub={net > 0 ? "long" : "short"} accent={net > 0 ? "success" : "destructive"} />
        </div>
        <Panel title="Hourly load vs generation">
          <div className="h-80">
            <ResponsiveContainer>
              <ComposedChart data={data}>
                <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                <XAxis dataKey="hour" stroke="var(--color-muted-foreground)" fontSize={11} />
                <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" MW" />
                <Tooltip contentStyle={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="delta" name="Gen − Load" fill="#1ec8c8" opacity={0.5} />
                <Line dataKey="load" stroke="#f5b14c" dot={false} strokeWidth={2} />
                <Line dataKey="gen" stroke="#34d399" dot={false} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
    </>
  );
}
