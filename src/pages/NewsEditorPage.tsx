import { Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { FileText, ImagePlus, Newspaper, Search, Send } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";

const NewsEditorPage = () => {
  const { user, loading, isAdmin, isSuperAdmin, isEditor } = useAuth();
  const canEditNews = isAdmin || isSuperAdmin || isEditor;

  if (loading) return null;
  if (!user) return <Navigate to="/auth" />;
  if (!canEditNews) return <Navigate to="/profile" replace />;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-16">
        <section className="py-12">
          <div className="container mx-auto px-4 max-w-5xl">
            <div className="flex items-center gap-2 mb-1">
              <Newspaper className="w-5 h-5 text-primary" />
              <span className="text-sm font-medium text-primary uppercase tracking-[0.15em]">Redactie</span>
            </div>
            <h1 className="font-heading text-4xl font-black mb-8">NIEUWS REDACTIE</h1>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card border border-border rounded-lg p-6 racing-stripe-left"
            >
              <h2 className="font-heading font-bold text-xl mb-3 flex items-center gap-2">
                <FileText className="w-5 h-5 text-purple-300" /> Nieuws-editor komt hier
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed mb-6">
                Deze pagina is alleen zichtbaar voor editors, admins en super-admins. Stewards zonder editorrol zien dit menu-item niet.
              </p>

              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <FileText className="w-5 h-5 text-primary mb-3" />
                  <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-1">Concepten</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">Artikelen maken, bewaren en previewen vóór publicatie.</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <ImagePlus className="w-5 h-5 text-primary mb-3" />
                  <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-1">Afbeeldingen</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">Plaatjes uploaden en straks op de juiste plek in de tekst invoegen.</p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/30 p-4">
                  <Search className="w-5 h-5 text-primary mb-3" />
                  <h3 className="font-heading font-bold text-sm uppercase tracking-wider mb-1">SEO</h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">SEO titel, beschrijving, sitemap en social preview per artikel.</p>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
                <Send className="w-4 h-4 text-purple-300" />
                Publish-workflow en rich-text editor worden in de volgende stap aangesloten.
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default NewsEditorPage;
