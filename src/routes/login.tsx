import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — SEE Trading Desk" }] }),
  component: LoginPage,
});

function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    let { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error && /invalid login|invalid credentials/i.test(error.message)) {
      // Try to sign up any new email automatically
      const signUp = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      if (!signUp.error) {
        const retry = await supabase.auth.signInWithPassword({ email, password });
        error = retry.error;
      } else {
        error = signUp.error;
      }
    }
    if (!error) {
      nav({ to: "/dashboard" });
    } else {
      toast.error(error.message || "Sign in failed");
      setBusy(false);
    }
  };

  const onLovableSignIn = async () => {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("lovable", {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error(result.error.message || "Lovable sign in failed");
      setBusy(false);
      return;
    }
    if (!result.redirected) nav({ to: "/dashboard" });
  };

  return (
    <div className="min-h-screen grid place-items-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2">
            <div className="w-8 h-8 rounded bg-gradient-to-br from-primary to-info grid place-items-center text-primary-foreground font-bold">
              ⚡
            </div>
            <div className="text-left">
              <div className="font-semibold tracking-tight text-white">SEE Trading Desk</div>
              <div className="text-[11px] text-white/80 uppercase tracking-wider">
                Serbia Arbitrage & CBC Resale
              </div>
            </div>
          </div>
        </div>
        <Card className="bg-surface border-border/60">
          <CardContent className="p-6">
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-white">Email</Label>
                <Input
                  type="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="text-white"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-white">Password</Label>
                <Input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="text-white"
                />
              </div>
              <Button type="submit" className="w-full" disabled={busy}>
                Sign in
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full"
                disabled={busy}
                onClick={onLovableSignIn}
              >
                Sign in with Lovable
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="text-center text-xs text-white/70 mt-6">
          Informational/analytical tool. Always verify before trading.
        </p>
      </div>
    </div>
  );
}
