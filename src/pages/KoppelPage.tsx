import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, XCircle, Loader2, Link } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";

type State = "loading" | "authenticating" | "success" | "error";

const MESSAGES: Record<string, string> = {
  invalid_token:       "De koppellink is ongeldig. Vraag een nieuwe link op via /koppel in Discord.",
  expired:             "De koppellink is verlopen (geldig 30 minuten). Vraag een nieuwe link op via /koppel in Discord.",
  already_used:        "Deze koppellink is al gebruikt.",
  not_authenticated:   "Je moet ingelogd zijn om je account te koppelen.",
};

const KoppelPage = () => {
  const [searchParams]     = useSearchParams();
  const navigate           = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState]  = useState<State>("loading");
  const [message, setMessage] = useState("");

  const token = searchParams.get("token");

  useEffect(() => {
    if (!token) {
      setState("error");
      setMessage("Geen token gevonden in de URL. Gebruik /koppel in Discord om een nieuwe link te ontvangen.");
      return;
    }

    if (authLoading) return;

    if (!user) {
      setState("authenticating");
      return;
    }

    claimToken();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, authLoading, token]);

  async function claimToken() {
    if (!token) return;
    setState("loading");

    const { data, error } = await supabase.rpc("discord_claim_token", { p_token: token });

    if (error || data !== "ok") {
      setState("error");
      setMessage(MESSAGES[data as string] || "Er ging iets mis. Probeer het opnieuw.");
      return;
    }

    setState("success");
    setMessage("Je Discord account is succesvol gekoppeld aan je 3SM profiel!");
    setTimeout(() => navigate("/profile"), 3000);
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <Navbar />
      <main className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 text-center shadow-lg">
          <div className="flex justify-center mb-6">
            {state === "loading" && <Loader2 className="w-14 h-14 text-blue-500 animate-spin" />}
            {state === "authenticating" && <Link className="w-14 h-14 text-orange-400" />}
            {state === "success" && <CheckCircle2 className="w-14 h-14 text-green-500" />}
            {state === "error" && <XCircle className="w-14 h-14 text-red-500" />}
          </div>

          {state === "loading" && (
            <>
              <h1 className="text-xl font-bold mb-2">Account koppelen…</h1>
              <p className="text-muted-foreground text-sm">Even geduld.</p>
            </>
          )}

          {state === "authenticating" && (
            <>
              <h1 className="text-xl font-bold mb-3">Inloggen vereist</h1>
              <p className="text-muted-foreground text-sm mb-6">
                Log eerst in op de site om je Discord account te koppelen.
                Na het inloggen wordt de koppeling automatisch voltooid.
              </p>
              <a
                href={`/auth?redirect=/koppel?token=${token}`}
                className="inline-block px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
              >
                Inloggen
              </a>
            </>
          )}

          {state === "success" && (
            <>
              <h1 className="text-xl font-bold mb-3 text-green-400">Gekoppeld!</h1>
              <p className="text-muted-foreground text-sm">{message}</p>
              <p className="text-muted-foreground text-xs mt-3">Je wordt doorgestuurd naar je profiel…</p>
            </>
          )}

          {state === "error" && (
            <>
              <h1 className="text-xl font-bold mb-3 text-red-400">Koppeling mislukt</h1>
              <p className="text-muted-foreground text-sm mb-6">{message}</p>
              <button
                onClick={() => navigate("/")}
                className="px-5 py-2.5 bg-muted hover:bg-muted/80 text-foreground font-semibold rounded-lg transition-colors"
              >
                Terug naar de site
              </button>
            </>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default KoppelPage;
