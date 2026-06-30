-- Add banned role to the enum type
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'banned';

-- Insert the banned user (moises@karma-box.com will need to be signed up first)
-- We'll handle this through the application since we need the auth.users entry

-- Create function to check if user is banned
CREATE OR REPLACE FUNCTION public.is_banned()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'banned')
$$;