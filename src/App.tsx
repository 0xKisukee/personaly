import { Suspense, lazy, useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from "motion/react";
import { StoreProvider } from "./lib/store";
import { DEFAULT_PATH, ROUTES } from "./routes";
import ErrorBoundary from "./components/ErrorBoundary";
import Sidebar from "./components/Sidebar";

// Pages chargées À LA DEMANDE (un chunk par page) : le bundle initial ne porte que le shell.
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const PatrimoinePage = lazy(() => import("./pages/PatrimoinePage"));
const FluxPage = lazy(() => import("./pages/FluxPage"));
const ProjectionPage = lazy(() => import("./pages/ProjectionPage"));

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
          <m.div
            key={topSegment(location.pathname)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* fallback vide et discret : le chunk d'une page arrive en quelques ms (cache PWA) */}
            <Suspense fallback={null}>
              <Routes location={location}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/patrimoine" element={<PatrimoinePage />} />
                <Route path="/flux" element={<FluxPage />} />
                <Route path="/projection" element={<ProjectionPage />} />
                <Route path="/projection/:vue" element={<ProjectionPage />} />
                <Route path="*" element={<Navigate to={DEFAULT_PATH} replace />} />
              </Routes>
            </Suspense>
          </m.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <MotionConfig reducedMotion="user">
        {/* LazyMotion + `m` (jamais `motion`) : seules les features d'animation DOM sont
            embarquées (pas de drag/layout) — `strict` fait planter tout composant `motion`
            qui aurait échappé à la migration. */}
        <LazyMotion features={domAnimation} strict>
          <BrowserRouter>
            {/* filet de sécurité DANS le StoreProvider : la page de secours peut exporter l'état */}
            <ErrorBoundary>
              <Shell />
            </ErrorBoundary>
          </BrowserRouter>
        </LazyMotion>
      </MotionConfig>
    </StoreProvider>
  );
}
