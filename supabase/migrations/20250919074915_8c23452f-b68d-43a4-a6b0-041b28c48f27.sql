-- Crear políticas restantes para las tablas que no tienen
-- Políticas para invoices
CREATE POLICY "All authenticated users can view all invoices" ON public.invoices
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert invoices" ON public.invoices
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update invoices" ON public.invoices
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete invoices" ON public.invoices
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para invoice_products
CREATE POLICY "All authenticated users can view all invoice products" ON public.invoice_products
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert invoice products" ON public.invoice_products
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update invoice products" ON public.invoice_products
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete invoice products" ON public.invoice_products
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para delivery_notes
CREATE POLICY "All authenticated users can view all delivery notes" ON public.delivery_notes
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert delivery notes" ON public.delivery_notes
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update delivery notes" ON public.delivery_notes
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete delivery notes" ON public.delivery_notes
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para orders
CREATE POLICY "All authenticated users can view all orders" ON public.orders
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert orders" ON public.orders
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update orders" ON public.orders
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete orders" ON public.orders
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para order_lines
CREATE POLICY "All authenticated users can view all order lines" ON public.order_lines
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert order lines" ON public.order_lines
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update order lines" ON public.order_lines
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete order lines" ON public.order_lines
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para semillas
CREATE POLICY "All authenticated users can view all semillas" ON public.semillas
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert semillas" ON public.semillas
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update semillas" ON public.semillas
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete semillas" ON public.semillas
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para work_reports
CREATE POLICY "All authenticated users can view all work reports" ON public.work_reports
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert work reports" ON public.work_reports
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update work reports" ON public.work_reports
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete work reports" ON public.work_reports
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para daily_summaries
CREATE POLICY "All authenticated users can view all daily summaries" ON public.daily_summaries
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert daily summaries" ON public.daily_summaries
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update daily summaries" ON public.daily_summaries
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete daily summaries" ON public.daily_summaries
  FOR DELETE USING (auth.role() = 'authenticated');

-- Políticas para n8n chat histories
CREATE POLICY "Authenticated users can access n8n chat histories" ON public.n8n_chat_histories_previsionesalmia_pruebas
  FOR ALL USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');