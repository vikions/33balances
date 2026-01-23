import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { polymarketMiddleware } from './src/server/polymarketProxy.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), polymarketApiPlugin()],
})

function polymarketApiPlugin() {
  return {
    name: 'polymarket-api',
    configureServer(server) {
      server.middlewares.use(polymarketMiddleware())
    },
    configurePreviewServer(server) {
      server.middlewares.use(polymarketMiddleware())
    },
  }
}
