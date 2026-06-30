-- Create agricultores table
CREATE TABLE public.agricultores (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agricultor_id TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  telefono TEXT NOT NULL,
  productos TEXT[] NOT NULL DEFAULT '{}',
  notas TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.agricultores ENABLE ROW LEVEL SECURITY;

-- Create policies for agricultores access
CREATE POLICY "All authenticated users can view agricultores" 
ON public.agricultores 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert agricultores" 
ON public.agricultores 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update agricultores" 
ON public.agricultores 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete agricultores" 
ON public.agricultores 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_agricultores_updated_at
BEFORE UPDATE ON public.agricultores
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Insert the 4 agricultores
INSERT INTO public.agricultores (agricultor_id, nombre, telefono, productos, notas) VALUES
('123', 'Moisés Ariza', '34638514382@s.whatsapp.net', ARRAY['tomate','pepino','calabacín'], 'Agricultor especializado en hortalizas de invernadero. Muy puntual en las entregas.'),
('124', 'Miguel Gonzalez', '34673837438@s.whatsapp.net', ARRAY['tomate','lechuga','apio'], 'Productor ecológico con certificación. Prefiere variedades tradicionales.'),
('125', 'Eugenio Valbuena', '34640239181@s.whatsapp.net', ARRAY['pepino','calabacín','berenjena'], 'Experto en cultivos de verano. Tiene invernaderos modernos con riego automatizado.'),
('126', 'Gabriel Torres', '34665113342@s.whatsapp.net', ARRAY['tomate','pimiento','calabaza'], 'Agricultor familiar con experiencia de más de 20 años. Muy colaborativo.');