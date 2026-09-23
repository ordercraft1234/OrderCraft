import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // One `.env` for the whole repository, beside `.env.example`, rather than a second
  // copy in this directory: the API address the web app is built against and the API
  // that serves it are one decision, and two files would let them disagree.
  envDir: '../..',
  // GitHub Pages serves a project site under `/<repo>/`, so the workflow passes
  // `BASE_PATH=/OrderCraft/`; everywhere else (dev, preview, a custom domain) the
  // default `/` applies. Routes are hash-based, so only asset URLs depend on this.
  base: process.env.BASE_PATH ?? '/',
  build: {
    // The comparison screen draws one element per transaction on a 1,500-transaction
    // slot, so the bundle budget that matters is SC-006 (interactive under 2 s on 3G),
    // measured on T044. Warning early keeps that from being discovered at the end.
    chunkSizeWarningLimit: 400,
  },
})
