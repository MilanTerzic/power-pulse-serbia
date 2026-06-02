import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getSettings, updateSettings } from "@/lib/data.functions";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — SEE Trading Desk" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const getFn = useServerFn(getSettings);
  const setFn = useServerFn(updateSettings);
  const q = useQuery({ queryKey: ["settings"], queryFn: () => getFn() });
  const [form, setForm] = useState<{ max_mw: string; min_margin: string; history_days: string; demo_mode: boolean }>({
    max_mw: "100", min_margin: "0", history_days: "30", demo_mode: false,
  });

  useEffect(() => {
    if (q.data) setForm({
      max_mw: String(q.data.max_mw),
      min_margin: String(q.data.min_margin),
      history_days: String(q.data.history_days),
      demo_mode: !!q.data.demo_mode,
    });
  }, [q.data]);

  const m = useMutation({
    mutationFn: () => setFn({ data: {
      max_mw: parseFloat(form.max_mw),
      min_margin: parseFloat(form.min_margin),
      history_days: parseInt(form.history_days),
      demo_mode: form.demo_mode,
    } }),
    onSuccess: () => { toast.success("Saved"); q.refetch(); },
    onError: e => toast.error(e instanceof Error ? e.message : "save failed"),
  });

  return (
    <>
      <TopBar title="Settings" subtitle="Trading assumptions and data preferences" />
      <div className="p-6 max-w-2xl">
        <Panel title="Trading">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5"><Label>Max tradable MW</Label><Input value={form.max_mw} onChange={e => setForm({ ...form, max_mw: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Min profitable margin €/MWh</Label><Input value={form.min_margin} onChange={e => setForm({ ...form, min_margin: e.target.value })} /></div>
            <div className="space-y-1.5"><Label>Forecast history days</Label><Input value={form.history_days} onChange={e => setForm({ ...form, history_days: e.target.value })} /></div>
            <div className="space-y-1.5 flex items-end gap-3">
              <div>
                <Label>Demo mode</Label>
                <p className="text-xs text-muted-foreground">Use synthetic data everywhere.</p>
              </div>
              <Switch checked={form.demo_mode} onCheckedChange={v => setForm({ ...form, demo_mode: v })} />
            </div>
          </div>
          <div className="mt-4"><Button onClick={() => m.mutate()} disabled={m.isPending}>Save</Button></div>
        </Panel>
      </div>
    </>
  );
}
