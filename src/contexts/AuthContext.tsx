import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isSuperAdmin: false,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);

  const applySession = (session: Session | null) => {
    setSession(session);
    if (session?.user) {
      const headers = {
        "apikey": import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${session.access_token}`,
        "Content-Type": "application/json",
      };
      const base = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/has_role`;
      fetch(base, { method: "POST", headers, body: JSON.stringify({ _user_id: session.user.id, _role: "admin" }) })
        .then((r) => r.json())
        .then((data) => setIsAdmin(!!data))
        .catch(() => setIsAdmin(false));
      fetch(base, { method: "POST", headers, body: JSON.stringify({ _user_id: session.user.id, _role: "super_admin" }) })
        .then((r) => r.json())
        .then((data) => setIsSuperAdmin(!!data))
        .catch(() => setIsSuperAdmin(false));
    } else {
      setIsAdmin(false);
      setIsSuperAdmin(false);
    }
  };

  useEffect(() => {
    // Load initial session immediately so user is available on first render
    supabase.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        applySession(session);
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setIsSuperAdmin(false);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isAdmin, isSuperAdmin, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
