import type { RouteObject } from "react-router"

import { SiteLayout } from "@/components/site/site-layout"
import { RouteError } from "@/components/site/states"
import { ForgotPasswordPage, LoginPage, RegisterPage, UpdatePasswordPage } from "@/pages/auth-pages"
import { EntryPage } from "@/pages/entry-page"
import { ExplorePage } from "@/pages/explore-page"
import { HomePage } from "@/pages/home-page"
import { MePage } from "@/pages/me-page"
import { NotFoundPage } from "@/pages/not-found-page"
import { ResourcesPage } from "@/pages/resources-page"
import { TopicPage } from "@/pages/topic-page"
import { TopicsPage } from "@/pages/topics-page"


// Two navigation levels at most: primary nav → content/topic detail routes.
export const routes: RouteObject[] = [
  {
    element: <SiteLayout />,
    errorElement: <RouteError />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "explore", element: <ExplorePage /> },
      { path: "content/:slug", element: <EntryPage /> },
      { path: "topics", element: <TopicsPage /> },
      { path: "topics/:slug", element: <TopicPage /> },
      { path: "resources", element: <ResourcesPage /> },
      { path: "me", element: <MePage /> },
      { path: "login", element: <LoginPage /> },
      { path: "register", element: <RegisterPage /> },
      { path: "forgot-password", element: <ForgotPasswordPage /> },
      { path: "update-password", element: <UpdatePasswordPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
]
