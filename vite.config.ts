import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { allowedHosts: ['tilt-slouchy-badness.ngrok-free.dev'], proxy: {
    // Preserve Host so the backend can enforce the browser's original same-origin request.
    '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false },
    '/socket.io': { target: 'http://127.0.0.1:3000', changeOrigin: false, ws: true },
  } },
});
