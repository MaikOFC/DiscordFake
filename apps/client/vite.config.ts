import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    // Os worklets de áudio (RNNoise e sensibilidade) precisam ser arquivos de verdade,
    // não texto embutido no JS, para o AudioWorklet carregar sem depender de data: URL.
    assetsInlineLimit: (file) => (file.endsWith('.js') ? false : undefined),
    rollupOptions: {
      output: {
        manualChunks: {
          livekit: ['livekit-client'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
});
