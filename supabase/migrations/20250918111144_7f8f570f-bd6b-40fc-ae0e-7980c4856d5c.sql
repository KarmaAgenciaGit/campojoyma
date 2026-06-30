-- Add missing product configurations for actual products
INSERT INTO public.product_configs (genero, emoji, color_class) VALUES
('calabacín', '🥒', 'bg-green-500/10 text-green-600 border-green-200'),
('fresa', '🍓', 'bg-red-500/10 text-red-600 border-red-200'),
('guanábana', '🥥', 'bg-green-500/10 text-green-600 border-green-200'),
('manzana', '🍎', 'bg-red-500/10 text-red-600 border-red-200'),
('melocotón', '🍑', 'bg-orange-500/10 text-orange-600 border-orange-200'),
('melón', '🍈', 'bg-yellow-500/10 text-yellow-600 border-yellow-200'),
('pera', '🍐', 'bg-green-500/10 text-green-600 border-green-200'),
('plátano', '🍌', 'bg-yellow-500/10 text-yellow-600 border-yellow-200'),
('sandía', '🍉', 'bg-green-500/10 text-green-600 border-green-200'),
('tomate cherry', '🍒', 'bg-red-500/10 text-red-600 border-red-200')
ON CONFLICT (genero) DO NOTHING;

-- Update existing configurations with better emojis and colors
UPDATE public.product_configs SET 
  emoji = '🥬',
  color_class = 'bg-green-500/10 text-green-600 border-green-200'
WHERE genero = 'apio';

UPDATE public.product_configs SET 
  emoji = '🥔',
  color_class = 'bg-amber-500/10 text-amber-600 border-amber-200'
WHERE genero = 'patata';

UPDATE public.product_configs SET 
  emoji = '🥒',
  color_class = 'bg-green-500/10 text-green-600 border-green-200'
WHERE genero = 'pepino';

UPDATE public.product_configs SET 
  emoji = '🍅',
  color_class = 'bg-red-500/10 text-red-600 border-red-200'
WHERE genero = 'tomate';

UPDATE public.product_configs SET 
  emoji = '🥕',
  color_class = 'bg-orange-500/10 text-orange-600 border-orange-200'
WHERE genero = 'zanahoria';