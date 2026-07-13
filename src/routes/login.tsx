import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_PASSWORD, AUTH_KEY } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in - CEA Power Dashboard" }] }),
  component: LoginPage,
});

function LoginPage() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    if (password === APP_PASSWORD) {
      try {
        localStorage.setItem(AUTH_KEY, "1");
      } catch {
        // Ignore storage failures and continue with navigation.
      }
      nav({ to: "/dashboard" });
    } else {
      toast.error("Incorrect password");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="inline-flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-xs font-black tracking-tight text-primary-foreground">
              CEA
            </div>
            <div className="text-left">
              <div className="font-semibold tracking-tight text-foreground">
                CEA Power Dashboard
              </div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Serbia market intelligence
              </div>
            </div>
          </div>
        </div>
        <Card className="border-border bg-surface">
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoFocus
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Enter
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Informational analytical tool. Always verify before trading.
        </p>
      </div>
    </div>
  );
}
