import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      '/agroiris-api-cuentaventa': {
        target: 'http://46.24.40.100:7000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-api-cuentaventa/, '/api'),
      },
      '/agroiris-api': {
        target: 'http://46.24.40.100:7000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-api/, '/api'),
      },
      '/agroiris-config': {
        target: 'http://46.24.40.100:7001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-config/, '/api'),
      },
      '/agroiris-login-cuentaventa': {
        target: 'http://46.24.40.100:7001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-login-cuentaventa/, '/api'),
      },
      '/agroiris-login': {
        target: 'http://46.24.40.100:7001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-login/, '/api'),
      },
      '/agroiris-divisa': {
        target: 'http://46.24.40.100:7001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-divisa/, '/api/divisa'),
      },
      '/agroiris-serie': {
        target: 'http://46.24.40.100:7001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/agroiris-serie/, '/api/serie'),
      },
    },
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
