import type { RouteObject } from "react-router"

import { SiteLayout } from "@/components/site/site-layout"
import { RouteError } from "@/components/site/states"
import { EntryPage } from "@/pages/entry-page"
import { ExplorePage } from "@/pages/explore-page"
import { HomePage } from "@/pages/home-page"
import { NotFoundPage } from "@/pages/not-found-page"


// Two navigation levels at most: primary nav → content/topic detail routes.
export const routes: RouteObject[] = [
  {
    element: <SiteLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "content/:slug", element: <EntryPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]
