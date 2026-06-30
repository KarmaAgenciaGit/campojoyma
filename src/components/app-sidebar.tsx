import { useState } from "react"
import { ChevronRight, FileText, LifeBuoy, Settings, Users } from "lucide-react"
import { NavLink, useLocation } from "react-router-dom"
import { useAuth } from "@/hooks/useAuth"
import { canAccessPath } from "@/config/accessControl"

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"

const facturasRoute = { path: "/facturas-recibidas", label: "Facturas recibidas", Icon: FileText }
const adminRoutes = [
  { path: "/usuarios", label: "Usuarios", Icon: Users },
] as const

const getNavClasses = (active: boolean) => {
  return active
    ? "bg-gradient-to-r from-[#2b75ff] to-[#4895ff] text-white font-semibold border border-transparent shadow-md"
    : "hover:bg-blue-50 hover:text-blue-700 text-muted-foreground transition-all duration-300 cursor-pointer dark:hover:bg-blue-900/20 dark:hover:text-blue-300 hover:scale-[1.02] hover:shadow-sm"
}

export function AppSidebar() {
  const { state } = useSidebar()
  const { role, allowedRoutes } = useAuth()
  const location = useLocation()
  const currentPath = location.pathname
  const isCollapsed = state === "collapsed"
  const access = { role, allowedRoutes }

  const hasFacturasAccess = canAccessPath(facturasRoute.path, access)
  const allowedAdminRoutes = adminRoutes.filter((route) => canAccessPath(route.path, access))
  const hasAdminAccess = allowedAdminRoutes.length > 0
  const AdminIcon = allowedAdminRoutes[0]?.Icon ?? Settings
  const isAdminRouteActive = allowedAdminRoutes.some((route) => {
    return currentPath === route.path || currentPath.startsWith(`${route.path}/`)
  })
  const [isAdminExpanded, setIsAdminExpanded] = useState(isAdminRouteActive)
  const logoTarget = facturasRoute.path

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className={isCollapsed ? "p-4 border-b border-border" : "border-b border-border"}>
          <div className={isCollapsed ? "flex items-center gap-3" : "flex justify-center"}>
            <NavLink
              to={logoTarget}
              aria-label="Ir al modulo principal"
              className={isCollapsed ? "h-10 w-10" : "h-28 w-full"}
            >
              <img
                src={isCollapsed ? "/lovable-uploads/agro-logo-comprimido-light.webp" : "/lovable-uploads/agro-logo-light.webp"}
                alt="Agro logo"
                className={`${isCollapsed ? "h-10 w-10 object-contain" : "h-full w-full object-contain"} block dark:hidden`}
                loading="lazy"
              />
              <img
                src={isCollapsed ? "/lovable-uploads/agro-logo-comprimido-dark.webp" : "/lovable-uploads/agro-logo-dark.webp"}
                alt="Agro logo modo oscuro"
                className={`${isCollapsed ? "h-10 w-10 object-contain" : "h-full w-full object-contain"} hidden dark:block`}
                loading="lazy"
              />
            </NavLink>
          </div>
        </div>

        {hasFacturasAccess && (
          <SidebarGroup>
            <SidebarGroupLabel>Facturas</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <NavLink
                    to={facturasRoute.path}
                    end
                    className={({ isActive }) => `
                      flex w-full items-center gap-2 rounded-md p-2 text-sm outline-none ring-sidebar-ring transition-all duration-300 focus-visible:ring-2
                      ${isCollapsed ? "justify-center" : ""}
                      ${getNavClasses(isActive)}
                      ${!isActive ? "hover:bg-blue-50 hover:text-blue-700 hover:scale-[1.02] hover:shadow-sm dark:hover:bg-blue-900/20 dark:hover:text-blue-300" : ""}
                    `}
                  >
                    <facturasRoute.Icon className="h-4 w-4" />
                    {!isCollapsed && <span>{facturasRoute.label}</span>}
                  </NavLink>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {hasAdminAccess && (
          <SidebarGroup>
            <SidebarGroupLabel>Administracion</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  {isCollapsed ? (
                    <NavLink
                      to={allowedAdminRoutes[0].path}
                      end
                      className={({ isActive }) => `
                        flex w-full items-center gap-2 rounded-md p-2 text-sm outline-none ring-sidebar-ring transition-all duration-300 focus-visible:ring-2
                        justify-center
                        ${getNavClasses(isActive)}
                        ${!isActive ? "hover:bg-blue-50 hover:text-blue-700 hover:scale-[1.02] hover:shadow-sm dark:hover:bg-blue-900/20 dark:hover:text-blue-300" : ""}
                      `}
                    >
                      <AdminIcon className="h-4 w-4" />
                    </NavLink>
                  ) : (
                    <>
                      <SidebarMenuButton
                        onClick={() => setIsAdminExpanded(!isAdminExpanded)}
                        className={`
                          w-full transition-all duration-300 focus-visible:ring-2
                          ${getNavClasses(isAdminRouteActive)}
                          ${!isAdminRouteActive ? "hover:bg-blue-50 hover:text-blue-700 hover:scale-[1.02] hover:shadow-sm dark:hover:bg-blue-900/20 dark:hover:text-blue-300" : ""}
                        `}
                      >
                        <div className="flex w-full items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Settings className="h-4 w-4" />
                            <span>Administracion</span>
                          </div>
                          <ChevronRight
                            className={`h-4 w-4 transition-transform duration-200 ${isAdminExpanded ? "rotate-90" : ""}`}
                          />
                        </div>
                      </SidebarMenuButton>

                      {isAdminExpanded && (
                        <SidebarMenuSub>
                          {allowedAdminRoutes.map((route) => (
                            <SidebarMenuSubItem key={route.path}>
                              <NavLink
                                to={route.path}
                                end
                                className={({ isActive }) => `
                                  flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-all duration-300
                                  ${isActive
                                    ? "bg-gradient-to-r from-[#2b75ff] to-[#4895ff] text-white font-semibold border border-transparent shadow"
                                    : "text-muted-foreground hover:bg-blue-50 hover:text-blue-700 dark:hover:bg-blue-900/20 dark:hover:text-blue-300"}
                                `}
                              >
                                <route.Icon className="h-4 w-4" />
                                <span>{route.label}</span>
                              </NavLink>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      )}
                    </>
                  )}
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <div className="mt-auto p-3 space-y-2">
        <div className="hidden lg:block">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild>
                <a
                  href="mailto:info@multiplicaxfuego.com"
                  className={`flex w-full items-center gap-2 rounded-md p-2 text-sm text-muted-foreground hover:text-blue-700 hover:bg-blue-50 transition-all duration-300 dark:hover:bg-blue-900/20 dark:hover:text-blue-300 ${isCollapsed ? "justify-center" : ""}`}
                >
                  <LifeBuoy className="h-4 w-4" />
                  {!isCollapsed && <span>Soporte</span>}
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </div>
    </Sidebar>
  )
}
