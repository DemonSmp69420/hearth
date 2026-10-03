/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Port 1420 + strictPort are Tauri conventions (tauri.conf.json points devUrl here).
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // cargo writes into src-tauri/target constantly during builds; watching it
    // crashes Vite's FSWatcher with EBUSY on Windows.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.{ts,tsx}'],
    environment: 'node',
  },
});
