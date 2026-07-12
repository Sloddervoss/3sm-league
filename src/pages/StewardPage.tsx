import { Navigate } from "react-router-dom";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { useAuth } from "@/contexts/AuthContext";
import { StewardingWorkspace, UserProtestWorkspace } from "@/features/control-room/stewarding";

/**
 * Dedicated steward area. It deliberately stays outside /admin because
 * stewards may resolve protests without receiving admin access.
 */
const StewardPage = () => {
  const { user, loading, rolesLoading, isAdmin, isSuperAdmin, isSteward } = useAuth();
  const canModerate = Boolean(user && (isAdmin || isSuperAdmin || isSteward));

  if (loading || rolesLoading) return <div className="flex min-h-screen items-center justify-center bg-background" role="status"><span className="sr-only">Toegangsrechten laden…</span></div>;
  if (!user) return <Navigate to="/auth" />;

  return <div className="min-h-screen bg-background text-foreground">
    <Navbar />
    <main className="pt-16">
      <div className="mx-auto max-w-7xl space-y-10 px-4 py-8 md:px-6 md:py-10">
        <UserProtestWorkspace />
        {canModerate && <StewardingWorkspace />}
      </div>
    </main>
    <Footer />
  </div>;
};

export default StewardPage;
