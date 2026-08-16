import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Dedicated dev server for the React renderer so it can be previewed in a
 *  browser (the app itself runs inside Electron, see npm run dev). */
export default defineConfig({
  root: 'src/renderer',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1'
  }
})
