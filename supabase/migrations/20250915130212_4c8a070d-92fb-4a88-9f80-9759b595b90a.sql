-- Fix orders table structure to match the correct format
DROP TABLE IF EXISTS public.order_lines;
DROP TABLE IF EXISTS public.orders;

-- Create orders table
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  fecha_pedido TIMESTAMP WITH TIME ZONE NOT NULL,
  fecha_salida TIMESTAMP WITH TIME ZONE NOT NULL,
  cliente TEXT NOT NULL,
  destino_envio TEXT NOT NULL,
  base64_pedido_pdf TEXT,
  is_processed BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create order lines table
CREATE TABLE public.order_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL,
  genero TEXT NOT NULL,
  presentacion TEXT NOT NULL,
  marca TEXT NOT NULL,
  palets INTEGER NOT NULL,
  bultos_palet INTEGER NOT NULL,
  kilos_bulto NUMERIC NOT NULL,
  piezas_bulto INTEGER NOT NULL,
  precio NUMERIC NOT NULL,
  tipo_precio TEXT NOT NULL,
  bultos INTEGER NOT NULL,
  kilos NUMERIC NOT NULL,
  piezas INTEGER NOT NULL,
  marca_etiqueta TEXT NOT NULL,
  marca_material TEXT NOT NULL
);

-- Add foreign key constraint
ALTER TABLE public.order_lines 
ADD CONSTRAINT order_lines_order_id_fkey 
FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for orders
CREATE POLICY "All authenticated users can view all orders" 
ON public.orders 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert orders" 
ON public.orders 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update orders" 
ON public.orders 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete orders" 
ON public.orders 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create RLS policies for order lines
CREATE POLICY "All authenticated users can view all order lines" 
ON public.order_lines 
FOR SELECT 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can insert order lines" 
ON public.order_lines 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can update order lines" 
ON public.order_lines 
FOR UPDATE 
USING (auth.role() = 'authenticated'::text);

CREATE POLICY "All authenticated users can delete order lines" 
ON public.order_lines 
FOR DELETE 
USING (auth.role() = 'authenticated'::text);

-- Create indexes for performance
CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_orders_fecha_pedido ON public.orders(fecha_pedido);
CREATE INDEX idx_orders_cliente ON public.orders(cliente);
CREATE INDEX idx_order_lines_order_id ON public.order_lines(order_id);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_orders_updated_at
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();