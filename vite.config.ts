import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/login-api': {
        target: 'http://52.64.151.137:8080',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/login-api/, ''),
      },
    },
  },
});
