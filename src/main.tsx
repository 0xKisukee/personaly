import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
