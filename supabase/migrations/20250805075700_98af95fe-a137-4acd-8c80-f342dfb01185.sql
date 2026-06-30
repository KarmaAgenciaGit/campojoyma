-- Crear tabla de perfiles de usuario
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Habilitar RLS en profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Políticas para profiles
CREATE POLICY "Users can view their own profile" 
ON public.profiles 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile" 
ON public.profiles 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own profile" 
ON public.profiles 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

-- Crear tabla de proyectos
CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS en projects
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

-- Políticas para projects
CREATE POLICY "Users can manage their own projects" 
ON public.projects 
FOR ALL 
USING (auth.uid() = user_id);

-- Crear tabla de partes de trabajo
CREATE TABLE public.work_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date DATE NOT NULL,
  description TEXT,
  performed_by TEXT NOT NULL,
  duration INTEGER NOT NULL, -- duración en minutos
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS en work_reports
ALTER TABLE public.work_reports ENABLE ROW LEVEL SECURITY;

-- Políticas para work_reports
CREATE POLICY "Users can manage their own work reports" 
ON public.work_reports 
FOR ALL 
USING (auth.uid() = user_id);

-- Crear tabla de productos para facturas
CREATE TABLE public.invoice_products (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id UUID NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2) NOT NULL,
  product_name TEXT NOT NULL,
  total_price DECIMAL(10,2) NOT NULL
);

-- Crear tabla de facturas
CREATE TABLE public.invoices (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issuer_company_name TEXT NOT NULL,
  issuer_email TEXT NOT NULL,
  issuer_phone TEXT,
  issuer_cif TEXT NOT NULL,
  receiver_company_name TEXT NOT NULL,
  receiver_cif TEXT NOT NULL,
  date DATE NOT NULL,
  budget_number TEXT,
  tax_base DECIMAL(10,2) NOT NULL,
  vat DECIMAL(10,2) NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS en invoices
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

-- Políticas para invoices
CREATE POLICY "Users can manage their own invoices" 
ON public.invoices 
FOR ALL 
USING (auth.uid() = user_id);

-- Añadir foreign key a invoice_products
ALTER TABLE public.invoice_products 
ADD CONSTRAINT fk_invoice_products_invoice_id 
FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE CASCADE;

-- Habilitar RLS en invoice_products
ALTER TABLE public.invoice_products ENABLE ROW LEVEL SECURITY;

-- Políticas para invoice_products (a través de la factura)
CREATE POLICY "Users can manage products of their own invoices" 
ON public.invoice_products 
FOR ALL 
USING (
  invoice_id IN (
    SELECT id FROM public.invoices WHERE user_id = auth.uid()
  )
);

-- Crear tabla de albaranes
CREATE TABLE public.delivery_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  issuer_company_name TEXT NOT NULL,
  issuer_email TEXT NOT NULL,
  issuer_phone TEXT,
  issuer_cif TEXT NOT NULL,
  receiver_company_name TEXT NOT NULL,
  receiver_cif TEXT NOT NULL,
  date DATE NOT NULL,
  reference_number TEXT,
  description TEXT,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Habilitar RLS en delivery_notes
ALTER TABLE public.delivery_notes ENABLE ROW LEVEL SECURITY;

-- Políticas para delivery_notes
CREATE POLICY "Users can manage their own delivery notes" 
ON public.delivery_notes 
FOR ALL 
USING (auth.uid() = user_id);

-- Crear tabla de configuración de webhooks
CREATE TABLE public.webhook_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('invoices', 'delivery_notes', 'work_reports')),
  webhook_url TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, type)
);

-- Habilitar RLS en webhook_configs
ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;

-- Políticas para webhook_configs
CREATE POLICY "Users can manage their own webhook configs" 
ON public.webhook_configs 
FOR ALL 
USING (auth.uid() = user_id);

-- Trigger para crear perfil automáticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY definer
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$;

-- Trigger que se ejecuta al crear un usuario
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Función para actualizar timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers para actualizar timestamps automáticamente
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_work_reports_updated_at
  BEFORE UPDATE ON public.work_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_delivery_notes_updated_at
  BEFORE UPDATE ON public.delivery_notes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_webhook_configs_updated_at
  BEFORE UPDATE ON public.webhook_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();