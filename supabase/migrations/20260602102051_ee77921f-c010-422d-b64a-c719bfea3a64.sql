
-- shared updated_at trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

-- user_settings
CREATE TABLE public.user_settings (
  user_id UUID PRIMARY KEY,
  max_mw NUMERIC NOT NULL DEFAULT 100,
  min_margin NUMERIC NOT NULL DEFAULT 0,
  history_days INTEGER NOT NULL DEFAULT 30,
  selected_borders TEXT[] NOT NULL DEFAULT ARRAY['HU_RS','RO_RS','BG_RS','HR_RS','BA_RS','ME_RS','MK_RS','AL_RS'],
  selected_countries TEXT[] NOT NULL DEFAULT ARRAY['RS','HU','RO','BG','HR','BA','ME','MK','AL','SI'],
  refresh_mode TEXT NOT NULL DEFAULT 'cached',
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT ALL ON public.user_settings TO service_role;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings select" ON public.user_settings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own settings insert" ON public.user_settings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own settings update" ON public.user_settings FOR UPDATE USING (auth.uid() = user_id);
CREATE TRIGGER trg_user_settings_updated BEFORE UPDATE ON public.user_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- manual_capacity_positions
CREATE TABLE public.manual_capacity_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  position_name TEXT NOT NULL,
  border_from TEXT NOT NULL,
  border_to TEXT NOT NULL,
  product_type TEXT NOT NULL DEFAULT 'annual',
  booked_mw NUMERIC NOT NULL,
  annual_booked_price NUMERIC NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  fees NUMERIC NOT NULL DEFAULT 0,
  preferred_resale_mode TEXT NOT NULL DEFAULT 'auto',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.manual_capacity_positions TO authenticated;
GRANT ALL ON public.manual_capacity_positions TO service_role;
ALTER TABLE public.manual_capacity_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pos select" ON public.manual_capacity_positions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pos insert" ON public.manual_capacity_positions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pos update" ON public.manual_capacity_positions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pos delete" ON public.manual_capacity_positions FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_pos_updated BEFORE UPDATE ON public.manual_capacity_positions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- capacity_price_overrides
CREATE TABLE public.capacity_price_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  border_from TEXT NOT NULL,
  border_to TEXT NOT NULL,
  product_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  price_eur_mwh NUMERIC NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_price_overrides TO authenticated;
GRANT ALL ON public.capacity_price_overrides TO service_role;
ALTER TABLE public.capacity_price_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ovr select" ON public.capacity_price_overrides FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ovr insert" ON public.capacity_price_overrides FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own ovr update" ON public.capacity_price_overrides FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own ovr delete" ON public.capacity_price_overrides FOR DELETE USING (auth.uid() = user_id);

-- api_cache (server-only)
CREATE TABLE public.api_cache (
  key TEXT PRIMARY KEY,
  payload JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ttl_seconds INTEGER NOT NULL DEFAULT 1800
);
GRANT ALL ON public.api_cache TO service_role;
ALTER TABLE public.api_cache ENABLE ROW LEVEL SECURITY;

-- forecast_results
CREATE TABLE public.forecast_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_h INTEGER NOT NULL,
  history_days INTEGER NOT NULL,
  model_used TEXT NOT NULL,
  mae NUMERIC,
  mape NUMERIC,
  payload JSONB NOT NULL
);
GRANT SELECT, INSERT, DELETE ON public.forecast_results TO authenticated;
GRANT ALL ON public.forecast_results TO service_role;
ALTER TABLE public.forecast_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own fc select" ON public.forecast_results FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own fc insert" ON public.forecast_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own fc delete" ON public.forecast_results FOR DELETE USING (auth.uid() = user_id);

-- audit_log
CREATE TABLE public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  action TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audit select" ON public.audit_log FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own audit insert" ON public.audit_log FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Seed default settings + portfolio on new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_settings (user_id) VALUES (NEW.id) ON CONFLICT DO NOTHING;
  INSERT INTO public.manual_capacity_positions
    (user_id, position_name, border_from, border_to, product_type, booked_mw, annual_booked_price, start_date, end_date, preferred_resale_mode)
  VALUES
    (NEW.id, 'HR->BA annual 2026', 'HR', 'BA', 'annual', 15, 0, '2026-01-01', '2026-12-31', 'auto'),
    (NEW.id, 'BA->ME annual 2026', 'BA', 'ME', 'annual', 5,  0, '2026-01-01', '2026-12-31', 'auto');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
