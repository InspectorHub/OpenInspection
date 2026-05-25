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
  layout("routes/auth-layout.tsx", [
    route("dashboard", "routes/dashboard.tsx"),
    route("calendar", "routes/calendar.tsx"),
    route("contacts", "routes/contacts.tsx"),
    route("invoices", "routes/invoices.tsx"),
    route("templates", "routes/templates.tsx"),
    route("settings", "routes/settings.tsx"),
    route("comments", "routes/comments.tsx"),
  ]),
] satisfies RouteConfig;
