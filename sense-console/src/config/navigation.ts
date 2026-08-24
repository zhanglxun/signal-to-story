import type { LucideIcon } from "lucide-react"
import {
  Building2Icon,
  ClapperboardIcon,
  CircleIcon,
  GaugeIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  ListTodoIcon,
  SettingsIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  WorkflowIcon,
  UsersIcon,
} from "lucide-react"

import navigationSource from "@/config/navigation.json"

export type NavigationItem = {
  id: string
  label: string
  path: string
  icon: string
}

export type NavigationGroup = {
  id: string
  label: string
  icon: string
  items: NavigationItem[]
}

export type NavigationModule = {
  id: string
  label: string
  icon: string
  defaultPath: string
  groups: NavigationGroup[]
}

type AuxiliaryRoute = {
  path: string
  moduleId: string
}

type NavigationConfig = {
  modules: NavigationModule[]
  auxiliaryRoutes: AuxiliaryRoute[]
}

const iconMap: Record<string, LucideIcon> = {
  Building2: Building2Icon,
  Clapperboard: ClapperboardIcon,
  Gauge: GaugeIcon,
  LayoutDashboard: LayoutDashboardIcon,
  Library: LibraryIcon,
  ListTodo: ListTodoIcon,
  Settings: SettingsIcon,
  Settings2: Settings2Icon,
  ShieldCheck: ShieldCheckIcon,
  SlidersHorizontal: SlidersHorizontalIcon,
  Sparkles: SparklesIcon,
  Workflow: WorkflowIcon,
  Users: UsersIcon,
}

export const navigationConfig = navigationSource as NavigationConfig

export function getNavigationIcon(icon: string) {
  return iconMap[icon] ?? CircleIcon
}

function matchesPath(pathname: string, configuredPath: string) {
  return pathname === configuredPath || pathname.startsWith(`${configuredPath}/`)
}

export function resolveNavigation(pathname: string) {
  const matchedEntries = navigationConfig.modules.flatMap((module) =>
    module.groups.flatMap((group) => group.items)
      .filter((item) => matchesPath(pathname, item.path))
      .map((item) => ({ module, item })),
  )
  const matched = matchedEntries.sort((left, right) => right.item.path.length - left.item.path.length)[0]

  if (matched) return { activeModule: matched.module, activeItem: matched.item }

  const auxiliaryRoute = navigationConfig.auxiliaryRoutes.find((route) => matchesPath(pathname, route.path))
  const auxiliaryModule = auxiliaryRoute
    ? navigationConfig.modules.find((module) => module.id === auxiliaryRoute.moduleId)
    : undefined

  return {
    activeModule: auxiliaryModule ?? navigationConfig.modules[0],
    activeItem: undefined,
  }
}
