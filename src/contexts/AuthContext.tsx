import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

interface AuthContextType {
  session: Session | null;
  user: User | null;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSteward: boolean;
  isEditor: boolean;
  loading: boolean;
  rolesLoading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  isAdmin: false,
  isSuperAdmin: false,
  isSteward: false,
  isEditor: false,
  loading: true,
  rolesLoading: true,
  signOut: async () => {},
});

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [isSteward, setIsSteward] = useState(false);
  const [isEditor, setIsEditor] = useState(false);
  const roleRequestRef = useRef(0);

  const applySession = (session: Session | null) => {
    setSession(session);
    const requestId = ++roleRequestRef.current;

    if (!session?.user) {
      setRolesLoading(false);
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setIsSteward(false);
      setIsEditor(false);
      return;
    }

    const userId = session.user.id;
    setRolesLoading(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data, error }) => {
        if (requestId !== roleRequestRef.current) return;

        if (error) {
          console.error("Failed to load user roles", error);
          setIsAdmin(false);
          setIsSuperAdmin(false);
          setIsSteward(false);
          setIsEditor(false);
          setRolesLoading(false);
          return;
        }

        const roles = new Set((data || []).map((row) => row.role));
        setIsAdmin(roles.has("admin"));
        setIsSuperAdmin(roles.has("super_admin"));
        setIsSteward(roles.has("moderator"));
        setIsEditor(roles.has("editor"));
        setRolesLoading(false);
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
    roleRequestRef.current++;
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setIsSteward(false);
    setIsEditor(false);
    setRolesLoading(false);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isAdmin, isSuperAdmin, isSteward, isEditor, loading, rolesLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
