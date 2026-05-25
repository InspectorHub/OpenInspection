import {
  type RouteConfig,
  index,
  route,
  layout,
} from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("login", "routes/login.tsx"),
  route("logout", "routes/logout.tsx"),
  // Full-screen editor (own chrome, no sidebar)
  route("inspections/:id/edit", "routes/inspection-edit.tsx"),
  layout("routes/auth-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("contacts", "routes/contacts.tsx"),
    route("invoices", "routes/invoices.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("templates", "routes/templates.tsx"),
    layout("routes/settings-layout.tsx", [
      route("settings", "routes/settings-hub.tsx"),
      route("settings/profile", "routes/settings-profile.tsx"),
      route("settings/workspace", "routes/settings-workspace.tsx"),
      route("settings/services", "routes/settings-services.tsx"),
      route("settings/communication", "routes/settings-communication.tsx"),
      route("settings/account", "routes/settings-account.tsx"),
      route("settings/advanced", "routes/settings-advanced.tsx"),
    ]),
    route("comments", "routes/comments.tsx"),
    route("recommendations", "routes/recommendations.tsx"),
    route("library/tags", "routes/library/tags.tsx"),
    route("agreements", "routes/agreements.tsx"),
    route("library/rating-systems", "routes/library/rating-systems.tsx"),
    route("marketplace", "routes/marketplace.tsx"),
  ]),
] satisfies RouteConfig;
