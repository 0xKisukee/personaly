import { Component, type ErrorInfo, type ReactNode } from "react";
import { downloadStateJson } from "../lib/persistence";
import { useStore } from "../lib/useStore";
import type { AppState } from "../lib/types";

/**
 * FILET DE SÉCURITÉ du rendu. Sans lui, une erreur de rendu donne un écran blanc qui
 * se reproduit à chaque rechargement (l'état fautif est relu depuis le localStorage) :
 * l'utilisateur n'a plus AUCUNE issue. Ici, la page de secours offre toujours trois
 * sorties : exporter ses données (intactes), recharger, ou réinitialiser (après export).
 *
 * Seule une CLASSE peut attraper les erreurs de rendu (getDerivedStateFromError) ; le
 * wrapper par défaut, lui, lit l'état via le hook et le passe en props — d'où la
 * position dans `App.tsx` : À L'INTÉRIEUR du StoreProvider.
 */
interface Props {
  state: AppState;
  onReset: () => void;
  children: ReactNode;
}
interface State {
  error: Error | null;
}

class Boundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("personaly : erreur de rendu attrapée par l'ErrorBoundary", error, info.componentStack);
  }

  exportData = () => {
    try {
      downloadStateJson(this.props.state);
    } catch (e) {
      window.alert(`L'export a échoué : ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  reload = () => {
    window.location.reload();
  };

  reset = () => {
    if (
      !window.confirm(
        "Effacer toutes tes données et repartir de zéro ? Exporte-les d'abord si tu veux les garder. Cette action est irréversible."
      )
    )
      return;
    // le store vide le stockage IMMÉDIATEMENT et annule l'écriture différée en attente :
    // le rechargement repart bien d'un état vierge (l'état fautif ne se réécrit pas au pagehide)
    this.props.onReset();
    window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <div className="card crash-card">
          <div className="eyebrow">Erreur d'affichage</div>
          <h1 className="crash-title">Quelque chose s'est cassé</h1>
          <p className="txt-soft crash-text">
            L'écran n'a pas pu s'afficher. Tes données sont intactes dans ce navigateur : exporte-les
            d'abord par sécurité, puis recharge la page. Si le problème revient à chaque rechargement,
            réinitialiser repart de zéro (après export).
          </p>
          <pre className="crash-msg">{error.message || String(error)}</pre>
          <div className="crash-actions">
            <button className="btn btn-brass" onClick={this.exportData}>
              Exporter mes données
            </button>
            <button className="btn" onClick={this.reload}>
              Recharger
            </button>
            <button className="btn btn-danger" onClick={this.reset}>
              Réinitialiser
            </button>
          </div>
        </div>
      </div>
    );
  }
}

/** Enveloppe à poser DANS le StoreProvider : donne à la page de secours l'état à exporter. */
export default function ErrorBoundary({ children }: { children: ReactNode }) {
  const { state, reset } = useStore();
  return (
    <Boundary state={state} onReset={reset}>
      {children}
    </Boundary>
  );
}
