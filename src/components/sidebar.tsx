import { Link, useLocation } from "@tanstack/react-router";
import {
  LayoutDashboard, LineChart, ArrowLeftRight, Map, Plug, MoveRight,
  Activity, AlertTriangle, CloudSun, Waves, TrendingUp, Briefcase, Settings, LogOut,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { AUTH_KEY } from "@/lib/auth";

const NAV = [
  { to: "/dashboard", label: "Overview",    icon: LayoutDashboard },
  { to: "/prices",    label: "Prices",      icon: LineChart },
  { to: "/spreads",   label: "Spreads",     icon: ArrowLeftRight },
  { to: "/map",       label: "Route Map",   icon: Map },
  { to: "/capacity",  label: "Capacity",    icon: Plug },
  { to: "/flows",     label: "Flows",       icon: MoveRight },
  { to: "/balance",   label: "Balance",     icon: Activity },
  { to: "/outages",   label: "Outages",     icon: AlertTriangle },
  { to: "/weather",   label: "Weather",     icon: CloudSun },
  { to: "/danube",    label: "Danube",      icon: Waves },
  { to: "/forecast",  label: "Forecast",    icon: TrendingUp },
  { to: "/cbc",       label: "CBC Resale",  icon: Briefcase },
  { to: "/settings",  label: "Settings",    icon: Settings },
];

export function Sidebar() {
  const loc = useLocation();
  const nav = useNavigate();
  const signOut = () => {
    try { localStorage.removeItem(AUTH_KEY); } catch {}
    nav({ to: "/login" });
  };
  return (
    <aside className="w-56 shrink-0 bg-surface border-r border-border/60 flex flex-col">
      <div className="px-4 py-4 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded bg-gradient-to-br from-primary to-info grid place-items-center text-primary-foreground font-bold">⚡</div>
          <div>
            <div className="text-sm font-semibold tracking-tight">SEE Trading</div>
            <div className="text-[10px] text-muted-foreground tracking-wider uppercase">Serbia Desk</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {NAV.map(n => {
          const active = loc.pathname === n.to;
          const Icon = n.icon;
          return (
            <Link
              key={n.to} to={n.to}
              className={`flex items-center gap-2 px-4 py-2 text-sm transition-colors border-l-2 ${
                active
                  ? "bg-accent/40 text-primary border-primary"
                  : "border-transparent text-foreground/80 hover:bg-accent/20 hover:text-foreground"
              }`}
            >
              <Icon className="w-4 h-4" />
              <span>{n.label}</span>
            </Link>
          );
        })}
      </nav>
      <button onClick={signOut} className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:text-foreground border-t border-border/60">
        <LogOut className="w-4 h-4" /> Sign out
      </button>
    </aside>
  );
}
