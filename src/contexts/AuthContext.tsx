import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSteward: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isSuperAdmin: false,
  isSteward: false,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isSteward, setIsSteward] = useState(false);
  const roleRequestRef = useRef(0);

  const applySession = (session: Session | null) => {
    setSession(session);
    const requestId = ++roleRequestRef.current;

    if (!session?.user) {
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setIsSteward(false);
      return;
    }

    const userId = session.user.id;
    Promise.allSettled([
      supabase.rpc("has_role", { _user_id: userId, _role: "admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "super_admin" }),
      supabase.rpc("has_role", { _user_id: userId, _role: "moderator" }),
    ]).then(([adminRes, superAdminRes, stewardRes]) => {
      if (requestId !== roleRequestRef.current) return;
      setIsAdmin(adminRes.status === "fulfilled" ? !!adminRes.value.data : false);
      setIsSuperAdmin(superAdminRes.status === "fulfilled" ? !!superAdminRes.value.data : false);
      setIsSteward(stewardRes.status === "fulfilled" ? !!stewardRes.value.data : false);
    });
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
    setIsSteward(false);
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isAdmin, isSuperAdmin, isSteward, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
