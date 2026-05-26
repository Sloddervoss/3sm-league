import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);

    const robotsId = "not-found-robots";
    let robots = document.getElementById(robotsId) as HTMLMetaElement | null;
    if (!robots) {
      robots = document.createElement("meta");
      robots.id = robotsId;
      robots.name = "robots";
      document.head.appendChild(robots);
    }
    robots.content = "noindex, nofollow";

    return () => {
      document.getElementById(robotsId)?.remove();
    };
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted">
      <div className="text-center">
        <h1 className="mb-4 text-4xl font-bold">404</h1>
        <p className="mb-4 text-xl text-muted-foreground">Oeps! Pagina niet gevonden</p>
        <a href="/" className="text-primary underline hover:text-primary/90">
          Terug naar home
        </a>
      </div>
    </div>
  );
};

export default NotFound;
