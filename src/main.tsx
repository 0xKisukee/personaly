import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Polices auto-hébergées (fontsource) — AVANT tokens.css, aucune requête externe :
import '@fontsource-variable/fraunces/opsz.css'         // Fraunces : axes opsz + wght
import '@fontsource-variable/fraunces/opsz-italic.css'  // … et son italique
import '@fontsource-variable/hanken-grotesk'            // Hanken Grotesk : wght 100..900
import '@fontsource/spline-sans-mono/latin-400.css'      // Spline Sans Mono : latin + latin-ext
import '@fontsource/spline-sans-mono/latin-ext-400.css'  // (œ, Œ…) — les autres alphabets sont inutiles ici
import '@fontsource/spline-sans-mono/latin-500.css'
import '@fontsource/spline-sans-mono/latin-ext-500.css'
import '@fontsource/spline-sans-mono/latin-600.css'
import '@fontsource/spline-sans-mono/latin-ext-600.css'
// Design system éclaté — ordre = cascade (ne pas réordonner) :
import './styles/tokens.css'      // variables (couleurs, type, espace, rayons, ombres)
import './styles/base.css'        // reset, body, scrollbars, typographie
import './styles/primitives.css'  // atomes réutilisables (.btn .input .card .tag …)
import './styles/layout.css'      // shell, sidebar, sections, modale, hero
import './styles/charts.css'      // projection, graphes, sankey, monte carlo, misc
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
