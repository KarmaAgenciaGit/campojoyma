-- Create a table for semillas (seeds)
CREATE TABLE public.semillas (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fabricante TEXT NOT NULL,
  variedad TEXT NOT NULL,
  tipo_semilla TEXT NOT NULL,
  cantidad_semillas INTEGER NOT NULL,
  numero_producto TEXT NOT NULL,
  numero_lote TEXT NOT NULL,
  color_cultivo TEXT,
  especie TEXT NOT NULL,
  fecha_envasado DATE,
  origen TEXT,
  tratamiento TEXT,
  germinacion_minima DECIMAL,
  pureza DECIMAL,
  categoria TEXT,
  test_fecha DATE,
  codigo_apc TEXT,
  base64_frontal_bolsa TEXT,
  base64_trasero_bolsa TEXT,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.semillas ENABLE ROW LEVEL SECURITY;

-- Create policies for user access
CREATE POLICY "All authenticated users can view all semillas" 
ON public.semillas 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert semillas" 
ON public.semillas 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update semillas" 
ON public.semillas 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete semillas" 
ON public.semillas 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_semillas_updated_at
BEFORE UPDATE ON public.semillas
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert the semillas module
INSERT INTO public.modules (name, display_name, description, icon, path, is_enabled)
VALUES ('semillas', 'Semillas', 'Gestión de semillas y variedades', 'Sprout', '/semillas', true)
ON CONFLICT (name) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  path = EXCLUDED.path;