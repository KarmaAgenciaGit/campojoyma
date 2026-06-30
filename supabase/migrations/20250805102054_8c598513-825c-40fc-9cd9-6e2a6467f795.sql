-- Fix security warnings by setting search_path for functions

-- Recreate generate_api_token function with proper search_path
CREATE OR REPLACE FUNCTION public.generate_api_token()
RETURNS TEXT 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = 'public'
AS $$
BEGIN
  RETURN encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Recreate get_user_from_token function with proper search_path
CREATE OR REPLACE FUNCTION public.get_user_from_token(token_value TEXT)
RETURNS UUID 
LANGUAGE plpgsql 
SECURITY DEFINER 
SET search_path = 'public'
AS $$
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
$$;