import { BotMessageSquare, LogOut, UserCircle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { canAccessPath } from "@/config/accessControl";
import { useOnlinePresence } from "@/hooks/useOnlinePresence";

const IA_EXTERNAL_URL = "https://agents-agroiris.multiplicaxfuego.com";

interface AppLayoutProps {
  children: React.ReactNode;
}

export function AppLayout({ children }: AppLayoutProps) {
  const { user, signOut, role, allowedRoutes } = useAuth();
  const canAccessIa = canAccessPath("/ia", { role, allowedRoutes });
  useOnlinePresence(user);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        
        <div className="flex-1 flex flex-col bg-muted">
          {/* Header */}
          <header className="border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            <div className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <SidebarTrigger />
              </div>
              
              <div className="flex items-center gap-3">
                <ThemeToggle />
                {canAccessIa && (
                  <Button
                    asChild
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <a href={IA_EXTERNAL_URL} aria-label="Abrir Inteligencia Artificial" className="gap-2">
                      <BotMessageSquare className="h-4 w-4" />
                    </a>
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Cuenta"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <UserCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                      Cuenta
                    </DropdownMenuLabel>
                    <DropdownMenuLabel className="max-w-[220px] truncate font-normal text-sm text-foreground">
                      {user?.email ?? "Usuario"}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-rose-600 focus:text-rose-600"
                      onSelect={() => void handleSignOut()}
                    >
                      <LogOut className="mr-2 h-4 w-4" />
                      Cerrar sesión
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1">
            {children}
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
