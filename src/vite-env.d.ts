/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_PROJECT_ID: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_AGROIRIS_API_URL: string;
  readonly VITE_AGROIRIS_LOGIN_URL: string;
  readonly VITE_AGROIRIS_CUENTAVENTA_API_URL: string;
  readonly VITE_AGROIRIS_CUENTAVENTA_LOGIN_URL: string;
  readonly VITE_AGROIRIS_LOGIN: string;
  readonly VITE_AGROIRIS_PASSWORD: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
