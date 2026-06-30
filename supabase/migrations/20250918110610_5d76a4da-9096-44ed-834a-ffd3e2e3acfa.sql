-- Create table for product configurations
CREATE TABLE public.product_configs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genero TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  color_class TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.product_configs ENABLE ROW LEVEL SECURITY;

-- Create policies for authenticated users
CREATE POLICY "All authenticated users can view product configs" 
ON public.product_configs 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "Admins can manage product configs" 
ON public.product_configs 
FOR ALL 
USING (is_admin());

-- Insert default product configurations
INSERT INTO public.product_configs (genero, emoji, color_class) VALUES
('tomate', '🍅', 'bg-red-500/10 text-red-600 border-red-200'),
('pimiento', '🌶️', 'bg-orange-500/10 text-orange-600 border-orange-200'),
('calabaza', '🎃', 'bg-yellow-500/10 text-yellow-600 border-yellow-200'),
('pepino', '🥒', 'bg-green-500/10 text-green-600 border-green-200'),
('lechuga', '🥬', 'bg-emerald-500/10 text-emerald-600 border-emerald-200'),
('cebolla', '🧅', 'bg-purple-500/10 text-purple-600 border-purple-200'),
('zanahoria', '🥕', 'bg-orange-500/10 text-orange-600 border-orange-200'),
('patata', '🥔', 'bg-amber-500/10 text-amber-600 border-amber-200'),
('apio', '🌿', 'bg-green-500/10 text-green-600 border-green-200'),
('berenjena', '🍆', 'bg-violet-500/10 text-violet-600 border-violet-200'),
('brócoli', '🥦', 'bg-green-500/10 text-green-600 border-green-200'),
('coliflor', '🥬', 'bg-slate-500/10 text-slate-600 border-slate-200'),
('espinaca', '🥬', 'bg-green-500/10 text-green-600 border-green-200'),
('rábano', '🌰', 'bg-pink-500/10 text-pink-600 border-pink-200'),
('acelga', '🥬', 'bg-green-500/10 text-green-600 border-green-200');

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_product_configs_updated_at
BEFORE UPDATE ON public.product_configs
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();