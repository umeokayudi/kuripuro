import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: nome da env na Vercel para o mapa do Kuripuro World (só essa env, além das VITE_*)
// v1.0.204 · React and Supabase go in their own files. They almost never change, so after each new
// version the phone keeps them in cache and only downloads the app's own code again.
const VENDOR = [
  ['vendor-react', /node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//],
  ['vendor-supabase', /node_modules\/@supabase\//],
]
export default defineConfig({
  plugins: [react()],
  envPrefix: ['VITE_', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'],
  build: {
    rollupOptions: {
      output: {
        // v1.0.224 · tiny shared pieces are joined to a neighbour, so a page opens with fewer requests
        experimentalMinChunkSize: 6000,
        manualChunks(id) {
          for (const [name, re] of VENDOR) if (re.test(id)) return name
          return undefined
        },
      },
    },
  },
})
