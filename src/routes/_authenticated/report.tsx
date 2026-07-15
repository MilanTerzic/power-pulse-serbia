import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RTooltip,
  Legend,
  BarChart,
  Bar,
  ReferenceLine,
} from "recharts";
import { Download, ImageDown, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { getTraderReport, type TraderReport } from "@/lib/report.functions";
import {
  calculatePresetRange,
  deliveryDay,
  deliveryHour,
  localLabel,
  type ReportPreset,
} from "@/lib/report.analytics";
import { useDateRange } from "@/lib/date-range";
import { TopBar } from "@/components/top-bar";
import { Panel } from "@/components/panel";
import { KPI } from "@/components/kpi";
import { DataBadge } from "@/components/data-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtNum, fmtPct, fmtPrice, downloadCSV } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/report")({
  head: () => ({ meta: [{ title: "Trader Report - SEE Trading Desk" }] }),
  component: TraderReportPage,
});

const COLORS: Record<string, string> = {
  RS: "#1ec8c8",
  HU: "#5aa9e6",
  RO: "#f5b14c",
  BG: "#a78bfa",
  HR: "#34d399",
  SI: "#94a3b8",
  ME: "#22d3ee",
  MK: "#fbbf24",
  AL: "#e879f9",
};

const EXPORT_THEME_COLORS: Record<string, string> = {
  "--color-background": "#242a2f",
  "--color-foreground": "#f1f5f9",
  "--color-surface": "#2b3238",
  "--color-surface-2": "#343b42",
  "--color-card": "#2d343a",
  "--color-border": "#48515a",
  "--color-grid": "#46505a",
  "--color-muted-foreground": "#a8b2bd",
  "--color-primary": "#1ec8c8",
  "--color-primary-foreground": "#122022",
  "--color-destructive": "#ef4444",
};

const PRESETS: Array<{ key: ReportPreset; label: string }> = [
  { key: "last7", label: "Last 7 days" },
  { key: "last30", label: "Last 30 days" },
  { key: "currentMonth", label: "Current month" },
  { key: "previousMonth", label: "Previous month" },
  { key: "custom", label: "Custom" },
];

function TraderReportPage() {
  const fn = useServerFn(getTraderReport);
  const { range, setRange } = useDateRange();
  const reportExportRef = useRef<HTMLDivElement | null>(null);
  const jpegObjectUrlRef = useRef<string | null>(null);
  const [preset, setPreset] = useState<ReportPreset>("last7");
  const [isExportingJpeg, setIsExportingJpeg] = useState(false);
  const [jpegDownload, setJpegDownload] = useState<{ filename: string; url: string } | null>(null);
  const [jpegExportError, setJpegExportError] = useState<string | null>(null);
  const [marketOn, setMarketOn] = useState<Record<string, boolean>>({
    RS: true,
    HU: true,
    RO: true,
    BG: true,
    HR: true,
    SI: true,
    ME: true,
    MK: true,
    AL: true,
  });
  const [countryTab, setCountryTab] = useState<"RS" | "BA">("RS");
  const [flowTab, setFlowTab] = useState<"RS" | "BA" | "all">("RS");
  const [positionFilter, setPositionFilter] = useState<
    "all" | "Net importer" | "Net exporter" | "Partial data"
  >("all");

  useEffect(() => {
    if (preset === "custom") return;
    setRange(calculatePresetRange(preset, range));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);

  useEffect(
    () => () => {
      if (jpegObjectUrlRef.current) URL.revokeObjectURL(jpegObjectUrlRef.current);
    },
    [],
  );

  const q = useQuery({
    queryKey: ["trader-report", range.from, range.to],
    queryFn: () => fn({ data: { from: range.from, to: range.to } }),
  });

  const report = q.data;
  const rs = report?.prices.marketSummary.find((m) => m.zone === "RS");
  const hu = report?.prices.marketSummary.find((m) => m.zone === "HU");
  const rsPos = report?.countryPositions.RS;
  const baPos = report?.countryPositions.BA;

  const dailyChart = useMemo(() => {
    if (!report) return [];
    const days = report.prices.dailyByZone.RS.map((d) => d.day);
    return days.map((day) => {
      const row: Record<string, string | number | null> = { day };
      for (const [zone, vals] of Object.entries(report.prices.dailyByZone)) {
        row[zone] = vals.find((v) => v.day === day)?.baseload ?? null;
      }
      return row;
    });
  }, [report]);

  const hourlyChart = useMemo(() => {
    if (!report) return [];
    const rows = new Map<string, Record<string, string | number>>();
    for (const [zone, points] of Object.entries(report.prices.hourlyByZone)) {
      for (const p of points) {
        const row = rows.get(p.ts) ?? { ts: p.ts, t: localLabel(p.ts, range.from !== range.to) };
        row[zone] = p.price;
        rows.set(p.ts, row);
      }
    }
    return [...rows.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [report, range.from, range.to]);

  const selectedPosition = countryTab === "RS" ? rsPos : baPos;
  const positionRows = (selectedPosition?.daily ?? []).filter((r) => {
    if (positionFilter === "all") return true;
    return r.position === positionFilter;
  });

  const flowRows =
    flowTab === "RS"
      ? (report?.flows.RS ?? [])
      : flowTab === "BA"
        ? (report?.flows.BA ?? [])
        : (report?.flows.all ?? []);
  const netPositionChart =
    selectedPosition?.daily.map((d) => ({
      day: d.day,
      net: d.netImportsMwh == null ? null : d.netImportsMwh / 1000,
      imports: d.importsMwh == null ? null : d.importsMwh / 1000,
      exports: d.exportsMwh == null ? null : d.exportsMwh / 1000,
    })) ?? [];

  const coverageSource = report?.coverage.some((c) => c.source === "live")
    ? "live"
    : report?.coverage.some((c) => c.source === "cache")
      ? "cache"
      : "empty";
  const avgCoverage = report
    ? report.coverage.reduce((a, c) => a + (c.coveragePct ?? 0), 0) /
      Math.max(1, report.coverage.length)
    : null;

  function exportAll() {
    if (!report) return;
    downloadCSV("trader-report-market-summary.csv", report.prices.marketSummary as never);
    downloadCSV("trader-report-serbia-position.csv", report.countryPositions.RS.daily as never);
    downloadCSV("trader-report-bosnia-position.csv", report.countryPositions.BA.daily as never);
    downloadCSV("trader-report-border-flows.csv", report.flows.all as never);
    downloadCSV("trader-report-capacity.csv", [
      ...report.capacity.daily,
      ...report.capacity.monthly,
    ] as never);
    downloadCSV("trader-report-route-economics.csv", report.routeEconomics.rows as never);
  }

  function rememberJpegDownload(filename: string, blob: Blob) {
    if (jpegObjectUrlRef.current) URL.revokeObjectURL(jpegObjectUrlRef.current);
    const url = URL.createObjectURL(blob);
    jpegObjectUrlRef.current = url;
    setJpegDownload({ filename, url });
    setJpegExportError(null);
    return url;
  }

  async function exportJpegReport() {
    if (!report) return;
    if (!reportExportRef.current) {
      setJpegExportError("Report content is not ready yet.");
      return;
    }
    const filename = `trader-report-${report.period.from}-${report.period.to}.jpg`;
    const downloadWindow = openJpegDownloadWindow(filename);
    setJpegExportError(null);
    setIsExportingJpeg(true);
    try {
      const blob = await createNodeJpeg(reportExportRef.current);
      const url = rememberJpegDownload(filename, blob);
      downloadJpegUrl(filename, url, downloadWindow);
      toast.success(`JPEG report ready: ${filename}`);
    } catch (error) {
      setJpegExportError(error instanceof Error ? error.message : "JPEG export failed");
      showDownloadError(downloadWindow);
      toast.error(error instanceof Error ? error.message : "JPEG export failed");
    } finally {
      setIsExportingJpeg(false);
    }
  }

  async function exportEmailJpeg() {
    if (!report) return;
    if (!reportExportRef.current) {
      setJpegExportError("Report content is not ready yet.");
      return;
    }
    const filename = `trader-report-${report.period.from}-${report.period.to}.jpg`;
    const downloadWindow = openJpegDownloadWindow(filename);
    setJpegExportError(null);
    setIsExportingJpeg(true);
    try {
      const blob = await createNodeJpeg(reportExportRef.current);
      const url = rememberJpegDownload(filename, blob);
      downloadJpegUrl(filename, url, downloadWindow);
      const copied = await copyImageBlobToClipboard(blob);
      openOutlookDraft(report, copied, filename);
      toast.success(
        copied
          ? "JPEG ready and copied. Outlook draft opened; click the body and press Ctrl+V."
          : "JPEG ready. Outlook draft opened; use Download latest JPEG and drag it into the email body.",
      );
    } catch (error) {
      setJpegExportError(error instanceof Error ? error.message : "JPEG export failed");
      showDownloadError(downloadWindow);
      toast.error(error instanceof Error ? error.message : "JPEG export failed");
    } finally {
      setIsExportingJpeg(false);
    }
  }

  return (
    <>
      <TopBar
        title="Trader Report"
        subtitle="Serbia desk market, physical-position, capacity and route-economics report"
        hideRange
        onRefresh={() => q.refetch()}
        lastRefresh={report?.generatedAt}
      />
      <div ref={reportExportRef} className="p-5 space-y-4 report-print-root">
        <Panel
          dense
          title="Report period"
          actions={
            <div className="flex items-center gap-2 print:hidden" data-jpeg-hidden="true">
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5"
                onClick={exportAll}
                disabled={!report}
              >
                <Download className="w-3.5 h-3.5" />
                CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={exportJpegReport}
                disabled={!report || isExportingJpeg}
              >
                <ImageDown className="w-3.5 h-3.5" />
                {isExportingJpeg ? "Creating JPEG..." : "JPEG"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={exportEmailJpeg}
                disabled={!report || isExportingJpeg}
              >
                <ImageDown className="w-3.5 h-3.5" />
                {isExportingJpeg ? "Opening email..." : "Email JPEG"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => window.print()}
              >
                <Printer className="w-3.5 h-3.5" />
                Print
              </Button>
            </div>
          }
        >
          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex rounded border border-border/70 overflow-hidden">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => setPreset(p.key)}
                  className={`px-3 py-1.5 text-xs border-r border-border/50 last:border-r-0 ${preset === p.key ? "bg-primary text-primary-foreground" : "bg-surface-2 hover:bg-accent/30"}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">From</span>
              <input
                type="date"
                value={range.from}
                max={range.to}
                onChange={(e) => {
                  setPreset("custom");
                  setRange({ ...range, from: e.target.value });
                }}
                className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
              />
              <span className="text-muted-foreground">To</span>
              <input
                type="date"
                value={range.to}
                min={range.from}
                onChange={(e) => {
                  setPreset("custom");
                  setRange({ ...range, to: e.target.value });
                }}
                className="bg-surface-2 border border-border/60 rounded px-2 py-1 num text-foreground"
              />
            </div>
            {report?.period.isCurrentDayIncluded && (
              <Badge
                variant="outline"
                className="bg-warning/15 text-warning border-warning/30 text-[10px]"
              >
                Partial current day
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">Europe/Belgrade delivery days</span>
          </div>
          {jpegDownload && (
            <div
              className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs print:hidden"
              data-jpeg-hidden="true"
            >
              <span className="text-muted-foreground">
                JPEG is ready. Use this link to download the prepared report:
              </span>
              <a
                href={jpegDownload.url}
                download={jpegDownload.filename}
                className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 font-medium text-primary-foreground hover:opacity-90"
              >
                <Download className="h-3.5 w-3.5" />
                Download latest JPEG
              </a>
            </div>
          )}
          {jpegExportError && (
            <div
              className="mt-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive print:hidden"
              data-jpeg-hidden="true"
            >
              JPEG export failed: {jpegExportError}
            </div>
          )}
        </Panel>

        {q.isLoading && <LoadingReport />}
        {q.isError && (
          <Panel title="Report unavailable">
            <div className="text-sm text-destructive">
              The report server function failed. Try refresh; cached sections will be used when
              available.
            </div>
          </Panel>
        )}

        {report && (
          <>
            <Panel title="Desk Summary" actions={<DataBadge source={coverageSource} />}>
              {report.summary?.length ? (
                <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
                  {report.summary.map((s, i) => (
                    <div
                      key={i}
                      className="bg-surface-2 border border-border/50 rounded p-3 text-sm leading-relaxed"
                    >
                      {s}
                    </div>
                  ))}
                </div>
              ) : (
                <Empty text="No deterministic summary observations are available for the selected data." />
              )}
            </Panel>

            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-2.5">
              <KPI
                label="RS baseload"
                value={fmtPrice(rs?.baseload)}
                sub="Serbia DA average"
                source={rs?.source}
              />
              <KPI
                label="RS peakload"
                value={fmtPrice(rs?.peakload)}
                sub="Mon-Fri 08-20"
                source={rs?.source}
              />
              <KPI label="RS off-peak" value={fmtPrice(rs?.offpeak)} source={rs?.source} />
              <KPI label="RS min / max" value={`${fmtPrice(rs?.min)} / ${fmtPrice(rs?.max)}`} />
              <KPI label="RS volatility" value={fmtNum(rs?.volatility)} sub="Hourly sigma" />
              <KPI
                label="Negative hours"
                value={rs?.negativeHours ?? "N/A"}
                sub={fmtPct(rs?.negativeSharePct)}
                accent={(rs?.negativeHours ?? 0) > 0 ? "warning" : "muted"}
              />
              <KPI
                label="RS vs HU"
                value={
                  hu?.baseload != null && rs?.baseload != null
                    ? fmtPrice(rs.baseload - hu.baseload)
                    : "N/A"
                }
                sub="Premium / discount"
              />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2.5">
              <KPI
                label="RS imports"
                value={`${fmtNum((rsPos?.totals.importsMwh ?? null) == null ? null : rsPos!.totals.importsMwh! / 1000)} GWh`}
              />
              <KPI
                label="RS exports"
                value={`${fmtNum((rsPos?.totals.exportsMwh ?? null) == null ? null : rsPos!.totals.exportsMwh! / 1000)} GWh`}
              />
              <KPI
                label="RS net"
                value={`${fmtNum((rsPos?.totals.netImportsMwh ?? null) == null ? null : rsPos!.totals.netImportsMwh! / 1000)} GWh`}
                sub="Positive = net imports"
                accent={(rsPos?.totals.netImportsMwh ?? 0) >= 0 ? "info" : "success"}
              />
              <KPI
                label="BA imports"
                value={`${fmtNum((baPos?.totals.importsMwh ?? null) == null ? null : baPos!.totals.importsMwh! / 1000)} GWh`}
              />
              <KPI
                label="BA exports"
                value={`${fmtNum((baPos?.totals.exportsMwh ?? null) == null ? null : baPos!.totals.exportsMwh! / 1000)} GWh`}
              />
              <KPI
                label="BA net"
                value={`${fmtNum((baPos?.totals.netImportsMwh ?? null) == null ? null : baPos!.totals.netImportsMwh! / 1000)} GWh`}
                sub="Positive = net imports"
                accent={(baPos?.totals.netImportsMwh ?? 0) >= 0 ? "info" : "success"}
              />
            </div>

            <TomorrowOutlook report={report} />

            <Panel
              title="Daily Baseload Prices by Market"
              actions={
                <MarketToggles
                  marketOn={marketOn}
                  setMarketOn={setMarketOn}
                  zones={report.sourceLists.daZones}
                />
              }
            >
              <div className="h-64">
                <ResponsiveContainer>
                  <LineChart data={dailyChart} margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                    <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="day"
                      stroke="var(--color-muted-foreground)"
                      fontSize={11}
                      minTickGap={18}
                    />
                    <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                    <RTooltip
                      contentStyle={{
                        background: "var(--color-surface-2)",
                        border: "1px solid var(--color-border)",
                      }}
                      formatter={(v: number) => [fmtPrice(v), ""]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {report.sourceLists.daZones
                      .filter((z) => marketOn[z])
                      .map((z) => (
                        <Line
                          key={z}
                          type="monotone"
                          dataKey={z}
                          stroke={COLORS[z]}
                          dot={false}
                          strokeWidth={z === "RS" ? 2.6 : 1.3}
                          connectNulls
                        />
                      ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Hourly DA Prices" data-jpeg-hidden="true">
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer mb-3">
                  Show hourly multi-market chart
                </summary>
                <div className="h-80">
                  <ResponsiveContainer>
                    <LineChart data={hourlyChart}>
                      <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="t"
                        stroke="var(--color-muted-foreground)"
                        fontSize={10}
                        minTickGap={28}
                      />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" EUR" />
                      <RTooltip
                        contentStyle={{
                          background: "var(--color-surface-2)",
                          border: "1px solid var(--color-border)",
                        }}
                        formatter={(v: number) => [fmtPrice(v), ""]}
                      />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {report.sourceLists.daZones
                        .filter((z) => marketOn[z])
                        .map((z) => (
                          <Line
                            key={z}
                            dataKey={z}
                            stroke={COLORS[z]}
                            dot={false}
                            strokeWidth={z === "RS" ? 2.4 : 1.1}
                            connectNulls
                          />
                        ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </details>
            </Panel>

            <div className="grid xl:grid-cols-2 gap-5" data-jpeg-hidden="true">
              <Panel title="Serbia Price Heatmap">
                <PriceHeatmap points={report.prices.rsHeatmap} />
              </Panel>
              <Panel title="Market Statistics">
                <MarketStats
                  rows={report.prices.marketSummary as unknown as Array<Record<string, unknown>>}
                />
              </Panel>
            </div>

            <Panel
              title="Serbia and Bosnia Power Position"
              actions={
                <span className="text-[10px] text-muted-foreground">
                  Physical cross-border proxy, not official imbalance
                </span>
              }
            >
              <div className="flex flex-wrap items-center gap-2 mb-3 print:hidden">
                <TabButton active={countryTab === "RS"} onClick={() => setCountryTab("RS")}>
                  Serbia
                </TabButton>
                <TabButton active={countryTab === "BA"} onClick={() => setCountryTab("BA")}>
                  Bosnia and Herzegovina
                </TabButton>
                <select
                  value={positionFilter}
                  onChange={(e) => setPositionFilter(e.target.value as never)}
                  className="ml-auto bg-surface-2 border border-border rounded px-2 py-1 text-xs"
                >
                  <option value="all">All days</option>
                  <option value="Net importer">Net importer</option>
                  <option value="Net exporter">Net exporter</option>
                  <option value="Partial data">Partial</option>
                </select>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">
                Net importer/exporter is based on physical cross-border net position with a
                tolerance of max(10 MWh, 0.1% of daily cross-border energy). It is not official
                balancing-system imbalance.
              </p>
              <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-4">
                <div className="h-56">
                  <ResponsiveContainer>
                    <BarChart data={netPositionChart}>
                      <CartesianGrid stroke="var(--color-grid)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="day"
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        minTickGap={16}
                      />
                      <YAxis stroke="var(--color-muted-foreground)" fontSize={11} unit=" GWh" />
                      <ReferenceLine y={0} stroke="var(--color-muted-foreground)" />
                      <RTooltip
                        contentStyle={{
                          background: "var(--color-surface-2)",
                          border: "1px solid var(--color-border)",
                        }}
                      />
                      <Bar dataKey="net" name="Net imports GWh" fill="#1ec8c8" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <PositionTable rows={positionRows as unknown as Array<Record<string, unknown>>} />
              </div>
            </Panel>

            <Panel title="Cross-Border Flow Analytics" data-jpeg-hidden="true">
              <div className="flex gap-2 mb-3 print:hidden">
                <TabButton active={flowTab === "RS"} onClick={() => setFlowTab("RS")}>
                  Serbia borders
                </TabButton>
                <TabButton active={flowTab === "BA"} onClick={() => setFlowTab("BA")}>
                  Bosnia borders
                </TabButton>
                <TabButton active={flowTab === "all"} onClick={() => setFlowTab("all")}>
                  All configured borders
                </TabButton>
              </div>
              <FlowTable rows={flowRows as unknown as Array<Record<string, unknown>>} />
            </Panel>

            <Panel title="Cross-Border Capacity Prices" data-jpeg-hidden="true">
              <CapacityTable
                daily={report.capacity.daily as unknown as Array<Record<string, unknown>>}
                monthly={report.capacity.monthly as unknown as Array<Record<string, unknown>>}
              />
            </Panel>

            <Panel title="Cross-Border Trading Opportunities">
              <p className="text-[11px] text-muted-foreground mb-3">
                {report.routeEconomics.disclaimer}
              </p>
              <div className="grid xl:grid-cols-2 gap-4">
                <OpportunityList
                  title="Top 5 import opportunities"
                  rows={
                    report.routeEconomics.topImport as unknown as Array<Record<string, unknown>>
                  }
                />
                <OpportunityList
                  title="Top 5 export opportunities"
                  rows={
                    report.routeEconomics.topExport as unknown as Array<Record<string, unknown>>
                  }
                />
              </div>
              <details className="mt-4" data-jpeg-hidden="true">
                <summary className="text-xs text-muted-foreground cursor-pointer">
                  Show all route economics
                </summary>
                <div className="mt-3">
                  <RouteTable
                    rows={report.routeEconomics.rows as unknown as Array<Record<string, unknown>>}
                  />
                </div>
              </details>
            </Panel>

            <Panel title="Data Coverage and Sources" data-jpeg-hidden="true">
              <details open>
                <summary className="text-xs text-muted-foreground cursor-pointer mb-3">
                  Show dataset coverage
                </summary>
                <CoverageTable
                  rows={report.coverage as unknown as Array<Record<string, unknown>>}
                />
              </details>
            </Panel>
          </>
        )}
      </div>
    </>
  );
}

function LoadingReport() {
  return (
    <Panel
      title="Building report"
      actions={<RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />}
    >
      <div className="grid md:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-24 rounded bg-surface-2 animate-pulse" />
        ))}
      </div>
    </Panel>
  );
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not create report JPEG"));
      },
      "image/jpeg",
      0.92,
    );
  });
}

function openJpegDownloadWindow(filename: string) {
  const helper = window.open("", "_blank", "width=520,height=360");
  if (!helper) return null;

  helper.document.title = "Preparing JPEG report";
  helper.document.body.innerHTML = [
    '<div style="font-family: Inter, Arial, sans-serif; padding: 24px; color: #172324;">',
    '<h1 style="font-size: 20px; margin: 0 0 12px;">Preparing JPEG report...</h1>',
    `<p style="font-size: 14px; line-height: 1.5; margin: 0;">The download for <strong>${escapeHtml(filename)}</strong> will start automatically when the report image is ready.</p>`,
    "</div>",
  ].join("");

  return helper;
}

function showDownloadError(helper: Window | null) {
  if (!helper || helper.closed) return;
  helper.document.title = "JPEG export failed";
  helper.document.body.innerHTML = [
    '<div style="font-family: Inter, Arial, sans-serif; padding: 24px; color: #172324;">',
    '<h1 style="font-size: 20px; margin: 0 0 12px;">JPEG export failed</h1>',
    '<p style="font-size: 14px; line-height: 1.5; margin: 0;">Please return to the dashboard and try again.</p>',
    "</div>",
  ].join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (char) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[char] ?? char;
  });
}

function downloadJpegUrl(filename: string, url: string, helper?: Window | null) {
  if (helper && !helper.closed) {
    const link = helper.document.createElement("a");
    link.href = url;
    link.download = filename;
    link.textContent = `Download ${filename}`;
    link.style.cssText =
      "display:inline-flex;margin-top:16px;padding:10px 14px;border-radius:8px;background:#0f766e;color:white;text-decoration:none;font-family:Inter,Arial,sans-serif;font-size:14px;";
    helper.document.title = "JPEG report ready";
    helper.document.body.innerHTML = [
      '<div style="font-family: Inter, Arial, sans-serif; padding: 24px; color: #172324;">',
      '<h1 style="font-size: 20px; margin: 0 0 12px;">JPEG report ready</h1>',
      '<p style="font-size: 14px; line-height: 1.5; margin: 0;">Use the button below to download the prepared report image.</p>',
      "</div>",
    ].join("");
    helper.document.body.querySelector("div")?.appendChild(link);
    helper.focus();
  }
}

async function copyImageBlobToClipboard(blob: Blob) {
  if (!navigator.clipboard || typeof ClipboardItem === "undefined") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

function interpolateHexColor(from: string, to: string, amount: number) {
  const clamp = Math.max(0, Math.min(1, amount));
  const parse = (value: string) => ({
    r: Number.parseInt(value.slice(1, 3), 16),
    g: Number.parseInt(value.slice(3, 5), 16),
    b: Number.parseInt(value.slice(5, 7), 16),
  });
  const a = parse(from);
  const b = parse(to);
  const channel = (start: number, end: number) =>
    Math.round(start + (end - start) * clamp)
      .toString(16)
      .padStart(2, "0");
  return `#${channel(a.r, b.r)}${channel(a.g, b.g)}${channel(a.b, b.b)}`;
}

function normalizeClonedReportForCanvas(clonedDocument: Document) {
  const root = clonedDocument.querySelector(".report-print-root");
  if (!root) return;

  root.querySelectorAll<HTMLElement>("*").forEach((el) => {
    el.style.boxShadow = "none";
    el.style.textShadow = "none";
    el.style.outlineColor = EXPORT_THEME_COLORS["--color-primary"];
    el.style.borderColor = EXPORT_THEME_COLORS["--color-border"];
  });

  root.querySelectorAll<SVGElement>("svg *").forEach((el) => {
    for (const attr of ["fill", "stroke", "stop-color"]) {
      const value = el.getAttribute(attr);
      if (!value || value === "none" || value.startsWith("#") || value.startsWith("url(")) continue;
      if (value.includes("var(") || value.includes("okl") || value.includes("lab")) {
        el.setAttribute(attr, attr === "fill" ? "none" : EXPORT_THEME_COLORS["--color-grid"]);
      }
    }
    const style = el.getAttribute("style");
    if (style?.includes("okl") || style?.includes("lab") || style?.includes("color-mix")) {
      el.removeAttribute("style");
    }
  });
}

function createIsolatedReportClone(node: HTMLElement, width: number, height: number) {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-100000px";
  iframe.style.top = "0";
  iframe.style.width = `${width}px`;
  iframe.style.height = `${height}px`;
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error("Could not prepare report JPEG");
  }

  doc.open();
  doc.write("<!doctype html><html><head></head><body></body></html>");
  doc.close();
  doc.documentElement.style.background = EXPORT_THEME_COLORS["--color-background"];
  doc.body.style.margin = "0";
  doc.body.style.background = EXPORT_THEME_COLORS["--color-background"];
  doc.body.style.width = `${width}px`;
  doc.body.style.minHeight = `${height}px`;

  const clone = node.cloneNode(true) as HTMLElement;
  inlineSafeComputedStyles(node, clone);
  removeExportHidden(clone);
  clone.style.width = `${width}px`;
  clone.style.minHeight = `${height}px`;
  clone.style.background = EXPORT_THEME_COLORS["--color-background"];
  doc.body.appendChild(clone);
  normalizeClonedReportForCanvas(doc);
  return { iframe, clone };
}

function removeExportHidden(node: Element) {
  node.querySelectorAll("[data-jpeg-hidden='true']").forEach((el) => el.remove());
  node.querySelectorAll("*").forEach((el) => {
    if (el.classList.contains("print:hidden")) el.remove();
  });
}

function inlineSafeComputedStyles(source: Element, clone: Element) {
  const computed = window.getComputedStyle(source);
  const ignored = new Set(["animation", "animation-name", "transition", "transition-property"]);
  let cssText = clone.getAttribute("style") ?? "";

  for (const property of Array.from(computed)) {
    if (ignored.has(property)) continue;
    const rawValue = computed.getPropertyValue(property);
    const value = normalizeCanvasCssProperty(property, rawValue);
    if (value) cssText += `;${property}:${value}`;
  }

  clone.setAttribute("style", cssText);

  const sourceChildren = Array.from(source.children);
  const cloneChildren = Array.from(clone.children);
  for (let i = 0; i < sourceChildren.length; i += 1) {
    if (cloneChildren[i]) inlineSafeComputedStyles(sourceChildren[i], cloneChildren[i]);
  }
}

function normalizeCanvasCssProperty(property: string, value: string) {
  if (!value) return value;
  const unsupportedColor = /(?:oklab|oklch|lab|lch|color-mix)\(/i.test(value);
  if (!unsupportedColor) return value;

  if (property.includes("shadow")) return "none";
  if (property.includes("border")) return EXPORT_THEME_COLORS["--color-border"];
  if (property.includes("outline") || property.includes("decoration")) {
    return EXPORT_THEME_COLORS["--color-primary"];
  }
  if (property === "color" || property.includes("text")) {
    return EXPORT_THEME_COLORS["--color-foreground"];
  }
  if (property.includes("background")) {
    return property === "background-image" ? "none" : EXPORT_THEME_COLORS["--color-surface"];
  }
  if (property.includes("fill") || property.includes("stroke")) {
    return EXPORT_THEME_COLORS["--color-grid"];
  }
  return "";
}

function openOutlookDraft(report: TraderReport, copied: boolean, filename: string) {
  const subject = `Trader Report ${report.period.from} to ${report.period.to}`;
  const body = copied
    ? [
        "Trader Report image has been copied to clipboard.",
        "",
        "Click in the email body and press Ctrl+V to insert it here.",
      ].join("\r\n")
    : [
        `Trader Report JPEG has been downloaded as ${filename}.`,
        "",
        "Drag the downloaded image into the email body.",
      ].join("\r\n");
  window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function createNodeJpeg(node: HTMLElement) {
  const width = Math.ceil(node.scrollWidth);
  const height = Math.ceil(node.scrollHeight);
  if (!width || !height) throw new Error("Report is empty; nothing to export");
  const scale = Math.min(2, 12000 / width, 16000 / height);
  const { default: html2canvas } = await import("html2canvas");
  const { iframe, clone } = createIsolatedReportClone(node, width, height);
  try {
    const canvas = await html2canvas(clone, {
      backgroundColor: EXPORT_THEME_COLORS["--color-background"],
      imageTimeout: 0,
      logging: false,
      scale,
      useCORS: true,
      width,
      height,
      windowWidth: width,
      windowHeight: height,
    });
    return canvasToJpegBlob(canvas);
  } finally {
    iframe.remove();
  }
}

function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground py-8 text-center">{text}</div>;
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded border text-xs ${active ? "bg-primary text-primary-foreground border-primary" : "bg-surface-2 border-border hover:bg-accent/30"}`}
    >
      {children}
    </button>
  );
}

function MarketToggles({
  marketOn,
  setMarketOn,
  zones,
}: {
  marketOn: Record<string, boolean>;
  setMarketOn: (v: Record<string, boolean>) => void;
  zones: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1 print:hidden">
      {zones.map((z) => (
        <button
          key={z}
          onClick={() => setMarketOn({ ...marketOn, [z]: !marketOn[z] })}
          className={`px-2 py-1 rounded text-[10px] border ${marketOn[z] ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
        >
          {z}
        </button>
      ))}
    </div>
  );
}

function TomorrowOutlook({ report }: { report: TraderReport }) {
  const t = report.tomorrowOutlook;
  return (
    <Panel title="Tomorrow Market Outlook">
      {t ? (
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
          <KPI label="Tomorrow SEEPEX" value={fmtPrice(t.seepexBaseload)} />
          <KPI
            label="Cheapest market"
            value={
              t.cheapestMarket
                ? `${t.cheapestMarket.zone} ${fmtPrice(t.cheapestMarket.avg)}`
                : "N/A"
            }
            accent="success"
          />
          <KPI
            label="Most expensive"
            value={
              t.mostExpensiveMarket
                ? `${t.mostExpensiveMarket.zone} ${fmtPrice(t.mostExpensiveMarket.avg)}`
                : "N/A"
            }
            accent="warning"
          />
          <KPI label="Serbia rank" value={t.serbiaRank ?? "N/A"} sub="Among available DA markets" />
          <KPI label="RS vs HU" value={fmtPrice(t.serbiaVsHungary)} />
          <KPI
            label="Lowest RS hour"
            value={t.minSerbia ? fmtPrice(t.minSerbia.price) : "N/A"}
            sub={t.minSerbia ? localLabel(t.minSerbia.ts) : undefined}
          />
          <KPI
            label="Highest RS hour"
            value={t.maxSerbia ? fmtPrice(t.maxSerbia.price) : "N/A"}
            sub={t.maxSerbia ? localLabel(t.maxSerbia.ts) : undefined}
          />
        </div>
      ) : (
        <div className="text-sm text-muted-foreground">
          Tomorrow's DA prices have not been published yet.
        </div>
      )}
    </Panel>
  );
}

function PriceHeatmap({ points }: { points: Array<{ ts: string; price: number }> }) {
  const byDay = new Map<string, Array<{ hour: number; price: number; ts: string }>>();
  for (const p of points) {
    const day = deliveryDay(p.ts);
    byDay.set(day, [
      ...(byDay.get(day) ?? []),
      { hour: deliveryHour(p.ts), price: p.price, ts: p.ts },
    ]);
  }
  const values = points.map((p) => p.price);
  const min = values.length ? Math.min(...values) : 0;
  const max = values.length ? Math.max(...values) : 1;
  if (!points.length) return <Empty text="No Serbia DA prices available." />;
  return (
    <div className="overflow-x-auto">
      <div
        className="grid gap-1 min-w-[720px]"
        style={{ gridTemplateColumns: "86px repeat(24, minmax(22px, 1fr))" }}
      >
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={h} className="text-[9px] text-center text-muted-foreground">
            {String(h).padStart(2, "0")}
          </div>
        ))}
        {[...byDay.entries()].map(([day, rows]) => {
          const byHour = new Map(rows.map((r) => [r.hour, r]));
          return (
            <div key={day} className="contents">
              <div className="text-[10px] text-muted-foreground flex items-center">{day}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const r = byHour.get(h);
                const pct = r ? (r.price - min) / Math.max(1, max - min) : 0;
                const bg = !r
                  ? EXPORT_THEME_COLORS["--color-surface-2"]
                  : r.price < 0
                    ? "#b91c1c"
                    : interpolateHexColor("#164e63", EXPORT_THEME_COLORS["--color-primary"], pct);
                return (
                  <div
                    key={h}
                    title={
                      r
                        ? `${day} ${String(h).padStart(2, "0")}:00 - ${r.price.toFixed(2)} EUR/MWh`
                        : `${day} ${h}: no data`
                    }
                    className="h-5 rounded-[2px] border border-border/30"
                    style={{ background: bg }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MarketStats({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="sticky left-0 bg-surface text-left py-2">Market</th>
            <th className="text-right">Base</th>
            <th className="text-right">Peak</th>
            <th className="text-right">Off</th>
            <th className="text-right">Min</th>
            <th className="text-right">Max</th>
            <th className="text-right">Sigma</th>
            <th className="text-right">P10</th>
            <th className="text-right">P90</th>
            <th className="text-right">Neg h</th>
            <th className="text-right">RS spread</th>
            <th className="text-right">Corr</th>
            <th className="text-right">Coverage</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.zone)} className="border-t border-border/50">
              <td className="sticky left-0 bg-surface py-1.5 font-medium">{String(r.zone)}</td>
              <td className="text-right num">{fmtPrice(r.baseload as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.peakload as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.offpeak as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.min as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.max as number | null)}</td>
              <td className="text-right num">{fmtNum(r.volatility as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.p10 as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.p90 as number | null)}</td>
              <td className="text-right num">{String(r.negativeHours ?? "N/A")}</td>
              <td className="text-right num">{fmtPrice(r.avgSpreadVsRS as number | null)}</td>
              <td className="text-right num">{fmtNum(r.correlationVsRS as number | null, 2)}</td>
              <td className="text-right num">{fmtPct(r.coveragePct as number | null)}</td>
              <td className="text-right">
                <DataBadge source={String(r.source)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PositionTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left py-2">Date</th>
            <th className="text-left">Position</th>
            <th className="text-right">Imports MWh</th>
            <th className="text-right">Exports MWh</th>
            <th className="text-right">Net MWh</th>
            <th className="text-right">Avg MW</th>
            <th className="text-right">Peak imp</th>
            <th className="text-right">Peak exp</th>
            <th className="text-right">Load MWh</th>
            <th className="text-right">Gen MWh</th>
            <th className="text-right">Gen-load</th>
            <th className="text-right">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.day)} className="border-t border-border/50">
              <td className="py-1.5">{String(r.day)}</td>
              <td>
                {String(r.position)}{" "}
                {r.partial ? (
                  <Badge variant="outline" className="ml-1 text-[9px] bg-warning/15 text-warning">
                    Partial
                  </Badge>
                ) : null}
              </td>
              <td className="text-right num">{fmtNum(r.importsMwh as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.exportsMwh as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.netImportsMwh as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.avgNetMw as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.peakImportMw as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.peakExportMw as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.loadMwh as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.generationMwh as number | null, 0)}</td>
              <td className="text-right num">
                {fmtNum(r.generationMinusLoadMwh as number | null, 0)}
              </td>
              <td className="text-right num">{fmtPct(r.coveragePct as number | null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FlowTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left py-2">Border</th>
            <th className="text-left">Dominant direction</th>
            <th className="text-right">Inbound GWh</th>
            <th className="text-right">Outbound GWh</th>
            <th className="text-right">Net GWh</th>
            <th className="text-right">Avg MW</th>
            <th className="text-right">Peak MW</th>
            <th className="text-right">Flow LF</th>
            <th className="text-right">Avg util</th>
            <th className="text-right">Peak util</th>
            <th className="text-right">Reversals</th>
            <th className="text-right">Coverage</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.border)} className="border-t border-border/50">
              <td className="py-1.5 font-medium">{String(r.border)}</td>
              <td>{String(r.dominantDirection)}</td>
              <td className="text-right num">{fmtNum(r.inboundGwh as number | null, 2)}</td>
              <td className="text-right num">{fmtNum(r.outboundGwh as number | null, 2)}</td>
              <td className="text-right num">{fmtNum(r.netGwh as number | null, 2)}</td>
              <td className="text-right num">{fmtNum(r.avgMw as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.peakMw as number | null, 0)}</td>
              <td className="text-right num">{fmtPct(r.flowLoadFactorPct as number | null)}</td>
              <td className="text-right num">{fmtPct(r.averageUtilizationPct as number | null)}</td>
              <td className="text-right num">{fmtPct(r.peakUtilizationPct as number | null)}</td>
              <td className="text-right num">{String(r.directionReversals)}</td>
              <td className="text-right num">{fmtPct(r.coveragePct as number | null)}</td>
              <td className="text-right">
                <DataBadge source={String(r.source)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CapacityTable({
  daily,
  monthly,
}: {
  daily: Array<Record<string, unknown>>;
  monthly: Array<Record<string, unknown>>;
}) {
  const rows = [...daily, ...monthly];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left py-2">Direction</th>
            <th className="text-left">Product</th>
            <th className="text-right">Avg price</th>
            <th className="text-right">VWAP</th>
            <th className="text-right">Min</th>
            <th className="text-right">Max</th>
            <th className="text-right">Obs</th>
            <th className="text-right">Coverage</th>
            <th className="text-right">Offered MW</th>
            <th className="text-right">Allocated MW</th>
            <th className="text-right">Alloc ratio</th>
            <th className="text-left">Unit</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${String(r.direction)}-${String(r.product)}-${i}`}
              className="border-t border-border/50"
            >
              <td className="py-1.5 font-medium">{String(r.direction)}</td>
              <td>{String(r.product)}</td>
              <td className="text-right num">{fmtPrice(r.averagePrice as number | null)}</td>
              <td className="text-right num">
                {fmtPrice(r.volumeWeightedAveragePrice as number | null)}
              </td>
              <td className="text-right num">{fmtPrice(r.minPrice as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.maxPrice as number | null)}</td>
              <td className="text-right num">
                {String(r.validObservations)} / {String(r.expectedObservations)}
              </td>
              <td className="text-right num">{fmtPct(r.coveragePct as number | null)}</td>
              <td className="text-right num">{fmtNum(r.averageOfferedMw as number | null, 0)}</td>
              <td className="text-right num">{fmtNum(r.averageAllocatedMw as number | null, 0)}</td>
              <td className="text-right num">{fmtPct(r.allocationRatioPct as number | null)}</td>
              <td className="text-left text-muted-foreground">
                {String(r.warning ?? r.unit ?? "")}
              </td>
              <td>
                <DataBadge source={String(r.source)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OpportunityList({ title, rows }: { title: string; rows: Array<Record<string, unknown>> }) {
  return (
    <div className="bg-surface-2 border border-border/60 rounded p-3">
      <div className="text-xs font-medium mb-2">{title}</div>
      <div className="space-y-1">
        {rows.length ? (
          rows.map((r) => (
            <div
              key={`${String(r.route)}-${String(r.direction)}`}
              className="flex items-center justify-between text-xs gap-2"
            >
              <span>{String(r.route)}</span>
              <span className="num text-primary">
                {fmtPrice((r.avgNetMargin as number | null) ?? (r.avgGrossMargin as number | null))}
              </span>
            </div>
          ))
        ) : (
          <span className="text-xs text-muted-foreground">No opportunity data.</span>
        )}
      </div>
    </div>
  );
}

function RouteTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left py-2">Route</th>
            <th>Dir</th>
            <th className="text-right">Avg gross</th>
            <th className="text-right">Avg net</th>
            <th className="text-right">Gross +h</th>
            <th className="text-right">Net +h</th>
            <th className="text-right">Max net</th>
            <th className="text-right">Gross value / MW</th>
            <th className="text-right">Net value / MW</th>
            <th className="text-left">Best day</th>
            <th className="text-left">Worst day</th>
            <th className="text-right">Price cov</th>
            <th className="text-right">Cap cov</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={`${String(r.route)}-${String(r.direction)}`}
              className="border-t border-border/50"
            >
              <td className="py-1.5 font-medium">{String(r.route)}</td>
              <td>{String(r.direction)}</td>
              <td className="text-right num">{fmtPrice(r.avgGrossMargin as number | null)}</td>
              <td className="text-right num">{fmtPrice(r.avgNetMargin as number | null)}</td>
              <td className="text-right num">{String(r.positiveGrossHours)}</td>
              <td className="text-right num">{String(r.positiveNetHours ?? "N/A")}</td>
              <td className="text-right num">{fmtPrice(r.maxHourlyNetMargin as number | null)}</td>
              <td className="text-right num">
                {fmtNum(r.theoreticalGrossValuePerMw as number | null, 0)}
              </td>
              <td className="text-right num">
                {fmtNum(r.theoreticalNetValuePerMw as number | null, 0)}
              </td>
              <td>{String(r.bestDeliveryDay ?? "N/A")}</td>
              <td>{String(r.worstDeliveryDay ?? "N/A")}</td>
              <td className="text-right num">{fmtPct(r.priceCoveragePct as number | null)}</td>
              <td className="text-right num">{fmtPct(r.capacityCoveragePct as number | null)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CoverageTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="text-left py-2">Dataset</th>
            <th className="text-left">Country / border</th>
            <th>Source</th>
            <th className="text-left">First</th>
            <th className="text-left">Last</th>
            <th className="text-right">Expected</th>
            <th className="text-right">Received</th>
            <th className="text-right">Coverage</th>
            <th className="text-left">Warning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr
              key={`${String(r.dataset)}-${String(r.subject)}-${i}`}
              className="border-t border-border/50"
            >
              <td className="py-1.5 font-medium">{String(r.dataset)}</td>
              <td>{String(r.subject)}</td>
              <td>
                <DataBadge source={String(r.source)} />
              </td>
              <td>{String(r.firstTimestamp ?? "")}</td>
              <td>{String(r.lastTimestamp ?? "")}</td>
              <td className="text-right num">{String(r.expectedIntervals)}</td>
              <td className="text-right num">{String(r.receivedIntervals)}</td>
              <td className="text-right num">{fmtPct(r.coveragePct as number | null)}</td>
              <td className="text-muted-foreground">{String(r.warning ?? "")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
