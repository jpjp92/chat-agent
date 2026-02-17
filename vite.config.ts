import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: '0.0.0.0', // Allow external access (useful for mobile testing)
    open: true,      // Automatically open browser on start
    proxy: {
      '/api': {
        target: 'https://chat-gem.vercel.app',
        changeOrigin: true,
        secure: false
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false,

    // Chunk size optimization (minimized for lazy loading)
    rollupOptions: {
      output: {
        manualChunks: {
          // Only separate React core (always needed)
          'react-vendor': ['react', 'react-dom'],
          // Let dynamic imports handle the rest
        }
      }
    },

    // Use esbuild for faster minification (instead of terser)
    minify: 'esbuild',

    // Chunk size warning limit
    chunkSizeWarningLimit: 1000,
  },

  // Dependency optimization
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@supabase/supabase-js',
      'framer-motion'
    ]
  }
});
