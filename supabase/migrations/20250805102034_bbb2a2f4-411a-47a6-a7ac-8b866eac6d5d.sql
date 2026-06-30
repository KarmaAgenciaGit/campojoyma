-- Create API tokens table
CREATE TABLE public.api_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  token TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  last_used_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- Enable RLS on api_tokens
ALTER TABLE public.api_tokens ENABLE ROW LEVEL SECURITY;

-- Users can manage their own tokens
CREATE POLICY "Users can manage their own tokens" 
ON public.api_tokens 
FOR ALL 
USING (auth.uid() = user_id);

-- Update RLS policies to allow all users to see all data

-- Drop existing restrictive policies
DROP POLICY IF EXISTS "Users can manage their own invoices" ON public.invoices;
DROP POLICY IF EXISTS "Users can manage their own delivery notes" ON public.delivery_notes;
DROP POLICY IF EXISTS "Users can manage their own work reports" ON public.work_reports;
DROP POLICY IF EXISTS "Users can manage products of their own invoices" ON public.invoice_products;

-- Create new permissive policies for invoices
CREATE POLICY "All authenticated users can view all invoices" 
ON public.invoices 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert invoices" 
ON public.invoices 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update invoices" 
ON public.invoices 
FOR UPDATE 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete invoices" 
ON public.invoices 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- Create new permissive policies for delivery notes
CREATE POLICY "All authenticated users can view all delivery notes" 
ON public.delivery_notes 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert delivery notes" 
ON public.delivery_notes 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update delivery notes" 
ON public.delivery_notes 
FOR UPDATE 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete delivery notes" 
ON public.delivery_notes 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- Create new permissive policies for work reports
CREATE POLICY "All authenticated users can view all work reports" 
ON public.work_reports 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert work reports" 
ON public.work_reports 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update work reports" 
ON public.work_reports 
FOR UPDATE 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete work reports" 
ON public.work_reports 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- Create new permissive policies for invoice products
CREATE POLICY "All authenticated users can view all invoice products" 
ON public.invoice_products 
FOR SELECT 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can insert invoice products" 
ON public.invoice_products 
FOR INSERT 
WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can update invoice products" 
ON public.invoice_products 
FOR UPDATE 
USING (auth.role() = 'authenticated');

CREATE POLICY "All authenticated users can delete invoice products" 
ON public.invoice_products 
FOR DELETE 
USING (auth.role() = 'authenticated');

-- Function to generate random tokens
CREATE OR REPLACE FUNCTION public.generate_api_token()
RETURNS TEXT AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get user_id from token
CREATE OR REPLACE FUNCTION public.get_user_from_token(token_value TEXT)
RETURNS UUID AS $$
DECLARE
  user_uuid UUID;
BEGIN
  SELECT user_id INTO user_uuid 
  FROM public.api_tokens 
  WHERE token = token_value AND is_active = true;
  
  -- Update last_used_at
  IF user_uuid IS NOT NULL THEN
    UPDATE public.api_tokens 
    SET last_used_at = now() 
    WHERE token = token_value;
  END IF;
  
  RETURN user_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;