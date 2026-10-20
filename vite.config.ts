/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // PBS-67: isolate heavyweight vendors. Entry must stay under the
        // 600 kB warning; PDF pipelines stay separate and lazy (no unification).
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          recharts: ['recharts'],
          pdfmake: ['pdfmake/build/pdfmake', 'pdfmake/build/vfs_fonts'],
          jspdf: ['jspdf', 'html2canvas'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
    include: ['react', 'react-dom', 'react-router-dom', '@supabase/supabase-js', 'zod', 'tanstack-query'],
  },
  server: {
    watch: {
      ignored: ['**/node_modules', '**/.git'],
    },
  },
});
