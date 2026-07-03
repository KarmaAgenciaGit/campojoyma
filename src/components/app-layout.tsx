import { LogOut, PanelLeft, Settings, UserCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { useOnlinePresence } from "@/hooks/useOnlinePresence";

interface AppLayoutProps {
  children: ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, signOut } = useAuth();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  useOnlinePresence(user);

  const handleSignOut = async () => {
    try {
      setIsUserMenuOpen(false);
      await signOut();
      navigate("/auth", { replace: true });
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const handleGoToSettings = () => {
    setIsUserMenuOpen(false);
    navigate("/usuarios");
  };

  useEffect(() => {
    setIsUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!isUserMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!userMenuRef.current) return;
      const target = event.target;
      if (target instanceof Node && !userMenuRef.current.contains(target)) {
        setIsUserMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsUserMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isUserMenuOpen]);

  return (
    <div className="app-shell min-h-screen flex w-full">
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      <AppSidebar
        isCollapsed={isCollapsed}
        isMobileOpen={isMobileMenuOpen}
        onMobileClose={() => setIsMobileMenuOpen(false)}
      />

      <div className="app-content flex-1 flex min-w-0 flex-col bg-muted">
        <header className="app-topbar relative z-40 overflow-visible border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between px-4 py-3 md:px-6 md:py-4">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="sm"
                aria-label={isCollapsed ? "Expandir sidebar" : "Colapsar sidebar"}
                onClick={() => {
                  if (window.innerWidth < 768) {
                    setIsMobileMenuOpen(true);
                    return;
                  }

                  setIsCollapsed((state) => !state);
                }}
                className="min-h-0 rounded-lg px-3 py-2 text-muted-foreground hover:text-foreground"
              >
                <PanelLeft className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <ThemeToggle />

              <div ref={userMenuRef} className="relative z-50">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-expanded={isUserMenuOpen}
                  aria-haspopup="menu"
                  aria-label="Cuenta"
                  onClick={() => setIsUserMenuOpen((open) => !open)}
                  className="min-h-0 rounded-lg px-2 py-2 text-muted-foreground hover:text-foreground"
                >
                  <UserCircle className="h-4 w-4 text-muted-foreground" />
                </Button>

                {isUserMenuOpen && (
                  <div
                    role="menu"
                    aria-label="Menú de usuario"
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-[70] w-56 rounded-xl border border-border bg-background p-1 shadow-xl"
                  >
                    <div className="px-3 py-2">
                      <p className="text-xs font-medium text-muted-foreground">Cuenta</p>
                    </div>
                    <div className="max-w-[220px] truncate px-3 py-2 text-sm text-foreground">
                      {user?.email ?? "Usuario"}
                    </div>
                    <div className="my-1 h-px bg-border" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleGoToSettings}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/70 focus:outline-none"
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Configuración
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="flex w-full items-center rounded-lg px-3 py-2 text-sm text-rose-600 transition-colors hover:bg-muted/70 focus:outline-none"
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Cerrar sesión
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <main className="app-main relative flex-1 min-w-0">
          {children}
        </main>
      </div>
    </div>
  );
}
