import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

// Bake the Discord client ID into the packaged main bundle at build time. It is
// NOT a secret (with PKCE no client_secret ships), and it's already visible in
// the OAuth URL — but keeping it out of source means it comes from the
// environment / local .env at build time instead. Set DISCORD_CLIENT_ID when
// building a distributable (e.g. it's picked up from .env below).
try {
  process.loadEnvFile('.env')
} catch {
  // .env is optional; CI/build may set DISCORD_CLIENT_ID directly.
}
const CLIENT_ID = process.env.DISCORD_CLIENT_ID ?? ''

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __DISCORD_CLIENT_ID__: JSON.stringify(CLIENT_ID)
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {}
})
