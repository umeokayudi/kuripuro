import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: nome da env na Vercel para o mapa do Kuripuro World (só essa env, além das VITE_*)
export default defineConfig({ plugins: [react()], envPrefix: ['VITE_', 'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY'] })
