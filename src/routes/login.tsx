import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { APP_PASSWORD, AUTH_KEY } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — SEE Trading Desk" }] }),
  component: LoginPage,
});

function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    if (password === APP_PASSWORD) {
      try { localStorage.setItem(AUTH_KEY, "1"); } catch {}
      nav({ to: "/dashboard" });
    } else {
      toast.error("Incorrect password");
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-info grid place-items-center text-primary-foreground font-bold">⚡</div>
            <div className="text-left">
              <div className="font-semibold tracking-tight">SEE Trading Desk</div>
              <div className="text-[11px] text-muted-foreground uppercase tracking-wider">Serbia Arbitrage & CBC Resale</div>
            </div>
          </div>
        </div>
        <Card className="bg-surface border-border/60">
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label>Password</Label>
                <Input type="password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>Enter</Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Informational/analytical tool. Always verify before trading.
        </p>
      </div>
    </div>
  );
}
