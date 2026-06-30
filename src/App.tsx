import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { StoreProvider } from "./lib/store";
import Sidebar, { type RouteId } from "./components/Sidebar";
import ProfilPage from "./pages/ProfilPage";
import PatrimoinePage from "./pages/PatrimoinePage";
import FluxPage from "./pages/FluxPage";
import SoonPage from "./pages/SoonPage";

function Router() {
  const [route, setRoute] = useState<RouteId>("patrimoine");

  return (
    <div className="shell">
      <Sidebar active={route} onNavigate={setRoute} />
      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {route === "profil" && <ProfilPage />}
            {route === "patrimoine" && <PatrimoinePage />}
            {route === "flux" && <FluxPage />}
            {route === "projection" && (
              <SoonPage
                eyebrow="04 — Projection"
                glyph="↗"
                title="Projection patrimoniale"
                desc="Bientôt : projette ta situation sur plusieurs années à partir de tes actifs, de leur rendement et de l'évolution de leur valeur."
              />
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Router />
    </StoreProvider>
  );
}
