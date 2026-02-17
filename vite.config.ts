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
    target: 'esnext',
    cssCodeSplit: true,
    cssMinify: true,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules')) {
            if (id.includes('framer-motion')) return 'motion-vendor';
            if (id.includes('react')) return 'react-vendor';
            if (id.includes('@supabase')) return 'supabase-vendor';
          }
        }
      }
    },
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
