-- Add banned role to the enum type
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'banned';