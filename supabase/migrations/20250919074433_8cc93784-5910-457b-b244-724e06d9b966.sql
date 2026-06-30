-- Crear el enum para roles de aplicación
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

-- Crear tabla de perfiles de usuario
CREATE TABLE public.profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL UNIQUE,
  email text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de roles de usuario
CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  role app_role NOT NULL DEFAULT 'user'::app_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de módulos
CREATE TABLE public.modules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  display_name text NOT NULL,
  description text,
  icon text,
  path text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de agricultores
CREATE TABLE public.agricultores (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agricultor_id text NOT NULL,
  nombre text NOT NULL,
  telefono text NOT NULL,
  localizacion text,
  productos text[] NOT NULL DEFAULT '{}',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de configuración de productos
CREATE TABLE public.product_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  genero text NOT NULL,
  emoji text NOT NULL,
  color_class text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de previsiones
CREATE TABLE public.previsiones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  agricultor_id text NOT NULL,
  genero text NOT NULL,
  fechaentrega date NOT NULL,
  cantidad numeric NOT NULL,
  cantidad_traida numeric,
  fecha_revision timestamp with time zone,
  estado text NOT NULL DEFAULT 'pendiente',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de proyectos
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de tokens de API
CREATE TABLE public.api_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  name text NOT NULL,
  token text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  last_used_at timestamp with time zone
);

-- Crear tabla de configuraciones de webhooks
CREATE TABLE public.webhook_configs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  type text NOT NULL,
  webhook_url text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de facturas
CREATE TABLE public.invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  issuer_company_name text NOT NULL,
  issuer_email text NOT NULL,
  issuer_phone text,
  issuer_cif text NOT NULL,
  receiver_company_name text NOT NULL,
  receiver_cif text NOT NULL,
  budget_number text,
  date date NOT NULL,
  tax_base numeric NOT NULL,
  vat numeric NOT NULL,
  total_amount numeric NOT NULL,
  image_base64 text,
  file_data text,
  file_type text DEFAULT 'pdf',
  file_size integer,
  is_processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de productos de factura
CREATE TABLE public.invoice_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id uuid NOT NULL,
  product_name text NOT NULL,
  quantity integer NOT NULL,
  unit_price numeric NOT NULL,
  total_price numeric NOT NULL
);

-- Crear tabla de albaranes de entrega
CREATE TABLE public.delivery_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  issuer_company_name text NOT NULL,
  issuer_email text NOT NULL,
  issuer_phone text,
  issuer_cif text NOT NULL,
  receiver_company_name text NOT NULL,
  receiver_cif text NOT NULL,
  reference_number text,
  description text,
  date date NOT NULL,
  is_processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de pedidos
CREATE TABLE public.orders (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  cliente text NOT NULL,
  destino_envio text NOT NULL,
  fecha_pedido timestamp with time zone NOT NULL,
  fecha_salida timestamp with time zone NOT NULL,
  base64_pedido_pdf text,
  is_processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de líneas de pedido
CREATE TABLE public.order_lines (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid NOT NULL,
  genero text NOT NULL,
  marca text NOT NULL,
  presentacion text NOT NULL,
  marca_material text NOT NULL,
  marca_etiqueta text NOT NULL,
  palets integer NOT NULL,
  bultos_palet integer NOT NULL,
  kilos_bulto numeric NOT NULL,
  piezas_bulto integer NOT NULL,
  precio numeric NOT NULL,
  tipo_precio text NOT NULL,
  bultos integer NOT NULL,
  kilos numeric NOT NULL,
  piezas integer NOT NULL
);

-- Crear tabla de semillas
CREATE TABLE public.semillas (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  fabricante text NOT NULL,
  variedad text NOT NULL,
  tipo_semilla text NOT NULL,
  cantidad_semillas text NOT NULL,
  numero_producto text NOT NULL,
  numero_lote text NOT NULL,
  especie text NOT NULL,
  color_cultivo text,
  origen text,
  tratamiento text,
  germinacion_minima text,
  pureza text,
  categoria text,
  codigo_apc text,
  fecha_envasado date,
  test_fecha date,
  base64_frontal_bolsa text,
  base64_trasero_bolsa text,
  is_processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de reportes de trabajo
CREATE TABLE public.work_reports (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text NOT NULL,
  description text,
  performed_by text NOT NULL,
  date date NOT NULL,
  duration integer NOT NULL,
  project_id uuid,
  audio_base64 text,
  is_processed boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de resúmenes diarios
CREATE TABLE public.daily_summaries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  title text,
  date date NOT NULL,
  audio_base64 text NOT NULL,
  duration integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Crear tabla de historial de chat n8n
CREATE TABLE public.n8n_chat_histories_previsionesalmia_pruebas (
  id integer NOT NULL GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  session_id character varying NOT NULL,
  message jsonb NOT NULL
);