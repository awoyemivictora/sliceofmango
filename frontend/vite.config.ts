import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tagger from "@dhiwise/component-tagger";
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import nodeResolve from '@rollup/plugin-node-resolve'; 
import path from 'path'; 

export default defineConfig({
  build: {
    outDir: "build",
  },
  plugins: [
    react(),
    tagger(),
    NodeGlobalsPolyfillPlugin({
      process: true,
      buffer: true,
    }),
    nodeResolve({
    }), 
  ],
  define: {
    'global.Buffer': 'globalThis.Buffer',
    'process.env.NODE_DEBUG': 'false',
    'process.env': {}, 
    'global': 'globalThis', 
  },
  resolve: {
    alias: {
      'buffer': 'buffer/',
      '@': path.resolve(__dirname, './src'), 
      '@components': path.resolve(__dirname, './src/components'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@assets': path.resolve(__dirname, './src/assets'),
      '@constants': path.resolve(__dirname, './src/constants'),
      '@styles': path.resolve(__dirname, './src/styles'),
    },
  },
  server: {
    port: 4028, 
    host: "0.0.0.0",
    strictPort: true,
    allowedHosts: ['.amazonaws.com', '.builtwithrocket.new']
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis'
      },
      plugins: [
        NodeGlobalsPolyfillPlugin({
          process: true,
          buffer: true,
        }),
      ]
    }
  }
});