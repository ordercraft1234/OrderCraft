import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  build: {
    // The comparison screen draws one element per transaction on a 1,500-transaction
    // slot, so the bundle budget that matters is SC-006 (interactive under 2 s on 3G),
    // measured on T044. Warning early keeps that from being discovered at the end.
    chunkSizeWarningLimit: 400,
  },
})
