-- Corregir políticas RLS para que los usuarios autenticados puedan acceder a todos los datos

-- Invoices policies
DROP POLICY IF EXISTS "All authenticated users can view all invoices" ON public.invoices;
DROP POLICY IF EXISTS "All authenticated users can insert invoices" ON public.invoices;
DROP POLICY IF EXISTS "All authenticated users can update invoices" ON public.invoices;
DROP POLICY IF EXISTS "All authenticated users can delete invoices" ON public.invoices;

CREATE POLICY "All authenticated users can view all invoices" 
ON public.invoices FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert invoices" 
ON public.invoices FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update invoices" 
ON public.invoices FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete invoices" 
ON public.invoices FOR DELETE 
TO authenticated 
USING (true);

-- Work reports policies
DROP POLICY IF EXISTS "All authenticated users can view all work reports" ON public.work_reports;
DROP POLICY IF EXISTS "All authenticated users can insert work reports" ON public.work_reports;
DROP POLICY IF EXISTS "All authenticated users can update work reports" ON public.work_reports;
DROP POLICY IF EXISTS "All authenticated users can delete work reports" ON public.work_reports;

CREATE POLICY "All authenticated users can view all work reports" 
ON public.work_reports FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert work reports" 
ON public.work_reports FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update work reports" 
ON public.work_reports FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete work reports" 
ON public.work_reports FOR DELETE 
TO authenticated 
USING (true);

-- Delivery notes policies
DROP POLICY IF EXISTS "All authenticated users can view all delivery notes" ON public.delivery_notes;
DROP POLICY IF EXISTS "All authenticated users can insert delivery notes" ON public.delivery_notes;
DROP POLICY IF EXISTS "All authenticated users can update delivery notes" ON public.delivery_notes;
DROP POLICY IF EXISTS "All authenticated users can delete delivery notes" ON public.delivery_notes;

CREATE POLICY "All authenticated users can view all delivery notes" 
ON public.delivery_notes FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert delivery notes" 
ON public.delivery_notes FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update delivery notes" 
ON public.delivery_notes FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete delivery notes" 
ON public.delivery_notes FOR DELETE 
TO authenticated 
USING (true);

-- Orders policies
DROP POLICY IF EXISTS "All authenticated users can view all orders" ON public.orders;
DROP POLICY IF EXISTS "All authenticated users can insert orders" ON public.orders;
DROP POLICY IF EXISTS "All authenticated users can update orders" ON public.orders;
DROP POLICY IF EXISTS "All authenticated users can delete orders" ON public.orders;

CREATE POLICY "All authenticated users can view all orders" 
ON public.orders FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert orders" 
ON public.orders FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update orders" 
ON public.orders FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete orders" 
ON public.orders FOR DELETE 
TO authenticated 
USING (true);

-- Order lines policies
DROP POLICY IF EXISTS "All authenticated users can view all order lines" ON public.order_lines;
DROP POLICY IF EXISTS "All authenticated users can insert order lines" ON public.order_lines;
DROP POLICY IF EXISTS "All authenticated users can update order lines" ON public.order_lines;
DROP POLICY IF EXISTS "All authenticated users can delete order lines" ON public.order_lines;

CREATE POLICY "All authenticated users can view all order lines" 
ON public.order_lines FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert order lines" 
ON public.order_lines FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update order lines" 
ON public.order_lines FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete order lines" 
ON public.order_lines FOR DELETE 
TO authenticated 
USING (true);

-- Invoice products policies
DROP POLICY IF EXISTS "All authenticated users can view all invoice products" ON public.invoice_products;
DROP POLICY IF EXISTS "All authenticated users can insert invoice products" ON public.invoice_products;
DROP POLICY IF EXISTS "All authenticated users can update invoice products" ON public.invoice_products;
DROP POLICY IF EXISTS "All authenticated users can delete invoice products" ON public.invoice_products;

CREATE POLICY "All authenticated users can view all invoice products" 
ON public.invoice_products FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert invoice products" 
ON public.invoice_products FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update invoice products" 
ON public.invoice_products FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete invoice products" 
ON public.invoice_products FOR DELETE 
TO authenticated 
USING (true);

-- Semillas policies
DROP POLICY IF EXISTS "All authenticated users can view all semillas" ON public.semillas;
DROP POLICY IF EXISTS "All authenticated users can insert semillas" ON public.semillas;
DROP POLICY IF EXISTS "All authenticated users can update semillas" ON public.semillas;
DROP POLICY IF EXISTS "All authenticated users can delete semillas" ON public.semillas;

CREATE POLICY "All authenticated users can view all semillas" 
ON public.semillas FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert semillas" 
ON public.semillas FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update semillas" 
ON public.semillas FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete semillas" 
ON public.semillas FOR DELETE 
TO authenticated 
USING (true);

-- Previsiones policies
DROP POLICY IF EXISTS "All authenticated users can view previsiones" ON public.previsiones;
DROP POLICY IF EXISTS "All authenticated users can insert previsiones" ON public.previsiones;
DROP POLICY IF EXISTS "All authenticated users can update previsiones" ON public.previsiones;
DROP POLICY IF EXISTS "All authenticated users can delete previsiones" ON public.previsiones;

CREATE POLICY "All authenticated users can view previsiones" 
ON public.previsiones FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert previsiones" 
ON public.previsiones FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update previsiones" 
ON public.previsiones FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete previsiones" 
ON public.previsiones FOR DELETE 
TO authenticated 
USING (true);

-- Agricultores policies
DROP POLICY IF EXISTS "All authenticated users can view agricultores" ON public.agricultores;
DROP POLICY IF EXISTS "All authenticated users can insert agricultores" ON public.agricultores;
DROP POLICY IF EXISTS "All authenticated users can update agricultores" ON public.agricultores;
DROP POLICY IF EXISTS "All authenticated users can delete agricultores" ON public.agricultores;

CREATE POLICY "All authenticated users can view agricultores" 
ON public.agricultores FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert agricultores" 
ON public.agricultores FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update agricultores" 
ON public.agricultores FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete agricultores" 
ON public.agricultores FOR DELETE 
TO authenticated 
USING (true);

-- Daily summaries policies
DROP POLICY IF EXISTS "All authenticated users can view all daily summaries" ON public.daily_summaries;
DROP POLICY IF EXISTS "All authenticated users can insert daily summaries" ON public.daily_summaries;
DROP POLICY IF EXISTS "All authenticated users can update daily summaries" ON public.daily_summaries;
DROP POLICY IF EXISTS "All authenticated users can delete daily summaries" ON public.daily_summaries;

CREATE POLICY "All authenticated users can view all daily summaries" 
ON public.daily_summaries FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can insert daily summaries" 
ON public.daily_summaries FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "All authenticated users can update daily summaries" 
ON public.daily_summaries FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "All authenticated users can delete daily summaries" 
ON public.daily_summaries FOR DELETE 
TO authenticated 
USING (true);