import { BarChart3, ChevronRight, FileText, LifeBuoy, Settings, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

type AppSidebarProps = {
  isCollapsed: boolean;
  isMobileOpen: boolean;
  onMobileClose: () => void;
};

type NavRoute = {
  path: string;
  label: string;
  Icon: typeof FileText;
};

const facturasRoute: NavRoute = {
  path: "/facturas-recibidas",
  label: "Facturas de compra",
  Icon: FileText,
};

const dashboardRoute: NavRoute = {
  path: "/dashboard",
  label: "Dashboard",
  Icon: BarChart3,
};

const adminRoute: NavRoute = {
  path: "/usuarios",
  label: "Usuarios",
  Icon: Users,
};

const navBaseClass =
  "flex w-full min-w-0 items-center gap-2 rounded-md p-2 text-sm outline-none ring-sidebar-ring transition-all duration-300 focus-visible:ring-2";

const getNavClasses = (active: boolean) => {
  return active
    ? "bg-gradient-to-r from-[#2b75ff] to-[#4895ff] text-white font-semibold border border-transparent shadow-md"
    : "text-muted-foreground hover:bg-blue-50 hover:text-blue-700 hover:scale-[1.02] hover:shadow-sm dark:hover:bg-blue-900/20 dark:hover:text-blue-300";
};

export function AppSidebar({ isCollapsed, isMobileOpen, onMobileClose }: AppSidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const isDashboardActive = currentPath === dashboardRoute.path || currentPath.startsWith(`${dashboardRoute.path}/`);
  const isFacturasActive =
    currentPath === facturasRoute.path || currentPath.startsWith(`${facturasRoute.path}/`);
  const isAdminRouteActive = currentPath === adminRoute.path || currentPath.startsWith(`${adminRoute.path}/`);
  const [isAdminExpanded, setIsAdminExpanded] = useState(isAdminRouteActive);

  useEffect(() => {
    if (isAdminRouteActive) {
      setIsAdminExpanded(true);
    }
  }, [isAdminRouteActive]);

  return (
    <aside
      className={`
        app-sidebar fixed inset-y-0 left-0 z-50 flex h-screen w-72 shrink-0 flex-col overflow-hidden border-r border-border bg-background text-foreground transition-[transform,width] duration-300
        md:sticky md:top-0 md:left-auto md:inset-y-auto md:z-auto
        ${isMobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}
        ${isCollapsed ? "md:w-20" : "md:w-64"}
      `}
    >
      <div className="h-[77px] border-b border-border">
        <div className={`${isCollapsed ? "flex items-center justify-center" : "flex justify-start"} relative h-full`}>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Cerrar menú"
            className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 md:hidden"
          >
            <X className="h-4 w-4" />
          </button>

          <NavLink
            to={dashboardRoute.path}
            aria-label="Ir al módulo principal"
            onClick={onMobileClose}
            className={isCollapsed ? "h-10 w-10" : "flex h-full w-full items-center justify-start pl-3 pr-10"}
          >
            <img
              src={
                isCollapsed
                  ? "/lovable-uploads/agro-logo-comprimido-light.webp"
                  : "/lovable-uploads/agro-logo-light.webp"
              }
              alt="AGRO xFuego"
              className={`${isCollapsed ? "h-10 w-10 object-contain" : "h-full w-auto max-w-[150px] object-contain object-left"} block dark:hidden`}
              loading="lazy"
            />
            <img
              src={
                isCollapsed
                  ? "/lovable-uploads/agro-logo-comprimido-dark.webp"
                  : "/lovable-uploads/agro-logo-dark.webp"
              }
              alt="AGRO xFuego"
              className={`${isCollapsed ? "h-10 w-10 object-contain" : "h-full w-auto max-w-[150px] object-contain object-left"} hidden dark:block`}
              loading="lazy"
            />
          </NavLink>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto px-3 py-4">
        <div className={isCollapsed ? "space-y-3" : "space-y-5"}>
          <section className={isCollapsed ? "space-y-1" : "space-y-2"}>
            {!isCollapsed && (
              <h2 className="px-2 text-xs font-semibold leading-5 text-sidebar-foreground/70">
                Resumen
              </h2>
            )}
            <NavLink
              to={dashboardRoute.path}
              end
              onClick={onMobileClose}
              className={`
                ${navBaseClass}
                ${isCollapsed ? "justify-center" : ""}
                ${getNavClasses(isDashboardActive)}
              `}
            >
              <dashboardRoute.Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="min-w-0 truncate">{dashboardRoute.label}</span>}
            </NavLink>
          </section>

          <section className={isCollapsed ? "space-y-1" : "space-y-2"}>
            {!isCollapsed && (
              <h2 className="px-2 text-xs font-semibold leading-5 text-sidebar-foreground/70">
                Facturas
              </h2>
            )}
            <NavLink
              to={facturasRoute.path}
              end
              onClick={onMobileClose}
              className={`
                sidebar-nav-link
                ${navBaseClass}
                ${isCollapsed ? "justify-center" : ""}
                ${getNavClasses(isFacturasActive)}
              `}
            >
              <facturasRoute.Icon className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span className="min-w-0 truncate">{facturasRoute.label}</span>}
            </NavLink>
          </section>

          <section className={isCollapsed ? "space-y-1" : "space-y-2"}>
            {!isCollapsed && (
              <h2 className="px-2 text-xs font-semibold leading-5 text-sidebar-foreground/70">
                Administración
              </h2>
            )}
            {isCollapsed ? (
              <NavLink
                to={adminRoute.path}
                end
                onClick={onMobileClose}
                className={`
                  ${navBaseClass}
                  justify-center
                  ${getNavClasses(isAdminRouteActive)}
                `}
              >
                <Settings className="h-4 w-4 shrink-0" />
              </NavLink>
            ) : (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setIsAdminExpanded((expanded) => !expanded)}
                  className={`
                    ${navBaseClass}
                    ${getNavClasses(isAdminRouteActive)}
                  `}
                >
                  <Settings className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">Administración</span>
                  <ChevronRight
                    className={`ml-auto h-4 w-4 shrink-0 transition-transform duration-200 ${
                      isAdminExpanded ? "rotate-90" : ""
                    }`}
                  />
                </button>

                {isAdminExpanded && (
                  <div className="ml-4 space-y-1 border-l border-border/70 pl-3">
                    <NavLink
                      to={adminRoute.path}
                      end
                      onClick={onMobileClose}
                      className={`
                        flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-all duration-300
                        ${
                          isAdminRouteActive
                            ? "bg-gradient-to-r from-[#2b75ff] to-[#4895ff] text-white font-semibold border border-transparent shadow"
                            : "text-muted-foreground hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"
                        }
                      `}
                    >
                      <adminRoute.Icon className="h-4 w-4 shrink-0" />
                      <span className="min-w-0 truncate">{adminRoute.label}</span>
                    </NavLink>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mt-auto p-3">
        <div className="hidden lg:block">
          <a
            href="mailto:info@multiplicaxfuego.com"
            className={`flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground transition-all duration-300 hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 ${
              isCollapsed ? "justify-center" : ""
            }`}
          >
            <LifeBuoy className="h-4 w-4" />
            {!isCollapsed && <span>Soporte</span>}
          </a>
        </div>
      </div>
    </aside>
  );
}
