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
  isTester: boolean;
  isEnduranceManager: boolean;
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
  isTester: false,
  isEnduranceManager: false,
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
  const [isTester, setIsTester] = useState(false);
  const [isEnduranceManager, setIsEnduranceManager] = useState(false);
  const roleRequestRef = useRef(0);
  const resolvedRoleUserRef = useRef<string | null>(null);

  const applySession = (session: Session | null) => {
    setSession(session);
    const requestId = ++roleRequestRef.current;

    if (!session?.user) {
      resolvedRoleUserRef.current = null;
      setRolesLoading(false);
      setIsAdmin(false);
      setIsSuperAdmin(false);
      setIsSteward(false);
      setIsEditor(false);
      setIsTester(false);
      setIsEnduranceManager(false);
      return;
    }

    const userId = session.user.id;
    const hasResolvedRoles = resolvedRoleUserRef.current === userId;
    if (!hasResolvedRoles) setRolesLoading(true);
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .then(({ data, error }) => {
        if (requestId !== roleRequestRef.current) return;

        if (error) {
          console.error("Failed to load user roles", error);
          if (!hasResolvedRoles) {
            setIsAdmin(false);
            setIsSuperAdmin(false);
            setIsSteward(false);
            setIsEditor(false);
            setIsTester(false);
            setIsEnduranceManager(false);
          }
          setRolesLoading(false);
          return;
        }

        const roles = new Set((data || []).map((row) => row.role));
        setIsAdmin(roles.has("admin"));
        setIsSuperAdmin(roles.has("super_admin"));
        setIsSteward(roles.has("moderator"));
        setIsEditor(roles.has("editor"));
        setIsTester(roles.has("tester"));
        setIsEnduranceManager(roles.has("endurance_manager"));
        resolvedRoleUserRef.current = userId;
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
    resolvedRoleUserRef.current = null;
    setIsAdmin(false);
    setIsSuperAdmin(false);
    setIsSteward(false);
    setIsEditor(false);
    setIsTester(false);
    setIsEnduranceManager(false);
    setRolesLoading(false);
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, isAdmin, isSuperAdmin, isSteward, isEditor, isTester, isEnduranceManager, loading, rolesLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
