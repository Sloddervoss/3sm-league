/**
 * PreviewModal — herbruikbare modal shell voor preview pagina's
 */
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}

const PreviewModal = ({ open, onClose, children, maxWidth = "900px" }: Props) => {
  // Sluit op Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Blokkeer scroll
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50"
            style={{ background: "rgba(4,4,10,0.85)", backdropFilter: "blur(8px)" }}
            onClick={onClose}
          />

          {/* Modal panel */}
          <motion.div
            key="panel"
            initial={{ opacity: 0, y: 60, scale: 0.97 }}
            animate={{ opacity: 1, y: 0,  scale: 1 }}
            exit={{ opacity: 0, y: 40,  scale: 0.97 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed inset-x-0 bottom-0 md:inset-0 md:flex md:items-center md:justify-center z-50 px-0 md:px-4"
            style={{ pointerEvents: "none" }}
          >
            <div
              className="relative w-full overflow-hidden rounded-t-3xl md:rounded-3xl"
              style={{
                maxWidth,
                maxHeight: "90vh",
                overflowY: "auto",
                overscrollBehavior: "contain",
                background: "#0e0e16",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 -4px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.05)",
                pointerEvents: "auto",
              }}
            >
              {/* Sluit knop */}
              <button
                onClick={onClose}
                className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                style={{ background: "rgba(255,255,255,0.07)", color: "#6b7280" }}
                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.12)"; (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.07)"; (e.currentTarget as HTMLButtonElement).style.color = "#6b7280"; }}
              >
                <X className="w-4 h-4" />
              </button>

              {/* Drag handle (mobiel) */}
              <div className="flex justify-center pt-3 pb-1 md:hidden">
                <div className="w-10 h-1 rounded-full bg-white/15" />
              </div>

              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PreviewModal;
