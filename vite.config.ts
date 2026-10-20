import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // PWA : installable + HORS-LIGNE. Tout le build (JS, CSS, polices, icônes, index.html) est
    // précaché par le service worker ; `navigateFallback` sert index.html aux routes du
    // BrowserRouter (/projection/evenements…) même sans réseau. Mise à jour silencieuse.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'personaly — patrimoine',
        short_name: 'personaly',
        description: 'Suivi de patrimoine et projection financière, 100 % local.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#0a0d0b',
        theme_color: '#0a0d0b',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // fontsource émet TOUS les sous-ensembles des polices variables ; seuls latin et
        // latin-ext servent en français → les autres ne sont pas précachés (ils restent
        // servables à la demande, le navigateur ne les demande jamais ici).
        globIgnores: ['**/node_modules/**/*', '**/*-vietnamese-*', '**/*-cyrillic*'],
        navigateFallback: '/index.html',
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
      },
      // pas de service worker en dev (HMR intact) — tester avec `npm run build && npm run preview`
      devOptions: { enabled: false },
    }),
  ],
  test: {
    // `.claude/worktrees/` héberge les copies de travail des sessions Claude : leurs tests
    // ne doivent pas être ramassés (sinon chaque suite tourne N fois).
    exclude: [...configDefaults.exclude, '.claude/**', 'dev-dist/**'],
  },
})
