-- Create previsiones table
CREATE TABLE public.previsiones (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agricultor_id TEXT NOT NULL,
  user_id UUID NOT NULL,
  fechaentrega DATE NOT NULL,
  cantidad NUMERIC NOT NULL,
  genero TEXT NOT NULL,
  notas TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'revisada', 'completada')),
  cantidad_traida NUMERIC,
  fecha_revision TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  FOREIGN KEY (agricultor_id) REFERENCES public.agricultores(agricultor_id)
);

-- Enable RLS
ALTER TABLE public.previsiones ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "All authenticated users can view previsiones" 
ON public.previsiones 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert previsiones" 
ON public.previsiones 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update previsiones" 
ON public.previsiones 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete previsiones" 
ON public.previsiones 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_previsiones_updated_at
BEFORE UPDATE ON public.previsiones
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();