// Vite for the local test stack: the app talks to the fake database and the local API.
import { defineConfig, mergeConfig } from 'vite'
import base from '../../vite.config.js'
const target = `http://127.0.0.1:${process.env.MOCK_PORT || 5199}`
export default mergeConfig(base, defineConfig({
  define: { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://localhost:5173/_sb'), 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('mock-anon') },
  server: { port: 5173, strictPort: true, proxy: { '/api': target, '/_sb': target, '/_mock': target } },
}))
