-- Create function to check if user is banned
CREATE OR REPLACE FUNCTION public.is_banned()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT public.has_role(auth.uid(), 'banned')
$$;