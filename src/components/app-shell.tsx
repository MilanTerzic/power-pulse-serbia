import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  BookOpen,
  Calculator,
  ChevronDown,
  FileChartColumn,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  UserCircle,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { AUTH_KEY } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

type NavItem = {
  label: string;
  to: string;
  description?: string;
};

type NavGroup = {
  label: string;
  icon: typeof LayoutDashboard;
  to?: string;
  items?: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  { label: "Overview", icon: LayoutDashboard, to: "/dashboard" },
  {
    label: "Markets",
    icon: BarChart3,
    items: [
      { label: "Prices & Flows", to: "/prices", description: "Regional DA price profiles" },
      { label: "Physical Flows", to: "/flows", description: "Serbian border exchanges" },
      {
        label: "Serbia Market Position",
        to: "/balance",
        description: "Load, generation and net position",
      },
      {
        label: "Flexibility & Storage",
        to: "/spreads",
        description: "Spreads and route economics",
      },
      { label: "Capacity", to: "/capacity", description: "Auction capacity products" },
      { label: "Utilization", to: "/utilization", description: "Flow utilization by border" },
    ],
  },
  {
    label: "Intelligence",
    icon: FileChartColumn,
    items: [
      { label: "Market Brief", to: "/forecast", description: "Operational forward view" },
      { label: "CEA Reports", to: "/report", description: "Integrated trader report" },
      { label: "Analytical Signals", to: "/outages", description: "Outages and stress indicators" },
      {
        label: "News & Policy",
        to: "/weather",
        description: "Weather and policy-sensitive context",
      },
      { label: "Danube", to: "/danube", description: "Hydrology watch" },
    ],
  },
  {
    label: "Calculators",
    icon: Calculator,
    items: [
      { label: "CBC Resale Calculator", to: "/cbc", description: "Capacity resale scenarios" },
      { label: "Route Map", to: "/map", description: "Regional market topology" },
    ],
  },
  { label: "Methodology", icon: BookOpen, to: "/settings" },
];

function isActive(pathname: string, group: NavGroup) {
  if (group.to && pathname === group.to) return true;
  return group.items?.some((item) => pathname === item.to) ?? false;
}

function CeaMark() {
  return (
    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary text-sm font-black tracking-tight text-primary-foreground">
      CEA
    </div>
  );
}

function DesktopNav({ pathname }: { pathname: string }) {
  return (
    <nav className="hidden items-center gap-1 lg:flex" aria-label="Main navigation">
      {NAV_GROUPS.map((group) => {
        const active = isActive(pathname, group);
        const Icon = group.icon;
        if (group.to && !group.items) {
          return (
            <Link
              key={group.label}
              to={group.to}
              className={cn(
                "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/12 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {group.label}
            </Link>
          );
        }

        return (
          <DropdownMenu key={group.label}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/12 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                aria-label={`${group.label} navigation`}
              >
                <Icon className="h-4 w-4" />
                {group.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-72 p-2">
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                {group.label}
              </DropdownMenuLabel>
              {group.items?.map((item) => (
                <DropdownMenuItem key={item.to} asChild>
                  <Link
                    to={item.to}
                    className={cn(
                      "flex cursor-pointer flex-col items-start gap-0.5 rounded-md px-3 py-2",
                      pathname === item.to && "bg-accent text-primary",
                    )}
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.description && (
                      <span className="text-xs text-muted-foreground">{item.description}</span>
                    )}
                  </Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}
    </nav>
  );
}

function MobileNav({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[330px] overflow-y-auto p-5 sm:max-w-sm">
        <SheetHeader className="pr-8 text-left">
          <div className="flex items-center gap-3">
            <CeaMark />
            <div>
              <SheetTitle>CEA Power Dashboard</SheetTitle>
              <SheetDescription>Serbia electricity market intelligence</SheetDescription>
            </div>
          </div>
        </SheetHeader>
        <div className="mt-6">
          <Accordion type="multiple" className="space-y-2">
            {NAV_GROUPS.map((group) => {
              const active = isActive(pathname, group);
              const Icon = group.icon;
              if (group.to && !group.items) {
                return (
                  <SheetClose asChild key={group.label}>
                    <Link
                      to={group.to}
                      className={cn(
                        "flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                        active
                          ? "bg-primary/12 text-primary"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {group.label}
                    </Link>
                  </SheetClose>
                );
              }
              return (
                <AccordionItem key={group.label} value={group.label} className="rounded-lg border">
                  <AccordionTrigger
                    className={cn(
                      "min-h-11 px-3 py-0 no-underline hover:no-underline",
                      active && "text-primary",
                    )}
                  >
                    <span className="flex items-center gap-3">
                      <Icon className="h-4 w-4" />
                      {group.label}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="space-y-1 px-2 pb-2">
                    {group.items?.map((item) => (
                      <SheetClose asChild key={item.to}>
                        <Link
                          to={item.to}
                          className={cn(
                            "block rounded-md px-3 py-2 text-sm",
                            pathname === item.to
                              ? "bg-accent text-primary"
                              : "text-muted-foreground hover:bg-accent hover:text-foreground",
                          )}
                        >
                          <span className="font-medium">{item.label}</span>
                          {item.description && (
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {item.description}
                            </span>
                          )}
                        </Link>
                      </SheetClose>
                    ))}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UtilityMenu() {
  const nav = useNavigate();
  const signOut = () => {
    try {
      localStorage.removeItem(AUTH_KEY);
    } catch {
      // Ignore storage errors during sign-out.
    }
    nav({ to: "/login" });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Open user menu">
          <UserCircle className="h-5 w-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Workspace</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" className="cursor-pointer">
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={signOut} className="cursor-pointer text-destructive">
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { pathname } = useLocation();
  const content = useMemo(() => children ?? <Outlet />, [children]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <MobileNav pathname={pathname} />
          <Link
            to="/dashboard"
            className="flex min-w-0 items-center gap-3"
            aria-label="CEA Power Dashboard home"
          >
            <CeaMark />
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-semibold tracking-tight">
                CEA Power Dashboard
              </div>
              <div className="truncate text-[11px] uppercase tracking-wider text-muted-foreground">
                Serbia market intelligence
              </div>
            </div>
          </Link>
          <div className="min-w-0 flex-1">
            <DesktopNav pathname={pathname} />
          </div>
          <div className="flex items-center gap-1">
            <span className="hidden items-center gap-1 rounded-full border border-border bg-surface-2 px-2.5 py-1 text-xs text-muted-foreground md:inline-flex">
              <Activity className="h-3.5 w-3.5 text-success" />
              Live workspace
            </span>
            <UtilityMenu />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1600px]">{content}</main>
      <footer className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <span>Source-aware electricity-market analytics for Serbia and Southeast Europe.</span>
        <span>dashboard.cea.org.rs</span>
      </footer>
    </div>
  );
}
