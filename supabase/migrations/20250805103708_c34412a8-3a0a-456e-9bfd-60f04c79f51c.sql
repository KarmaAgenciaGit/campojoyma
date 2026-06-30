-- Update the generate_api_token function to use a simpler approach
CREATE OR REPLACE FUNCTION public.generate_api_token()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    characters text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    token_length integer := 16;
    token text := '';
    i integer;
BEGIN
    FOR i IN 1..token_length LOOP
        token := token || substr(characters, floor(random() * length(characters) + 1)::integer, 1);
    END LOOP;
    RETURN token;
END;
$function$;