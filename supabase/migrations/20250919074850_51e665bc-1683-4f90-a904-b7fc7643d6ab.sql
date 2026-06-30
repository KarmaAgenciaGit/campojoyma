-- Habilitar RLS en todas las tablas y crear políticas
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agricultores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.previsiones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.semillas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.n8n_chat_histories_previsionesalmia_pruebas ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view their own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Políticas para user_roles
CREATE POLICY "Users can view their own roles" ON public.user_roles
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT USING (is_admin());

CREATE POLICY "Admins can manage all roles" ON public.user_roles
  FOR ALL USING (is_admin());

-- Políticas para modules
CREATE POLICY "All authenticated users can view modules" ON public.modules
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Only admins can manage modules" ON public.modules
  FOR ALL USING (is_admin());

-- Políticas para agricultores
CREATE POLICY "All authenticated users can view agricultores" ON public.agricultores
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert agricultores" ON public.agricultores
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update agricultores" ON public.agricultores
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete agricultores" ON public.agricultores
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para product_configs
CREATE POLICY "All authenticated users can view product configs" ON public.product_configs
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "Admins can manage product configs" ON public.product_configs
  FOR ALL USING (is_admin());

-- Políticas para previsiones
CREATE POLICY "All authenticated users can view previsiones" ON public.previsiones
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert previsiones" ON public.previsiones
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update previsiones" ON public.previsiones
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete previsiones" ON public.previsiones
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para projects
CREATE POLICY "Users can manage their own projects" ON public.projects
  FOR ALL USING (auth.uid() = user_id);

-- Políticas para api_tokens
CREATE POLICY "Users can manage their own tokens" ON public.api_tokens
  FOR ALL USING (auth.uid() = user_id);

-- Políticas para webhook_configs
CREATE POLICY "Users can manage their own webhook configs" ON public.webhook_configs
  FOR ALL USING (auth.uid() = user_id);