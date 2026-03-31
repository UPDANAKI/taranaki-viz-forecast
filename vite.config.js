import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    // Injected at build time. Netlify sets COMMIT_REF to the git commit hash.
    // Every new deploy gets a new hash → all cached scores are automatically busted.
    // Falls back to Date.now() for local dev builds.
    __BUILD_TS__: JSON.stringify(process.env.COMMIT_REF || Date.now().toString())
  }
})
