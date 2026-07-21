import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { IconClose } from "./icons";

interface Props {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

export default function Modal({ open, title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);

    // verrouille le scroll de l'arrière-plan tant que la modale est ouverte
    // (compense la largeur de la scrollbar pour éviter un saut de mise en page)
    const { body } = document;
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = body.style.overflow;
    const prevPad = body.style.paddingRight;
    body.style.overflow = "hidden";
    if (scrollbarW > 0) body.style.paddingRight = `${scrollbarW}px`;

    return () => {
      window.removeEventListener("keydown", onKey);
      body.style.overflow = prevOverflow;
      body.style.paddingRight = prevPad;
    };
  }, [open, onClose]);

  // Portail vers <body> : sinon un ancêtre avec `backdrop-filter`/`transform`
  // (ex. la sidebar) devient le bloc conteneur du `position: fixed` et enferme la
  // modale dans son coin au lieu de couvrir tout l'écran.
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="scrim"
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <motion.div
            className="modal"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
              <div>
                <h3>{title}</h3>
                {subtitle && <p className="modal-sub" style={{ marginBottom: 0 }}>{subtitle}</p>}
              </div>
              <button className="icon-btn" onClick={onClose} aria-label="Fermer">
                <IconClose />
              </button>
            </div>
            <div style={{ marginTop: 22 }}>{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
