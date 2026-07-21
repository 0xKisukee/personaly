import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import { StoreProvider } from "./lib/store";
import { DEFAULT_PATH, ROUTES } from "./routes";
import Sidebar from "./components/Sidebar";
import DashboardPage from "./pages/DashboardPage";
import PatrimoinePage from "./pages/PatrimoinePage";
import FluxPage from "./pages/FluxPage";
import ProjectionPage from "./pages/ProjectionPage";

/** Clé de transition = 1er segment du chemin : les sous-vues de Projection
 *  (`/projection/...`) partagent la même clé → pas de transition de page en
 *  changeant d'onglet, seulement en changeant de page de premier niveau. */
function topSegment(pathname: string): string {
  return "/" + (pathname.split("/")[1] ?? "");
}

function Shell() {
  const location = useLocation();

  // titre du document par route → onglet du navigateur + en-tête d'impression corrects
  useEffect(() => {
    const seg = topSegment(location.pathname);
    const route = ROUTES.find((r) => r.path === seg);
    document.title = route ? `personaly — ${route.label}` : "personaly";
  }, [location.pathname]);

  return (
    <div className="shell">
      <Sidebar />
      <main className="main">
        <AnimatePresence mode="wait">
          <motion.div
            key={topSegment(location.pathname)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            <Routes location={location}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/patrimoine" element={<PatrimoinePage />} />
              <Route path="/flux" element={<FluxPage />} />
              <Route path="/projection" element={<ProjectionPage />} />
              <Route path="/projection/:vue" element={<ProjectionPage />} />
              <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
            </Routes>
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <MotionConfig reducedMotion="user">
        <BrowserRouter>
          <Shell />
        </BrowserRouter>
      </MotionConfig>
    </StoreProvider>
  );
}
