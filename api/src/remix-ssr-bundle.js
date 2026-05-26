import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { ServerRouter, UNSAFE_withComponentProps, Outlet, UNSAFE_withErrorBoundaryProps, isRouteErrorResponse, Meta, Links, ScrollRestoration, Scripts, createCookieSessionStorage, redirect, useActionData, Form, useBlocker, useLoaderData, useFetcher, useNavigate, Link, useRouteLoaderData, NavLink, useSearchParams } from "react-router";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import "hono/client";
import React, { useState, useRef, useEffect, useMemo, useCallback } from "react";
const streamTimeout = 5e3;
async function handleRequest(request, responseStatusCode, responseHeaders, routerContext, _loadContext) {
  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, {
      status: responseStatusCode,
      headers: responseHeaders
    });
  }
  const userAgent = request.headers.get("user-agent");
  const body = await renderToReadableStream(
    /* @__PURE__ */ jsx(ServerRouter, { context: routerContext, url: request.url }),
    {
      signal: AbortSignal.timeout(streamTimeout),
      onError(error) {
        console.error(error);
        responseStatusCode = 500;
      }
    }
  );
  if (userAgent && isbot(userAgent)) {
    await body.allReady;
  }
  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode
  });
}
const entryServer = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: handleRequest,
  streamTimeout
}, Symbol.toStringTag, { value: "Module" }));
function meta$Z({}) {
  return [{
    title: "OpenInspection"
  }, {
    name: "description",
    content: "Property inspection management"
  }];
}
const links = () => [{
  rel: "icon",
  href: "/favicon.svg",
  type: "image/svg+xml"
}];
const FOUC_SCRIPT = `(function(){
var d=document.documentElement;
if(d.hasAttribute('data-theme')){d.setAttribute('data-color-scheme','light');return;}
try{var L=localStorage.getItem('ih-color-scheme');
if(L&&!localStorage.getItem('oi-color-scheme'))localStorage.setItem('oi-color-scheme',L);
if(L)localStorage.removeItem('ih-color-scheme');}catch(e){}
var s=localStorage.getItem('oi-color-scheme');
var p=window.matchMedia('(prefers-color-scheme: dark)').matches;
var scheme=s==='dark'||(s===null&&p)?'dark':'light';
d.setAttribute('data-color-scheme',scheme);
if(scheme==='dark')d.classList.add('dark');
})();
(function(){try{if(localStorage.getItem('oi-sidebar-collapsed')==='1')document.documentElement.setAttribute('data-sidebar-collapsed','1');}catch(e){}})();`;
function Layout({
  children
}) {
  return /* @__PURE__ */ jsxs("html", {
    lang: "en",
    className: "scroll-smooth",
    suppressHydrationWarning: true,
    children: [/* @__PURE__ */ jsxs("head", {
      children: [/* @__PURE__ */ jsx("meta", {
        charSet: "UTF-8"
      }), /* @__PURE__ */ jsx("meta", {
        name: "viewport",
        content: "width=device-width, initial-scale=1.0"
      }), /* @__PURE__ */ jsx("script", {
        dangerouslySetInnerHTML: {
          __html: FOUC_SCRIPT
        }
      }), /* @__PURE__ */ jsx(Meta, {}), /* @__PURE__ */ jsx(Links, {})]
    }), /* @__PURE__ */ jsxs("body", {
      className: "bg-ih-bg-app text-ih-fg-1 antialiased min-h-screen",
      suppressHydrationWarning: true,
      children: [children, /* @__PURE__ */ jsx(ScrollRestoration, {}), /* @__PURE__ */ jsx(Scripts, {})]
    })]
  });
}
const root = UNSAFE_withComponentProps(function Root() {
  return /* @__PURE__ */ jsx(Outlet, {});
});
const ErrorBoundary = UNSAFE_withErrorBoundaryProps(function ErrorBoundary2({
  error
}) {
  if (isRouteErrorResponse(error)) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-4xl font-bold",
          children: error.status
        }), /* @__PURE__ */ jsx("p", {
          className: "text-ih-fg-3 mt-2",
          children: error.statusText
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center",
    children: /* @__PURE__ */ jsxs("div", {
      className: "text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-4xl font-bold",
        children: "Error"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: "Something went wrong"
      })]
    })
  });
});
const route0 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  ErrorBoundary,
  Layout,
  default: root,
  links,
  meta: meta$Z
}, Symbol.toStringTag, { value: "Module" }));
const SESSION_SECRET = "standalone-demo-session-secret-change-me";
const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__session",
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
    secrets: [SESSION_SECRET]
  }
});
async function getSession(request) {
  return sessionStorage.getSession(request.headers.get("Cookie"));
}
async function getToken(request) {
  const session = await getSession(request);
  return session.get("token") || null;
}
async function requireToken(request) {
  const token = await getToken(request);
  if (!token) throw redirect("/login");
  return token;
}
async function createSessionWithToken(token, redirectTo) {
  const session = await sessionStorage.getSession();
  session.set("token", token);
  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await sessionStorage.commitSession(session)
    }
  });
}
async function destroyUserSession(request) {
  const session = await getSession(request);
  return redirect("/login", {
    headers: {
      "Set-Cookie": await sessionStorage.destroySession(session)
    }
  });
}
const session_server = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createSessionWithToken,
  destroyUserSession,
  getSession,
  getToken,
  requireToken
}, Symbol.toStringTag, { value: "Module" }));
async function loader$12({
  request
}) {
  const token = await getToken(request);
  if (token) throw redirect("/dashboard");
  throw redirect("/login");
}
const home = UNSAFE_withComponentProps(function Home() {
  return null;
});
const route1 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: home,
  loader: loader$12
}, Symbol.toStringTag, { value: "Module" }));
const API_URL_DEFAULT = "https://openinspection-standalone.important-new.workers.dev";
function getApiUrl() {
  var _a;
  try {
    if (typeof process !== "undefined" && ((_a = process == null ? void 0 : process.env) == null ? void 0 : _a.API_URL)) {
      return process.env.API_URL;
    }
  } catch {
  }
  return API_URL_DEFAULT;
}
async function apiFetch(path, init) {
  const url = `${getApiUrl()}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(init == null ? void 0 : init.token) ? { Authorization: `Bearer ${init.token}` } : {}
  };
  if (init == null ? void 0 : init.csrf) {
    const csrfToken = crypto.randomUUID().replace(/-/g, "");
    headers["x-csrf-token"] = csrfToken;
    const cookieHeader = `__Host-csrf_token=${csrfToken}`;
    headers["Cookie"] = (init == null ? void 0 : init.headers) ? `${init.headers["Cookie"] || ""}; ${cookieHeader}` : cookieHeader;
  }
  const { token: _token, csrf: _csrf, ...rest } = init ?? {};
  const finalHeaders = { ...headers, ...rest.headers };
  const apiWorker = globalThis.__API_WORKER;
  if (apiWorker) {
    return apiWorker.fetch(new Request(url, { ...rest, headers: finalHeaders }));
  }
  return fetch(url, { ...rest, headers: finalHeaders });
}
function meta$Y() {
  return [{
    title: "Sign In - OpenInspection"
  }];
}
async function loader$11({
  request
}) {
  const token = await getToken(request);
  if (token) return redirect("/dashboard");
  return null;
}
async function action$p({
  request
}) {
  var _a, _b, _c;
  const formData = await request.formData();
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  try {
    const res = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email,
        password
      }),
      csrf: true,
      headers: {
        "x-token-relay": "1"
      }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[login] API error:", res.status, res.statusText, text.slice(0, 500));
      let parsed = {};
      try {
        parsed = JSON.parse(text);
      } catch {
      }
      return {
        error: ((_a = parsed == null ? void 0 : parsed.error) == null ? void 0 : _a.message) ?? `Login failed (${res.status})`
      };
    }
    const body = await res.json().catch(() => ({}));
    const jwt = (_b = body == null ? void 0 : body.data) == null ? void 0 : _b.token;
    if (jwt) {
      return createSessionWithToken(jwt, "/dashboard");
    }
    if ((_c = body == null ? void 0 : body.data) == null ? void 0 : _c.requires2fa) {
      return {
        error: "2FA is not yet supported in the new frontend."
      };
    }
    return {
      error: "Authentication succeeded but no token received"
    };
  } catch {
    return {
      error: "Network error — is the API server running?"
    };
  }
}
const login = UNSAFE_withComponentProps(function LoginPage() {
  const actionData = useActionData();
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "w-full max-w-md p-8",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-8",
        children: [/* @__PURE__ */ jsx("img", {
          src: "/logo.svg",
          alt: "",
          className: "w-8 h-8"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-lg font-bold text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1 mb-2",
        children: "Sign in to your workspace"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-sm text-ih-fg-3 mb-6",
        children: "Enter your credentials to access inspections, reports, and team tools."
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Email address"
          }), /* @__PURE__ */ jsx("input", {
            name: "email",
            type: "email",
            required: true,
            autoFocus: true,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Password"
          }), /* @__PURE__ */ jsx("input", {
            name: "password",
            type: "password",
            required: true,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg",
          children: actionData.error
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors",
          children: "Sign In"
        })]
      })]
    })
  });
});
const route2 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$p,
  default: login,
  loader: loader$11,
  meta: meta$Y
}, Symbol.toStringTag, { value: "Module" }));
async function loader$10({
  request
}) {
  return destroyUserSession(request);
}
const route3 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  loader: loader$10
}, Symbol.toStringTag, { value: "Module" }));
const FALLBACK_DESCRIPTIONS = {
  S: "Item is functioning as intended; no concerns observed.",
  Sat: "Item is functioning as intended; no concerns observed.",
  Satisfactory: "Item is functioning as intended; no concerns observed.",
  M: "Item is functional but shows wear; recommend periodic re-inspection.",
  Mon: "Item is functional but shows wear; recommend periodic re-inspection.",
  Monitor: "Item is functional but shows wear; recommend periodic re-inspection.",
  D: "Item is broken, deteriorated, or unsafe; recommend repair or replacement.",
  Defect: "Item is broken, deteriorated, or unsafe; recommend repair or replacement.",
  Defective: "Item is not functioning as intended; repair or replacement is recommended.",
  NI: "Item could not be inspected (inaccessible, unsafe, or excluded).",
  "Not Inspected": "Item could not be inspected (inaccessible, unsafe, or excluded).",
  NP: "Item is not present at this property.",
  "Not Present": "Item is not present at this property.",
  I: "Item was inspected and meets the Standards of Practice.",
  Inspected: "Item was inspected and meets the Standards of Practice.",
  F: "Item visually inspected and observed to be in serviceable, functional condition.",
  Functional: "Item visually inspected and observed to be in serviceable, functional condition.",
  H: "Item presents an immediate safety hazard and should be addressed without delay.",
  Hazardous: "Item presents an immediate safety hazard and should be addressed without delay."
};
function backfillLevelDescriptions(levels) {
  return levels.map((lvl) => {
    if (lvl.description) return lvl;
    const fb = FALLBACK_DESCRIPTIONS[lvl.id] || FALLBACK_DESCRIPTIONS[lvl.abbreviation ?? ""] || FALLBACK_DESCRIPTIONS[lvl.label] || "";
    return fb ? { ...lvl, description: fb } : lvl;
  });
}
function fKey(sectionId, itemId) {
  return `_default:${sectionId}:${itemId}`;
}
function useInspectionState(opts) {
  const [inspection, setInspection] = useState(
    opts.inspection
  );
  const [schema] = useState(opts.schema);
  const sections = schema.sections || [];
  const [ratingLevels, setRatingLevels] = useState(
    () => backfillLevelDescriptions(opts.ratingLevels || [])
  );
  const [results, setResults] = useState(() => {
    const r = { ...opts.results || {} };
    for (const sec of sections) {
      for (const item of sec.items || []) {
        const ck = fKey(sec.id, item.id);
        if (!r[ck]) r[ck] = { rating: null, notes: "", photos: [] };
        if (!r[item.id]) r[item.id] = r[ck];
      }
    }
    return r;
  });
  const [currentSectionIdx, setCurrentSectionIdx] = useState(0);
  const [activeItemId, setActiveItemId] = useState(null);
  const [activeView, setActiveView] = useState("items");
  const [viewMode, setViewMode] = useState("split");
  const [itemFilter, setItemFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveStatus, setSaveStatus] = useState("idle");
  const [dirty, setDirty] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [batchSelected, setBatchSelected] = useState(
    {}
  );
  const lastBatchClickedRef = useRef(null);
  const [speedMode, setSpeedMode] = useState(false);
  const [speedQueue, setSpeedQueue] = useState([]);
  const [speedCurrent, setSpeedCurrent] = useState(0);
  const speedItemsRef = useRef([]);
  const [showCommentLibrary, setShowCommentLibrary] = useState(false);
  const [commentLibraryFilter, setCommentLibraryFilter] = useState("all");
  const [commentLibrarySearch, setCommentLibrarySearch] = useState("");
  const [commentLibrarySelectedIdx, setCommentLibrarySelectedIdx] = useState(0);
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const [burstCameraOpen, setBurstCameraOpen] = useState(false);
  const [burstCameraItemId, setBurstCameraItemId] = useState(
    null
  );
  const [sectionPickerOpen, setSectionPickerOpen] = useState(false);
  const [sectionPickerQuery, setSectionPickerQuery] = useState("");
  const [sectionPickerIdx, setSectionPickerIdx] = useState(0);
  const [tagsByItem, setTagsByItem] = useState({});
  const [publishedVersion, setPublishedVersion] = useState(0);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 1024 : true
  );
  useEffect(() => {
    function onResize() {
      setIsDesktop(window.innerWidth >= 1024);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const currentSection = sections[currentSectionIdx] || null;
  const currentSectionItems = (currentSection == null ? void 0 : currentSection.items) || [];
  const activeItem = useMemo(() => {
    if (!activeItemId) return null;
    return currentSectionItems.find((i) => i.id === activeItemId) || null;
  }, [activeItemId, currentSectionItems]);
  const sectionIdForItem = useCallback(
    (itemId) => {
      for (const sec of sections) {
        if ((sec.items || []).some((it) => it.id === itemId)) return sec.id;
      }
      return null;
    },
    [sections]
  );
  const fk = useCallback(
    (itemId) => {
      const sid = sectionIdForItem(itemId);
      return sid ? fKey(sid, itemId) : itemId;
    },
    [sectionIdForItem]
  );
  const getResult = useCallback(
    (itemId, sectionId) => {
      const sid = sectionId || sectionIdForItem(itemId);
      if (sid) {
        const ck = fKey(sid, itemId);
        if (results[ck]) return results[ck];
      }
      return results[itemId] || {};
    },
    [results, sectionIdForItem]
  );
  const findItemById = useCallback(
    (itemId) => {
      for (const sec of sections) {
        const found = (sec.items || []).find((it) => it.id === itemId);
        if (found) return found;
      }
      return null;
    },
    [sections]
  );
  const bucketForRatingId = useCallback(
    (ratingId) => {
      if (!ratingId) return "all";
      for (const lvl of ratingLevels) {
        if (lvl.id !== ratingId) continue;
        const nm = (lvl.name || lvl.label || "").toLowerCase();
        const ab = (lvl.abbreviation || "").toUpperCase();
        const id = (lvl.id || "").toUpperCase();
        if (nm.includes("sat") || ab === "SAT" || ab === "S" || id === "S")
          return "satisfactory";
        if (nm.includes("mon") || nm.includes("marg") || ab === "MON" || ab === "M" || id === "M")
          return "monitor";
        if (nm.includes("def") || nm.includes("rep") || ab === "DEF" || ab === "D" || id === "D")
          return "defect";
        break;
      }
      return "all";
    },
    [ratingLevels]
  );
  const getRatingColor = useCallback(
    (ratingId) => {
      if (!ratingId) return "#d4d4d8";
      const lvl = ratingLevels.find((l) => l.id === ratingId);
      if (lvl == null ? void 0 : lvl.color) return lvl.color;
      const legacy = {
        Satisfactory: "#22c55e",
        Monitor: "#f59e0b",
        Defect: "#f43f5e"
      };
      return legacy[ratingId] || "#d4d4d8";
    },
    [ratingLevels]
  );
  const getRatingLabel = useCallback(
    (ratingId) => {
      if (!ratingId) return "";
      const lvl = ratingLevels.find((l) => l.id === ratingId);
      return (lvl == null ? void 0 : lvl.abbreviation) || ratingId;
    },
    [ratingLevels]
  );
  const progress = useMemo(() => {
    let total = 0;
    let rated = 0;
    for (const sec of sections) {
      for (const item of sec.items || []) {
        total++;
        const r = getResult(item.id, sec.id);
        if (r.rating) {
          rated++;
        } else {
          const v = r.value;
          if (v !== void 0 && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)) {
            rated++;
          }
        }
      }
    }
    return {
      total,
      rated,
      pct: total > 0 ? Math.round(rated / total * 100) : 0
    };
  }, [sections, getResult]);
  const sectionProgress = useCallback(
    (sectionId) => {
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return { rated: 0, total: 0, percent: 0 };
      const total = sec.items.length;
      if (total === 0) return { rated: 0, total: 0, percent: 0 };
      let rated = 0;
      for (const item of sec.items) {
        const r = getResult(item.id, sec.id);
        if (r.rating != null) rated++;
      }
      return {
        rated,
        total,
        percent: Math.round(rated / total * 100)
      };
    },
    [sections, getResult]
  );
  const sectionDefectCount = useCallback(
    (sectionId) => {
      var _a;
      const sec = sections.find((s) => s.id === sectionId);
      if (!sec) return 0;
      let count = 0;
      for (const item of sec.items || []) {
        const rating = (_a = getResult(item.id, sectionId)) == null ? void 0 : _a.rating;
        if (!rating) continue;
        const level = ratingLevels.find((l) => l.id === rating);
        if ((level == null ? void 0 : level.isDefect) || rating === "Defect") count++;
      }
      return count;
    },
    [sections, ratingLevels, getResult]
  );
  const reportStats = useMemo(() => {
    var _a;
    let total = 0;
    let rated = 0;
    let satisfactory = 0;
    let monitor = 0;
    let defect = 0;
    for (const sec of sections) {
      const items = sec.items || [];
      total += items.length;
      for (const item of items) {
        const ratingId = (_a = getResult(item.id, sec.id)) == null ? void 0 : _a.rating;
        if (!ratingId) continue;
        rated++;
        const bucket = bucketForRatingId(ratingId);
        if (bucket === "satisfactory") satisfactory++;
        else if (bucket === "monitor") monitor++;
        else if (bucket === "defect") defect++;
      }
    }
    return { total, rated, satisfactory, monitor, defect };
  }, [sections, getResult, bucketForRatingId]);
  const selectSection = useCallback(
    (idx) => {
      var _a;
      setActiveView("items");
      setCurrentSectionIdx(idx);
      setBatchMode(false);
      setBatchSelected({});
      const items = ((_a = sections[idx]) == null ? void 0 : _a.items) || [];
      if (items.length > 0) {
        setActiveItemId(items[0].id);
      } else {
        setActiveItemId(null);
      }
    },
    [sections]
  );
  const selectSectionById = useCallback(
    (sectionId) => {
      const idx = sections.findIndex((s) => s.id === sectionId);
      if (idx >= 0) selectSection(idx);
    },
    [sections, selectSection]
  );
  const navigateItem = useCallback(
    (dir) => {
      var _a, _b;
      const items = currentSectionItems;
      if (!items.length) return;
      let curIdx = -1;
      if (activeItemId) {
        curIdx = items.findIndex((i) => i.id === activeItemId);
      }
      const nextIdx = curIdx === -1 ? dir > 0 ? 0 : items.length - 1 : curIdx + dir;
      if (nextIdx >= items.length) {
        if (currentSectionIdx < sections.length - 1) {
          const newIdx = currentSectionIdx + 1;
          setCurrentSectionIdx(newIdx);
          const nextItems = ((_a = sections[newIdx]) == null ? void 0 : _a.items) || [];
          if (nextItems.length) setActiveItemId(nextItems[0].id);
        }
      } else if (nextIdx < 0) {
        if (currentSectionIdx > 0) {
          const newIdx = currentSectionIdx - 1;
          setCurrentSectionIdx(newIdx);
          const prevItems = ((_b = sections[newIdx]) == null ? void 0 : _b.items) || [];
          if (prevItems.length) setActiveItemId(prevItems[prevItems.length - 1].id);
        }
      } else {
        setActiveItemId(items[nextIdx].id);
      }
      requestAnimationFrame(() => {
        if (activeItemId) {
          const card = document.querySelector(`[data-item-id="${activeItemId}"]`);
          card == null ? void 0 : card.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      });
    },
    [activeItemId, currentSectionItems, currentSectionIdx, sections]
  );
  const advanceToNextUnrated = useCallback(() => {
    if (!activeItemId) return;
    const items = currentSectionItems;
    const curIdx = items.findIndex((i) => i.id === activeItemId);
    for (let i = curIdx + 1; i < items.length; i++) {
      const r = getResult(items[i].id, currentSection == null ? void 0 : currentSection.id);
      if (!r.rating) {
        setActiveItemId(items[i].id);
        return;
      }
    }
    if (curIdx < items.length - 1) {
      setActiveItemId(items[curIdx + 1].id);
    }
  }, [activeItemId, currentSectionItems, currentSection, getResult]);
  const searchNeedle = useMemo(
    () => (searchQuery || "").trim().toLowerCase(),
    [searchQuery]
  );
  const itemMatchesSearch = useCallback(
    (section, item) => {
      if (!searchNeedle) return true;
      if (section && (section.title || "").toLowerCase().includes(searchNeedle))
        return true;
      if ((item.label || "").toLowerCase().includes(searchNeedle)) return true;
      const r = getResult(item.id);
      if (r.notes && String(r.notes).toLowerCase().includes(searchNeedle))
        return true;
      return false;
    },
    [searchNeedle, getResult]
  );
  const sectionMatchesSearch = useCallback(
    (section) => {
      if (!searchNeedle) return true;
      if ((section.title || "").toLowerCase().includes(searchNeedle))
        return true;
      return (section.items || []).some(
        (it) => itemMatchesSearch(section, it)
      );
    },
    [searchNeedle, itemMatchesSearch]
  );
  const itemPassesFilter = useCallback(
    (item, sectionId) => {
      if (itemFilter === "all") return true;
      const r = getResult(item.id, sectionId);
      if (itemFilter === "unrated") return !r || r.rating == null;
      if (itemFilter === "issues") {
        if (!r || !r.rating) return false;
        const level = ratingLevels.find((l) => l.id === r.rating);
        return !!(level == null ? void 0 : level.isDefect) || (level == null ? void 0 : level.severity) === "significant" || (level == null ? void 0 : level.severity) === "marginal";
      }
      if (itemFilter === "flagged") {
        const tags2 = tagsByItem[item.id];
        return Array.isArray(tags2) && tags2.length > 0;
      }
      return true;
    },
    [itemFilter, getResult, ratingLevels, tagsByItem]
  );
  const filterCounts = useMemo(() => {
    var _a;
    const items = currentSectionItems;
    const counts = { all: items.length, unrated: 0, issues: 0, flagged: 0 };
    for (const item of items) {
      const r = getResult(item.id, currentSection == null ? void 0 : currentSection.id);
      if (!r || r.rating == null) counts.unrated++;
      if (r == null ? void 0 : r.rating) {
        const level = ratingLevels.find((l) => l.id === r.rating);
        if ((level == null ? void 0 : level.isDefect) || (level == null ? void 0 : level.severity) === "significant" || (level == null ? void 0 : level.severity) === "marginal")
          counts.issues++;
      }
      if ((_a = tagsByItem[item.id]) == null ? void 0 : _a.length) counts.flagged++;
    }
    return counts;
  }, [currentSectionItems, currentSection, getResult, ratingLevels, tagsByItem]);
  const toggleBatchSelect = useCallback(
    (itemId, shiftKey) => {
      setBatchSelected((prev) => {
        const next = { ...prev };
        if (shiftKey && lastBatchClickedRef.current) {
          const items = currentSectionItems;
          const startIdx = items.findIndex(
            (i) => i.id === lastBatchClickedRef.current
          );
          const endIdx = items.findIndex((i) => i.id === itemId);
          if (startIdx >= 0 && endIdx >= 0) {
            const lo = Math.min(startIdx, endIdx);
            const hi = Math.max(startIdx, endIdx);
            for (let i = lo; i <= hi; i++) {
              next[items[i].id] = true;
            }
          }
        } else {
          next[itemId] = !prev[itemId];
        }
        lastBatchClickedRef.current = itemId;
        return next;
      });
    },
    [currentSectionItems]
  );
  const batchSelectAll = useCallback(() => {
    const next = {};
    for (const item of currentSectionItems) {
      next[item.id] = true;
    }
    setBatchSelected(next);
  }, [currentSectionItems]);
  const selectedBatchCount = useMemo(
    () => Object.values(batchSelected).filter(Boolean).length,
    [batchSelected]
  );
  const filteredSectionsForPicker = useMemo(() => {
    const q = (sectionPickerQuery || "").toLowerCase().trim();
    const src = sections.map((s, idx) => ({
      idx,
      title: s.title || s.name || `#${idx}`
    }));
    if (!q) return src;
    return src.filter((s) => s.title.toLowerCase().includes(q));
  }, [sections, sectionPickerQuery]);
  const openSectionPicker = useCallback(() => {
    setSectionPickerOpen(true);
    setSectionPickerQuery("");
    setSectionPickerIdx(0);
    requestAnimationFrame(() => {
      const input = document.getElementById("section-picker-input");
      input == null ? void 0 : input.focus();
    });
  }, []);
  const closeSectionPicker = useCallback(() => {
    setSectionPickerOpen(false);
    setSectionPickerQuery("");
    setSectionPickerIdx(0);
  }, []);
  const pickSection = useCallback(
    (idx) => {
      selectSection(idx);
      closeSectionPicker();
    },
    [selectSection, closeSectionPicker]
  );
  const formattedDate = useMemo(() => {
    const d = inspection.date || inspection.scheduledDate || inspection.createdAt;
    if (!d) return "";
    try {
      return new Date(d).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      });
    } catch {
      return String(d);
    }
  }, [inspection]);
  return {
    // Core data
    inspection,
    setInspection,
    schema,
    sections,
    ratingLevels,
    setRatingLevels,
    results,
    setResults,
    // Navigation
    currentSectionIdx,
    setCurrentSectionIdx,
    currentSection,
    currentSectionItems,
    activeItemId,
    setActiveItemId,
    activeItem,
    activeView,
    setActiveView,
    viewMode,
    setViewMode,
    itemFilter,
    setItemFilter,
    selectSection,
    selectSectionById,
    navigateItem,
    advanceToNextUnrated,
    // Search
    searchQuery,
    setSearchQuery,
    searchNeedle,
    itemMatchesSearch,
    sectionMatchesSearch,
    // Filter
    itemPassesFilter,
    filterCounts,
    // Batch
    batchMode,
    setBatchMode,
    batchSelected,
    setBatchSelected,
    toggleBatchSelect,
    batchSelectAll,
    selectedBatchCount,
    // Speed mode
    speedMode,
    setSpeedMode,
    speedQueue,
    setSpeedQueue,
    speedCurrent,
    setSpeedCurrent,
    speedItemsRef,
    // Comment library
    showCommentLibrary,
    setShowCommentLibrary,
    commentLibraryFilter,
    setCommentLibraryFilter,
    commentLibrarySearch,
    setCommentLibrarySearch,
    commentLibrarySelectedIdx,
    setCommentLibrarySelectedIdx,
    // Section picker
    sectionPickerOpen,
    setSectionPickerOpen,
    sectionPickerQuery,
    setSectionPickerQuery,
    sectionPickerIdx,
    setSectionPickerIdx,
    filteredSectionsForPicker,
    openSectionPicker,
    closeSectionPicker,
    pickSection,
    // UI panels
    showPublishModal,
    setShowPublishModal,
    showCheatsheet,
    setShowCheatsheet,
    settingsOpen,
    setSettingsOpen,
    dockOpen,
    setDockOpen,
    burstCameraOpen,
    setBurstCameraOpen,
    burstCameraItemId,
    setBurstCameraItemId,
    // Tags
    tagsByItem,
    setTagsByItem,
    // Published version
    publishedVersion,
    setPublishedVersion,
    // Save state
    saveStatus,
    setSaveStatus,
    dirty,
    setDirty,
    // Desktop detection
    isDesktop,
    // Result helpers
    getResult,
    findItemById,
    sectionIdForItem,
    fk,
    bucketForRatingId,
    getRatingColor,
    getRatingLabel,
    // Progress
    progress,
    sectionProgress,
    sectionDefectCount,
    reportStats,
    // Misc
    formattedDate
  };
}
function useFindings(results, setResults, fetcher, options) {
  const saveTimer = useRef();
  const { sectionIdForItem, setDirty, setSaveStatus } = options;
  const getResult = useCallback(
    (itemId, sectionId) => {
      const sid = sectionId || sectionIdForItem(itemId);
      if (sid) {
        const ck = fKey(sid, itemId);
        if (results[ck]) return results[ck];
      }
      return results[itemId] || {};
    },
    [results, sectionIdForItem]
  );
  const debounceSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setDirty(true);
    setSaveStatus("saving");
    saveTimer.current = setTimeout(() => {
      fetcher.submit(
        { intent: "save-all", data: JSON.stringify(results) },
        { method: "POST" }
      );
    }, 1e3);
  }, [fetcher, results, setDirty, setSaveStatus]);
  const saveNow = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("saving");
    fetcher.submit(
      { intent: "save-all", data: JSON.stringify(results) },
      { method: "POST" }
    );
  }, [fetcher, results, setSaveStatus]);
  const setRating = useCallback(
    (sectionId, itemId, rating) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...prev[key] || {},
          ...prev[itemId] || {},
          rating
        },
        [itemId]: {
          ...prev[key] || {},
          ...prev[itemId] || {},
          rating
        }
      }));
      fetcher.submit(
        { intent: "rate", itemId, sectionId, rating: rating || "" },
        { method: "POST" }
      );
      setDirty(true);
    },
    [setResults, fetcher, setDirty]
  );
  const setNotes = useCallback(
    (sectionId, itemId, notes) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...prev[key] || {},
          ...prev[itemId] || {},
          notes
        },
        [itemId]: {
          ...prev[key] || {},
          ...prev[itemId] || {},
          notes
        }
      }));
    },
    [setResults]
  );
  const commitNotes = useCallback(
    (sectionId, itemId, notes) => {
      fetcher.submit(
        { intent: "notes", itemId, sectionId, notes },
        { method: "POST" }
      );
      setDirty(true);
    },
    [fetcher, setDirty]
  );
  const setItemValue = useCallback(
    (sectionId, itemId, value) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => ({
        ...prev,
        [key]: {
          ...prev[key] || {},
          value
        },
        [itemId]: {
          ...prev[key] || {},
          value
        }
      }));
      setDirty(true);
    },
    [setResults, setDirty]
  );
  const toggleCannedComment = useCallback(
    (sectionId, itemId, tabName, cannedId, included) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing = prev[key] || {};
        const existingTabs = existing.tabs || {};
        const tabEntries = [...existingTabs[tabName] || []];
        const idx = tabEntries.findIndex((e) => e.cannedId === cannedId);
        if (idx >= 0) {
          tabEntries[idx] = { ...tabEntries[idx], included };
        } else {
          tabEntries.push({ cannedId, included });
        }
        const updated = {
          ...existing,
          tabs: { ...existingTabs, [tabName]: tabEntries }
        };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated
        };
      });
      fetcher.submit(
        {
          intent: "toggle-canned",
          itemId,
          sectionId,
          tabName,
          cannedId,
          included: String(included)
        },
        { method: "POST" }
      );
      setDirty(true);
    },
    [setResults, fetcher, setDirty]
  );
  const insertComment = useCallback(
    (sectionId, itemId, text, withExtraNewline = false) => {
      const key = fKey(sectionId, itemId);
      setResults((prev) => {
        const existing = prev[key] || {};
        const oldNotes = existing.notes || "";
        const sep = withExtraNewline ? "\n\n" : "\n";
        const newNotes = oldNotes ? oldNotes.trimEnd() + sep + text : text;
        const updated = { ...existing, notes: newNotes };
        return {
          ...prev,
          [key]: updated,
          [itemId]: updated
        };
      });
      setDirty(true);
    },
    [setResults, setDirty]
  );
  const repeatPreviousRating = useCallback(
    (sectionId, itemId, sectionItems) => {
      const activeIdx = sectionItems.findIndex((it) => it.id === itemId);
      let priorResult = null;
      for (let i = activeIdx - 1; i >= 0; i--) {
        const r = getResult(sectionItems[i].id, sectionId);
        if (r && r.rating) {
          priorResult = r;
          break;
        }
      }
      if (!priorResult) return false;
      const key = fKey(sectionId, itemId);
      const cloned = JSON.parse(JSON.stringify(priorResult));
      setResults((prev) => ({
        ...prev,
        [key]: cloned,
        [itemId]: cloned
      }));
      setDirty(true);
      return true;
    },
    [getResult, setResults, setDirty]
  );
  const batchSetRating = useCallback(
    (sectionId, items, selected, levelId) => {
      let count = 0;
      setResults((prev) => {
        const next = { ...prev };
        for (const item of items) {
          if (!selected[item.id]) continue;
          const key = fKey(sectionId, item.id);
          const existing = next[key] || {};
          const updated = { ...existing, rating: levelId };
          next[key] = updated;
          next[item.id] = updated;
          count++;
        }
        return next;
      });
      setDirty(true);
      return count;
    },
    [setResults, setDirty]
  );
  const addPhotoToItem = useCallback(
    (itemId, photoKey) => {
      const sid = sectionIdForItem(itemId);
      if (!sid) return;
      const key = fKey(sid, itemId);
      setResults((prev) => {
        const existing = prev[key] || {};
        const photos = [
          ...existing.photos || [],
          { key: photoKey }
        ];
        const updated = { ...existing, photos };
        return { ...prev, [key]: updated, [itemId]: updated };
      });
      setDirty(true);
    },
    [sectionIdForItem, setResults, setDirty]
  );
  const getPhotoCount = useCallback(
    (itemId) => {
      const r = getResult(itemId);
      const photos = r.photos;
      return Array.isArray(photos) ? photos.length : 0;
    },
    [getResult]
  );
  return {
    getResult,
    setRating,
    setNotes,
    commitNotes,
    setItemValue,
    toggleCannedComment,
    insertComment,
    repeatPreviousRating,
    batchSetRating,
    addPhotoToItem,
    getPhotoCount,
    debounceSave,
    saveNow
  };
}
function useKeyboard(handlers, enabled = true) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const gPrefixRef = useRef(false);
  const gPrefixTimerRef = useRef(null);
  useEffect(() => {
    if (!enabled) return;
    function isInField() {
      var _a, _b;
      const tag = ((_a = document.activeElement) == null ? void 0 : _a.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT")
        return true;
      if ((_b = document.activeElement) == null ? void 0 : _b.isContentEditable)
        return true;
      return false;
    }
    function handle(e) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m;
      const h = handlersRef.current;
      const inField = isInField();
      const meta2 = e.metaKey || e.ctrlKey;
      if (meta2) {
        if (e.key === "s" || e.key === "S") {
          e.preventDefault();
          h.onSave();
          return;
        }
        if ((e.key === "p" || e.key === "P") && e.shiftKey) {
          e.preventDefault();
          h.onPublish();
          return;
        }
        if (e.key === "d" || e.key === "D") {
          e.preventDefault();
          h.onSaveAsSnippet();
          return;
        }
        if (e.key === "Enter" && h.showCommentLibrary) {
          e.preventDefault();
          (_a = h.onLibrarySelect) == null ? void 0 : _a.call(h);
          return;
        }
        if (e.key === "1") {
          e.preventDefault();
          h.onSetViewMode("split");
          return;
        }
        if (e.key === "2") {
          e.preventDefault();
          h.onSetViewMode("focus");
          return;
        }
        if (e.key === "3") {
          e.preventDefault();
          h.onSetViewMode("preview");
          return;
        }
        return;
      }
      if ((e.key === "z" || e.key === "Z") && !inField) {
        e.preventDefault();
        h.onToggleSpeed();
        return;
      }
      if (h.speedMode) {
        if (e.key >= "1" && e.key <= "5") {
          e.preventDefault();
          (_b = h.onSpeedRate) == null ? void 0 : _b.call(h, parseInt(e.key, 10) - 1);
          return;
        }
        if (e.key === "Tab" && !e.shiftKey) {
          e.preventDefault();
          (_c = h.onSpeedNext) == null ? void 0 : _c.call(h);
          return;
        }
        if (e.key === "Tab" && e.shiftKey) {
          e.preventDefault();
          (_d = h.onSpeedPrev) == null ? void 0 : _d.call(h);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          (_e = h.onSpeedNext) == null ? void 0 : _e.call(h);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          (_f = h.onSpeedPrev) == null ? void 0 : _f.call(h);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          (_g = h.onSpeedOpenEditor) == null ? void 0 : _g.call(h);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          h.onToggleSpeed();
          return;
        }
      }
      if (h.showCommentLibrary) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          (_h = h.onLibraryDown) == null ? void 0 : _h.call(h);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          (_i = h.onLibraryUp) == null ? void 0 : _i.call(h);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          (_j = h.onLibrarySelect) == null ? void 0 : _j.call(h);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          (_k = h.onLibraryClose) == null ? void 0 : _k.call(h);
          return;
        }
      }
      if (e.altKey) return;
      if (inField) {
        if (e.key === "Escape" && h.showCommentLibrary) {
          (_l = h.onLibraryClose) == null ? void 0 : _l.call(h);
        }
        return;
      }
      if (e.key === "Escape" && h.showCommentLibrary) {
        e.preventDefault();
        (_m = h.onLibraryClose) == null ? void 0 : _m.call(h);
        return;
      }
      if (gPrefixRef.current && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        gPrefixRef.current = false;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        h.onGotoSection(parseInt(e.key, 10));
        return;
      }
      if (gPrefixRef.current && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        gPrefixRef.current = false;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        h.onOpenSectionPicker();
        return;
      }
      if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        gPrefixRef.current = true;
        if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
        gPrefixTimerRef.current = setTimeout(() => {
          gPrefixRef.current = false;
        }, 1500);
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        h.onToggleCheatsheet();
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        h.onOpenLibrary();
        return;
      }
      if (e.key === ";") {
        e.preventDefault();
        h.onOpenSnippets();
        return;
      }
      if (e.key === "t" || e.key === "T") {
        e.preventDefault();
        h.onOpenTagPicker();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "j" || e.key === "J" || e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        h.onNextItem();
        return;
      }
      if (e.key === "ArrowUp" || e.key === "k" || e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        h.onPrevItem();
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        h.onRepeatRating();
        return;
      }
      if (e.key === "p" || e.key === "P") {
        e.preventDefault();
        h.onPhoto();
        return;
      }
      if (e.key >= "1" && e.key <= "5") {
        e.preventDefault();
        h.onRate(parseInt(e.key, 10));
        return;
      }
      if (e.key === "0") {
        e.preventDefault();
        h.onClearRating();
        return;
      }
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        h.onNARating();
        return;
      }
    }
    window.addEventListener("keydown", handle);
    return () => {
      window.removeEventListener("keydown", handle);
      if (gPrefixTimerRef.current) clearTimeout(gPrefixTimerRef.current);
    };
  }, [enabled]);
}
const BUILT_IN_LIBRARY = buildLibrary();
function buildLibrary() {
  const L = [];
  function add(section, rating, text) {
    L.push({ rating, section, text, source: "preset" });
  }
  add("Roof", "satisfactory", "Roof covering appears serviceable with no visible defects at the time of inspection.");
  add("Roof", "satisfactory", "Asphalt composition shingles in good overall condition; estimated remaining service life 10+ years.");
  add("Roof", "satisfactory", "Roof flashing at penetrations and chimney appears properly installed and sealed.");
  add("Roof", "satisfactory", "Gutters and downspouts are securely attached and free of significant debris.");
  add("Roof", "satisfactory", "Soffit and ridge vents present and clear of obstructions; attic ventilation appears adequate.");
  add("Roof", "satisfactory", "No active leaks or moisture intrusion observed at roof surface or interior ceilings below.");
  add("Roof", "satisfactory", "Roof valleys and rake edges are properly flashed and sealed.");
  add("Roof", "satisfactory", "Roof deck appears structurally sound with no visible sagging or deflection.");
  add("Roof", "monitor", "Asphalt shingles show signs of granule loss and weathering; monitor and budget for replacement within 3-5 years.");
  add("Roof", "monitor", "Minor moss or algae growth observed on north-facing slopes; recommend treatment to prevent moisture retention.");
  add("Roof", "monitor", "One or more shingles show curling or cupping at edges; monitor for further deterioration.");
  add("Roof", "monitor", "Flashing shows minor surface rust; monitor and apply sealant when accessible.");
  add("Roof", "monitor", "Gutters exhibit minor sagging at one or more attachment points; monitor and secure as needed.");
  add("Roof", "monitor", "Sealant at roof penetrations shows minor cracking; recommend renewal within 12 months.");
  add("Roof", "monitor", "Roof appears near end of expected service life; recommend planning for replacement within 1-3 years.");
  add("Roof", "monitor", "Skylight gaskets show minor weathering; monitor for active leakage and reseal if necessary.");
  add("Roof", "defect", "Multiple shingles are missing, broken, or lifted; recommend repair by a qualified roofing contractor.");
  add("Roof", "defect", "Active roof leak observed; recommend immediate professional repair to prevent further water damage.");
  add("Roof", "defect", "Improper or missing flashing observed at chimney/wall intersection; recommend correction to prevent leakage.");
  add("Roof", "defect", "Roof deck exhibits sagging or deflection indicating possible structural issue; further evaluation by a structural professional recommended.");
  add("Roof", "defect", "Gutters are detached or severely damaged; replacement recommended.");
  add("Roof", "defect", "Downspouts discharge directly against the foundation; extend at least 4-6 feet away to prevent foundation moisture issues.");
  add("Roof", "defect", "Multiple layers of roofing observed; full tear-off recommended at next replacement to verify deck condition.");
  add("Roof", "defect", "Visible holes or punctures in roof covering; recommend repair to prevent water intrusion.");
  add("Roof", "defect", "Improper roof slope at one or more areas causing standing water; recommend evaluation by a roofing contractor.");
  add("Roof", "defect", "Plumbing vent flashing shows separation from roof surface; recommend re-sealing.");
  add("Roof", "defect", "Exposed nail heads observed without sealant; recommend sealing to prevent rust and leakage.");
  add("Roof", "defect", "Chimney crown shows significant cracking; recommend repair or replacement.");
  add("Roof", "all", "Roof was inspected from ground level / accessible eaves only; areas not safely accessible were not inspected.");
  add("Roof", "all", "Recommend follow-up inspection by a licensed roofing contractor for cost estimate and warranty validation.");
  add("General", "satisfactory", "Functional and operating as intended at the time of inspection.");
  add("General", "satisfactory", "No deficiencies observed.");
  add("General", "satisfactory", "Appears to be properly installed and in working order.");
  add("General", "satisfactory", "Cleaning and routine maintenance recommended.");
  add("General", "monitor", "Recommend monitoring for further deterioration.");
  add("General", "monitor", "Minor wear noted; consider preventive maintenance.");
  add("General", "monitor", "Cosmetic defects observed; functional but recommend repair when convenient.");
  add("General", "monitor", "Approaching end of useful service life; budget for replacement.");
  add("General", "defect", "Recommend repair or replacement by a qualified contractor.");
  add("General", "defect", "Active leak observed; recommend immediate professional attention.");
  add("General", "defect", "Safety hazard noted; recommend correction prior to occupancy.");
  add("General", "defect", "Not functioning at time of inspection; further evaluation recommended.");
  add("General", "defect", "Improper installation observed; recommend correction by licensed professional.");
  add("General", "defect", "Damaged or deteriorated; replacement recommended.");
  add("General", "all", "Further evaluation recommended by a qualified specialist.");
  add("General", "all", "Recommend a licensed professional review the condition for cost estimate.");
  add("General", "all", "See attached photos for documentation.");
  add("General", "all", "Hidden conditions may exist that were not visible at the time of inspection.");
  add("General", "all", "Item was not accessible during the inspection; recommend re-evaluation when accessible.");
  return L;
}
function useCannedComments(options) {
  const { inspectionId, bucketForRatingId } = options;
  const [userSnippets, setUserSnippets] = useState([]);
  const [localSnippets, setLocalSnippets] = useState([]);
  useEffect(() => {
    (async () => {
      var _a;
      try {
        const res = await fetch("/api/admin/comments", {
          credentials: "include"
        });
        if (!res.ok) return;
        const json = await res.json();
        const rows = ((_a = json.data) == null ? void 0 : _a.comments) || [];
        setUserSnippets(
          rows.map((r) => ({
            id: r.id,
            rating: r.ratingBucket || "all",
            section: r.section || null,
            category: r.category || null,
            text: r.text,
            source: "snippet"
          }))
        );
      } catch {
      }
    })();
  }, [inspectionId]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("oi:snippets");
      if (raw) {
        const parsed = JSON.parse(raw);
        setLocalSnippets(
          parsed.map((c) => ({ ...c, source: "snippet" }))
        );
      }
    } catch {
    }
  }, []);
  const commentPool = useMemo(() => {
    const preset = BUILT_IN_LIBRARY;
    const seenTexts = /* @__PURE__ */ new Set();
    for (const s of userSnippets) seenTexts.add(s.text);
    const dedupedLocal = localSnippets.filter((c) => !seenTexts.has(c.text));
    return [...preset, ...userSnippets, ...dedupedLocal];
  }, [userSnippets, localSnippets]);
  const getFilteredComments = useCallback(
    (filter, search) => {
      let filtered;
      if (filter === "my-snippets") {
        filtered = commentPool.filter((c) => c.source === "snippet");
      } else if (filter === "all") {
        filtered = commentPool;
      } else {
        filtered = commentPool.filter(
          (c) => c.rating === "all" || c.rating === filter
        );
      }
      const q = (search || "").trim().toLowerCase();
      if (q) {
        filtered = filtered.filter(
          (c) => c.text.toLowerCase().includes(q)
        );
      }
      return filtered;
    },
    [commentPool]
  );
  const getQuickComments = useCallback(
    (ratingId, itemLabel, sectionTitle) => {
      const bucket = bucketForRatingId(ratingId);
      const filtered = bucket === "all" ? commentPool : commentPool.filter(
        (c) => c.rating === "all" || c.rating === bucket
      );
      const itemTokens = (itemLabel || "").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      const lcSection = (sectionTitle || "").toLowerCase();
      function score2(c) {
        let s = 0;
        const lcText = (c.text || "").toLowerCase();
        const lcSec = (c.section || "").toLowerCase();
        if (itemTokens.length > 0) {
          let hits = 0;
          for (const tok of itemTokens) {
            if (lcText.includes(tok)) hits++;
          }
          if (hits === itemTokens.length) s += 40;
          else if (hits > 0)
            s += Math.round(20 * (hits / itemTokens.length));
        }
        if (lcSec && lcSec === lcSection) s += 10;
        return s;
      }
      const scored = filtered.map((c, idx) => ({
        c,
        s: score2(c),
        idx
      }));
      scored.sort((a, b) => b.s - a.s || a.idx - b.idx);
      return scored.map((x) => x.c).slice(0, 6);
    },
    [commentPool, bucketForRatingId]
  );
  const saveSnippet = useCallback(
    async (text, bucket, section, title) => {
      var _a;
      const body = {
        text,
        ratingBucket: bucket === "all" ? null : bucket,
        section: section || null,
        category: title || null
      };
      try {
        const res = await fetch("/api/admin/comments", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          const reloadRes = await fetch("/api/admin/comments", {
            credentials: "include"
          });
          if (reloadRes.ok) {
            const json = await reloadRes.json();
            const rows = ((_a = json.data) == null ? void 0 : _a.comments) || [];
            setUserSnippets(
              rows.map((r) => ({
                id: r.id,
                rating: r.ratingBucket || "all",
                section: r.section || null,
                category: r.category || null,
                text: r.text,
                source: "snippet"
              }))
            );
          }
          return true;
        }
      } catch {
      }
      try {
        const existing = JSON.parse(
          localStorage.getItem("oi:snippets") || "[]"
        );
        if (existing.some((c) => c.text === text)) return false;
        existing.unshift({
          rating: bucket,
          text,
          source: "snippet"
        });
        localStorage.setItem("oi:snippets", JSON.stringify(existing));
        setLocalSnippets(existing);
        return true;
      } catch {
        return false;
      }
    },
    []
  );
  return {
    commentPool,
    getFilteredComments,
    getQuickComments,
    saveSnippet,
    userSnippets
  };
}
function useOfflineQueue() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [syncing, setSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const queueRef = useRef([]);
  useEffect(() => {
    function goOnline() {
      setOnline(true);
      replay();
    }
    function goOffline() {
      setOnline(false);
    }
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);
  const enqueue = useCallback(
    (req) => {
      const entry2 = { ...req, timestamp: Date.now() };
      queueRef.current.push(entry2);
      setPendingCount(queueRef.current.length);
      try {
        localStorage.setItem(
          "oi:offlineQueue",
          JSON.stringify(queueRef.current)
        );
      } catch {
      }
    },
    []
  );
  const replay = useCallback(async () => {
    if (queueRef.current.length === 0) return;
    if (syncing) return;
    setSyncing(true);
    const queue = [...queueRef.current];
    const remaining = [];
    for (const entry2 of queue) {
      try {
        const res = await fetch(entry2.url, {
          method: entry2.method,
          headers: { "Content-Type": "application/json" },
          body: entry2.body,
          credentials: "include"
        });
        if (!res.ok && res.status >= 500) {
          remaining.push(entry2);
        }
      } catch {
        remaining.push(entry2);
      }
    }
    queueRef.current = remaining;
    setPendingCount(remaining.length);
    setSyncing(false);
    setLastSyncedAt(Date.now());
    try {
      if (remaining.length > 0) {
        localStorage.setItem(
          "oi:offlineQueue",
          JSON.stringify(remaining)
        );
      } else {
        localStorage.removeItem("oi:offlineQueue");
      }
    } catch {
    }
  }, [syncing]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem("oi:offlineQueue");
      if (raw) {
        const parsed = JSON.parse(raw);
        queueRef.current = parsed;
        setPendingCount(parsed.length);
      }
    } catch {
    }
  }, []);
  const state = {
    online,
    pendingCount,
    syncing,
    lastSyncedAt,
    conflicts: []
  };
  return {
    state,
    online,
    syncing,
    pendingCount,
    lastSyncedAt,
    enqueue,
    replay
  };
}
function useUnsavedChanges(dirty) {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(() => {
    function onBeforeUnload(e) {
      if (dirtyRef.current) {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname
  );
  const confirmLeave = useCallback(() => {
    if (blocker.state === "blocked") blocker.proceed();
  }, [blocker]);
  const cancelLeave = useCallback(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  return { blocker, confirmLeave, cancelLeave };
}
function SectionRail({ sections, activeSection, onSelect, results }) {
  return /* @__PURE__ */ jsx("aside", { className: "w-[200px] flex-shrink-0 border-r border-ih-border overflow-y-auto bg-ih-bg-app/50", children: /* @__PURE__ */ jsx("nav", { className: "p-2 space-y-0.5", children: sections.map((section) => {
    var _a, _b;
    const total = ((_a = section.items) == null ? void 0 : _a.length) || 0;
    const rated = ((_b = section.items) == null ? void 0 : _b.filter((i) => {
      const r = results[`_default:${section.id}:${i.id}`] || results[i.id];
      return r == null ? void 0 : r.rating;
    }).length) || 0;
    return /* @__PURE__ */ jsx(
      "button",
      {
        onClick: () => onSelect(section.id),
        className: `w-full text-left px-3 py-2 rounded-md text-[13px] transition-all ${activeSection === section.id ? "bg-indigo-50 text-indigo-600 font-bold border-l-2 border-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-400" : "text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-700/50"}`,
        children: /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between gap-1", children: [
          /* @__PURE__ */ jsx("span", { className: "truncate", children: section.title }),
          /* @__PURE__ */ jsxs("span", { className: `text-[10px] font-mono ml-1 shrink-0 px-1.5 py-0.5 rounded ${rated === total && total > 0 ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-500"}`, children: [
            rated,
            "/",
            total
          ] })
        ] })
      },
      section.id
    );
  }) }) });
}
function ratingDotClass(rating) {
  if (rating === "Satisfactory" || rating === "SAT") return "bg-ih-ok-bg0";
  if (rating === "Monitor" || rating === "MON") return "bg-ih-watch-bg0";
  if (rating === "Defect" || rating === "DEF") return "bg-ih-bad-bg0";
  return "bg-slate-300";
}
function ItemList({ items, sectionId, activeItemId, onSelect, results }) {
  const [filter, setFilter] = useState("all");
  const filters = [
    { id: "all", label: "All" },
    { id: "unrated", label: "Unrated" },
    { id: "issues", label: "Issues" },
    { id: "flagged", label: "Flagged" }
  ];
  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    const r = results[`_default:${sectionId}:${item.id}`] || results[item.id] || {};
    if (filter === "unrated") return !r.rating;
    if (filter === "issues") return r.rating === "DEF" || r.rating === "MON" || r.rating === "Defect" || r.rating === "Monitor";
    return true;
  });
  return /* @__PURE__ */ jsxs("div", { className: "w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto flex flex-col", children: [
    /* @__PURE__ */ jsx("div", { className: "px-2 py-1.5 flex gap-1 border-b border-ih-border", children: filters.map((f) => /* @__PURE__ */ jsx(
      "button",
      {
        onClick: () => setFilter(f.id),
        className: `px-2 py-1 rounded text-[11px] font-bold ${filter === f.id ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`,
        children: f.label
      },
      f.id
    )) }),
    /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-y-auto p-2 space-y-0.5", children: filteredItems.map((item, idx) => {
      const result = results[`_default:${sectionId}:${item.id}`] || results[item.id] || {};
      return /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: () => onSelect(item.id),
          className: `w-full text-left px-3 py-2 rounded-md text-[13px] transition-all flex items-center gap-2 ${activeItemId === item.id ? "bg-ih-bg-card shadow-sm border-l-[3px] border-indigo-600 font-medium" : "text-ih-fg-3 hover:bg-slate-50 dark:hover:bg-slate-800/50"}`,
          children: [
            /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-400 font-mono w-5", children: String(idx + 1).padStart(2, "0") }),
            /* @__PURE__ */ jsx("span", { className: "flex-1 truncate", children: item.label }),
            result.rating && /* @__PURE__ */ jsx(
              "span",
              {
                className: `w-2 h-2 rounded-full flex-shrink-0 ${ratingDotClass(result.rating)}`
              }
            )
          ]
        },
        item.id
      );
    }) })
  ] });
}
const RATINGS = [
  {
    id: "SAT",
    label: "Sat",
    full: "Satisfactory",
    active: "bg-emerald-100 text-ih-ok-fg ring-2 ring-emerald-400 dark:bg-emerald-900/30"
  },
  {
    id: "MON",
    label: "Mon",
    full: "Monitor",
    active: "bg-amber-100 text-ih-watch-fg ring-2 ring-amber-400 dark:bg-amber-900/30"
  },
  {
    id: "DEF",
    label: "Def",
    full: "Defect",
    active: "bg-rose-100 text-ih-bad-fg ring-2 ring-rose-400 dark:bg-rose-900/30"
  },
  {
    id: "NI",
    label: "N/I",
    full: "Not Inspected",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300"
  },
  {
    id: "NP",
    label: "N/P",
    full: "Not Present",
    active: "bg-slate-200 text-slate-700 ring-2 ring-slate-400 dark:bg-slate-600/30 dark:text-slate-300"
  }
];
const CANNED_TABS = [
  { id: "information", label: "Information" },
  { id: "limitations", label: "Limitations" },
  { id: "defects", label: "Defects" }
];
function ItemEditor({ item, sectionTitle, result, onRating, onNotes, onNotesBlur, onToggleCanned }) {
  const [activeTab, setActiveTab] = useState("information");
  if (!item) return null;
  const tabs = item.tabs || {};
  const hasTabs = item.type === "rich" && tabs && (tabs.information && tabs.information.length > 0 || tabs.limitations && tabs.limitations.length > 0 || tabs.defects && tabs.defects.length > 0);
  const getIncludedSet = (tabName) => {
    var _a;
    const included = /* @__PURE__ */ new Set();
    const templateEntries = tabs[tabName] || [];
    const stateEntries = ((_a = result.tabs) == null ? void 0 : _a[tabName]) || [];
    const stateMap = /* @__PURE__ */ new Map();
    for (const s of stateEntries) {
      stateMap.set(s.cannedId, s.included);
    }
    for (const entry2 of templateEntries) {
      const stateVal = stateMap.get(entry2.id);
      const isIncluded = stateVal !== void 0 ? stateVal : entry2.default;
      if (isIncluded) included.add(entry2.id);
    }
    return included;
  };
  const currentTabEntries = tabs[activeTab] || [];
  const includedSet = getIncludedSet(activeTab);
  const countIncluded = (tabName) => {
    return getIncludedSet(tabName).size;
  };
  return /* @__PURE__ */ jsxs("div", { className: "max-w-2xl space-y-6", children: [
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { className: "text-[11px] text-indigo-600 font-bold uppercase tracking-wide", children: sectionTitle }),
      /* @__PURE__ */ jsx("h2", { className: "text-[19px] font-bold mt-1", children: item.label })
    ] }),
    item.type === "rich" && /* @__PURE__ */ jsx("div", { className: "flex gap-2", children: RATINGS.map((r, idx) => /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => onRating(r.id),
        title: `${r.full} (${idx + 1})`,
        className: `flex-1 h-[52px] rounded-lg text-[13px] font-bold transition-all ${result.rating === r.id ? r.active : "bg-ih-bg-muted text-ih-fg-3 hover:bg-slate-200 dark:hover:bg-slate-600"}`,
        children: [
          r.label,
          /* @__PURE__ */ jsx("span", { className: "block text-[9px] font-mono opacity-50 mt-0.5", children: idx + 1 })
        ]
      },
      r.id
    )) }),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mb-1", children: [
        /* @__PURE__ */ jsx("label", { className: "text-[11px] font-bold uppercase tracking-wide text-slate-400", children: "Notes" }),
        /* @__PURE__ */ jsxs("span", { className: `text-[10px] font-mono tabular-nums ${(result.notes || "").length > 2e3 ? "text-ih-bad" : "text-slate-400"}`, children: [
          (result.notes || "").length,
          " chars"
        ] })
      ] }),
      /* @__PURE__ */ jsx(
        "textarea",
        {
          value: result.notes || "",
          onChange: (e) => onNotes(e.target.value),
          onBlur: (e) => onNotesBlur(e.target.value),
          placeholder: "Add notes — type / for snippets",
          className: "w-full h-28 px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-[13px] resize-none focus:shadow-ih-focus focus:border-indigo-500 outline-none"
        }
      )
    ] }),
    hasTabs && /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("div", { className: "flex border-b border-ih-border mb-3", children: CANNED_TABS.map((tab) => {
        const entries = tabs[tab.id] || [];
        if (entries.length === 0) return null;
        const count = countIncluded(tab.id);
        return /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => setActiveTab(tab.id),
            className: `relative px-3 py-2 text-[12px] font-bold transition-colors ${activeTab === tab.id ? "text-ih-primary border-b-2 border-indigo-600 dark:border-indigo-400 -mb-px" : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"}`,
            children: [
              tab.label,
              count > 0 && /* @__PURE__ */ jsx("span", { className: "ml-1.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-ih-primary text-[9px] font-mono", children: count })
            ]
          },
          tab.id
        );
      }) }),
      /* @__PURE__ */ jsx("div", { className: "space-y-1.5", children: currentTabEntries.length === 0 ? /* @__PURE__ */ jsx("p", { className: "text-[12px] text-slate-400 py-3 text-center", children: "No pre-built comments for this tab." }) : currentTabEntries.map((entry2) => {
        const isIncluded = includedSet.has(entry2.id);
        return /* @__PURE__ */ jsxs(
          "label",
          {
            className: `flex items-start gap-2.5 p-2.5 rounded-lg cursor-pointer transition-colors ${isIncluded ? "bg-ih-primary-tint ring-1 ring-indigo-200 dark:ring-indigo-700" : "bg-ih-bg-app/50 hover:bg-slate-100 dark:hover:bg-slate-800"}`,
            children: [
              /* @__PURE__ */ jsx(
                "input",
                {
                  type: "checkbox",
                  checked: isIncluded,
                  onChange: () => {
                    onToggleCanned == null ? void 0 : onToggleCanned(activeTab, entry2.id, !isIncluded);
                  },
                  className: "mt-0.5 w-4 h-4 rounded border-ih-border-strong text-indigo-600 focus:ring-indigo-500/30"
                }
              ),
              /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
                /* @__PURE__ */ jsxs("div", { className: "text-[12px] font-bold text-ih-fg-2", children: [
                  entry2.title,
                  "category" in entry2 && entry2.category && /* @__PURE__ */ jsx("span", { className: `ml-1.5 text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${entry2.category === "safety" ? "bg-rose-100 text-ih-bad-fg dark:bg-rose-900/30" : entry2.category === "recommendation" ? "bg-amber-100 text-ih-watch-fg dark:bg-amber-900/30" : "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300"}`, children: entry2.category })
                ] }),
                /* @__PURE__ */ jsx("p", { className: `text-[11px] mt-0.5 leading-relaxed ${isIncluded ? "text-ih-fg-3" : "text-ih-fg-4"}`, children: entry2.comment })
              ] })
            ]
          },
          entry2.id
        );
      }) })
    ] }),
    /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between mb-1", children: [
        /* @__PURE__ */ jsx("label", { className: "text-[11px] font-bold uppercase tracking-wide text-slate-400", children: "Photos" }),
        (result.photos || []).length > 0 && /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-1 text-[10px] font-bold text-ih-primary bg-ih-primary-tint px-1.5 py-0.5 rounded", children: [
          /* @__PURE__ */ jsx("svg", { className: "w-3 h-3", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" }) }),
          (result.photos || []).length
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
        /* @__PURE__ */ jsx("button", { className: "w-16 h-16 rounded-lg border-2 border-dashed border-ih-border flex items-center justify-center text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition-colors", children: /* @__PURE__ */ jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 4v16m8-8H4" }) }) }),
        /* @__PURE__ */ jsx("span", { className: "text-[11px] text-slate-400", children: (result.photos || []).length === 0 ? "No photos yet" : `${(result.photos || []).length} photo${(result.photos || []).length === 1 ? "" : "s"}` })
      ] })
    ] })
  ] });
}
const TABS$8 = [
  { id: "preview", label: "Preview", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "library", label: "Library", icon: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" },
  { id: "recall", label: "Recall", icon: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" }
];
function SideRail({ activeItem }) {
  const [activeTab, setActiveTab] = useState("preview");
  const [open, setOpen] = useState(false);
  const toggle = (tabId) => {
    if (activeTab === tabId && open) {
      setOpen(false);
    } else {
      setActiveTab(tabId);
      setOpen(true);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "flex h-full", children: [
    open && /* @__PURE__ */ jsxs("div", { className: "w-64 border-l border-ih-border bg-ih-bg-card flex flex-col overflow-hidden", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between px-3 py-2 border-b border-ih-border", children: [
        /* @__PURE__ */ jsx("span", { className: "text-[11px] font-bold uppercase tracking-[0.15em] text-slate-400 capitalize", children: activeTab }),
        /* @__PURE__ */ jsx("button", { onClick: () => setOpen(false), className: "w-6 h-6 flex items-center justify-center rounded text-slate-400 hover:text-slate-600", children: "✕" })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex-1 overflow-y-auto p-3", children: [
        activeTab === "preview" && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-slate-400", children: "Live preview of the active item's report rendering." }),
        activeTab === "library" && /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("input", { type: "text", placeholder: "Search comments...", className: "w-full px-2 py-1.5 rounded border border-ih-border bg-ih-bg-app text-[12px] mb-2" }),
          /* @__PURE__ */ jsxs("p", { className: "text-[11px] text-slate-400 text-center py-4", children: [
            "Type ",
            /* @__PURE__ */ jsx("kbd", { className: "px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border", children: "/" }),
            " in the note field to search."
          ] })
        ] }),
        activeTab === "recall" && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-slate-400", children: "Prior inspections' notes for similar items." })
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "w-11 flex-shrink-0 bg-ih-bg-app/50 border-l border-ih-border flex flex-col items-center py-2 gap-1", children: TABS$8.map((tab) => /* @__PURE__ */ jsxs(
      "button",
      {
        onClick: () => toggle(tab.id),
        className: `relative w-10 flex flex-col items-center gap-0.5 py-2.5 rounded-r-md transition-all ${activeTab === tab.id && open ? "bg-ih-bg-card text-ih-primary shadow-sm border-l-2 border-indigo-600 dark:border-indigo-400 -ml-px" : "text-ih-fg-4 hover:text-slate-600 dark:hover:text-slate-400"}`,
        title: tab.label,
        children: [
          /* @__PURE__ */ jsx("svg", { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ jsx("path", { d: tab.icon }) }),
          /* @__PURE__ */ jsx("span", { className: "text-[8px] font-bold uppercase tracking-[0.1em]", style: { writingMode: "vertical-rl", transform: "rotate(180deg)" }, children: tab.label })
        ]
      },
      tab.id
    )) })
  ] });
}
const SPEED_RATINGS = [
  { id: "SAT", label: "Satisfactory", color: "emerald" },
  { id: "MON", label: "Monitor", color: "amber" },
  { id: "DEF", label: "Defect", color: "rose" },
  { id: "NI", label: "N/I", color: "slate" },
  { id: "NP", label: "N/P", color: "slate" }
];
function ratingButtonClass(ratingId, currentRating) {
  if (currentRating !== ratingId) {
    return "bg-slate-800 text-slate-300 hover:bg-slate-700 border border-slate-700";
  }
  switch (ratingId) {
    case "SAT":
      return "bg-emerald-600 text-white ring-4 ring-emerald-400/50";
    case "MON":
      return "bg-amber-600 text-white ring-4 ring-amber-400/50";
    case "DEF":
      return "bg-rose-600 text-white ring-4 ring-rose-400/50";
    default:
      return "bg-slate-600 text-white ring-4 ring-slate-400/50";
  }
}
function SpeedMode({ item, sectionTitle, result, onRating, onPrev, onNext, onExit, currentIndex, totalCount }) {
  if (!item) return null;
  return /* @__PURE__ */ jsxs("div", { className: "fixed inset-0 z-[100] bg-slate-900 flex flex-col", children: [
    /* @__PURE__ */ jsxs("div", { className: "h-12 flex items-center justify-between px-4 border-b border-slate-700", children: [
      /* @__PURE__ */ jsx("span", { className: "text-[12px] text-slate-400 font-bold uppercase tracking-wide", children: sectionTitle }),
      /* @__PURE__ */ jsxs("span", { className: "text-[12px] text-ih-fg-3 font-mono", children: [
        currentIndex + 1,
        " / ",
        totalCount
      ] }),
      /* @__PURE__ */ jsx("button", { onClick: onExit, className: "text-[12px] text-slate-400 hover:text-white", children: "Exit Speed Mode" })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex-1 flex flex-col items-center justify-center px-8", children: [
      /* @__PURE__ */ jsx("h2", { className: "text-2xl font-bold text-white mb-8", children: item.label }),
      /* @__PURE__ */ jsx("div", { className: "flex gap-3", children: SPEED_RATINGS.map((r, idx) => /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: () => {
            onRating(r.id);
            onNext();
          },
          className: `w-20 h-20 rounded-xl text-sm font-bold transition-all ${ratingButtonClass(r.id, result.rating)}`,
          children: [
            r.label.split(" ")[0],
            /* @__PURE__ */ jsx("span", { className: "block text-[10px] opacity-50 mt-1", children: idx + 1 })
          ]
        },
        r.id
      )) }),
      /* @__PURE__ */ jsxs("div", { className: "flex gap-4 mt-8", children: [
        /* @__PURE__ */ jsx("button", { onClick: onPrev, disabled: currentIndex === 0, className: "px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm", children: "← Prev" }),
        /* @__PURE__ */ jsx("button", { onClick: onNext, disabled: currentIndex >= totalCount - 1, className: "px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-30 text-sm", children: "Next →" })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "h-10 flex items-center justify-center text-[11px] text-ih-fg-3 border-t border-slate-700", children: [
      "Press ",
      /* @__PURE__ */ jsx("kbd", { className: "mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700", children: "Z" }),
      " or ",
      /* @__PURE__ */ jsx("kbd", { className: "mx-1 px-1.5 py-0.5 bg-slate-800 rounded text-[10px] font-mono border border-slate-700", children: "Esc" }),
      " to exit"
    ] })
  ] });
}
const SHORTCUTS = [
  { keys: ["1", "-", "5"], desc: "Rate item" },
  { keys: ["J", "/", "K"], desc: "Next / Prev" },
  { keys: ["/"], desc: "Open library" },
  { keys: ["P"], desc: "Capture photo" },
  { keys: ["V"], desc: "Voice note" },
  { keys: ["R"], desc: "Repeat rating" },
  { keys: ["Z"], desc: "Speed mode" },
  { keys: ["G", "D"], desc: "Next defect" },
  { keys: ["Tab"], desc: "Next field" },
  { keys: ["Esc"], desc: "Cancel" },
  { keys: ["⌘", "\\"], desc: "Toggle sidebar" },
  { keys: ["?"], desc: "This help" }
];
function FooterBar() {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  return /* @__PURE__ */ jsxs("div", { className: "fixed bottom-0 inset-x-0 z-30 bg-ih-bg-card border-t border-ih-border px-4 py-1.5 flex items-center gap-3 text-[11px] text-ih-fg-3", children: [
    /* @__PURE__ */ jsxs("div", { className: "relative", children: [
      /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: () => setShortcutsOpen(!shortcutsOpen),
          className: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-ih-border font-bold text-[10px] hover:bg-slate-50 dark:hover:bg-slate-800",
          children: [
            /* @__PURE__ */ jsx("kbd", { className: "px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border", children: "?" }),
            "Shortcuts"
          ]
        }
      ),
      shortcutsOpen && /* @__PURE__ */ jsxs("div", { className: "absolute bottom-full left-0 mb-2 w-[320px] bg-ih-bg-card border border-ih-border rounded-lg shadow-lg z-50 p-3", children: [
        /* @__PURE__ */ jsx("h4", { className: "text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-2", children: "Keyboard shortcuts" }),
        /* @__PURE__ */ jsx("div", { className: "grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]", children: SHORTCUTS.map((s, i) => /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2", children: [
          /* @__PURE__ */ jsx("span", { className: "flex gap-0.5", children: s.keys.map((k, j) => /* @__PURE__ */ jsx("kbd", { className: "px-1 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border border-ih-border min-w-[22px] text-center", children: k }, j)) }),
          /* @__PURE__ */ jsx("span", { className: "text-ih-fg-3", children: s.desc })
        ] }, i)) })
      ] })
    ] }),
    /* @__PURE__ */ jsx("span", { className: "flex-1" }),
    /* @__PURE__ */ jsxs("span", { className: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded border border-ih-border font-bold text-[10px]", children: [
      /* @__PURE__ */ jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-ih-ok-bg0" }),
      "Connected"
    ] })
  ] });
}
const COLUMNS = [
  { title: "Navigate", rows: [
    { key: "Up/Down", label: "Next / previous item" },
    { key: "Enter", label: "Next item" },
    { key: "Shift+Enter", label: "Previous item" },
    { key: "GS", label: "Jump to section" },
    { key: "Cmd+K", label: "Command palette" },
    { key: "Ctrl+/", label: "Command palette (Win)" }
  ] },
  { title: "Rating", rows: [
    { key: "1", label: "Satisfactory" },
    { key: "2", label: "Monitor" },
    { key: "3", label: "Defect" },
    { key: "4", label: "Not Inspected" },
    { key: "5", label: "Not Present" },
    { key: "0", label: "Clear rating" },
    { key: "N", label: "Mark Not Applicable" }
  ] },
  { title: "Content", rows: [
    { key: "/", label: "Open Comment Library" },
    { key: ";", label: "Insert snippet" },
    { key: "P", label: "Add photo" },
    { key: "T", label: "Add tag" },
    { key: "Cmd+D", label: "Save current as snippet" }
  ] },
  { title: "View", rows: [
    { key: "Cmd+1", label: "Three-pane layout" },
    { key: "Cmd+2", label: "Focus mode" },
    { key: "Cmd+3", label: "Preview" },
    { key: "Cmd+S", label: "Save" },
    { key: "Cmd+Shift+P", label: "Publish" }
  ] }
];
function KeyboardHud() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function onKeyDown(e) {
      var _a, _b;
      if (e.key === "?" || e.shiftKey && e.key === "/") {
        const tag = (_a = e.target) == null ? void 0 : _a.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || ((_b = e.target) == null ? void 0 : _b.isContentEditable)) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  if (!open) return null;
  return /* @__PURE__ */ jsxs("div", { className: "fixed inset-0 z-[9999] flex items-center justify-center p-4", role: "dialog", "aria-modal": "true", "aria-label": "Keyboard shortcuts", children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-slate-900/85 backdrop-blur-sm", onClick: () => setOpen(false) }),
    /* @__PURE__ */ jsxs("div", { className: "relative bg-white rounded-lg shadow-md border border-slate-200 max-w-4xl w-full max-h-[85vh] overflow-y-auto", children: [
      /* @__PURE__ */ jsxs("header", { className: "px-6 py-4 border-b border-slate-100 flex items-center justify-between", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("h2", { className: "text-base font-bold text-slate-900", children: "Keyboard shortcuts" }),
          /* @__PURE__ */ jsxs("p", { className: "text-xs text-ih-fg-3 mt-0.5", children: [
            "Press ",
            /* @__PURE__ */ jsx("kbd", { className: "px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono", children: "?" }),
            " to toggle, ",
            /* @__PURE__ */ jsx("kbd", { className: "px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-[10px] font-mono", children: "Esc" }),
            " to close"
          ] })
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: () => setOpen(false), className: "text-slate-400 hover:text-slate-700 text-xl leading-none", "aria-label": "Close", children: "×" })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6", children: COLUMNS.map((col) => /* @__PURE__ */ jsxs("div", { children: [
        /* @__PURE__ */ jsx("h3", { className: "text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-3", children: col.title }),
        /* @__PURE__ */ jsx("ul", { className: "space-y-2", children: col.rows.map((row) => /* @__PURE__ */ jsxs("li", { className: "flex items-center justify-between gap-3 text-xs", children: [
          /* @__PURE__ */ jsx("span", { className: "text-slate-600 leading-tight", children: row.label }),
          /* @__PURE__ */ jsx("kbd", { className: "shrink-0 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-mono text-slate-700 min-w-[28px] text-center", children: row.key })
        ] }, row.key)) })
      ] }, col.title)) }),
      /* @__PURE__ */ jsx("footer", { className: "px-6 py-3 border-t border-slate-100 text-[10px] text-slate-400 italic", children: "Shortcuts marked with Cmd require platform meta key on Mac. Some shortcuts may be inactive until that feature ships." })
    ] })
  ] });
}
const TILES = [
  { id: "speed-mode", label: "Speed mode", iconPath: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z", hotkey: "Z" },
  { id: "burst-camera", label: "Burst camera", iconPath: "M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316zM16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" },
  { id: "photo-studio", label: "Photo studio", iconPath: "M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" },
  { id: "shortcuts", label: "Shortcuts", iconPath: "M6 6.878V6a2.25 2.25 0 012.25-2.25h7.5A2.25 2.25 0 0118 6v.878m-12 0c.235-.083.487-.128.75-.128h10.5c.263 0 .515.045.75.128m-12 0A2.25 2.25 0 004.5 9v.878m13.5-3A2.25 2.25 0 0119.5 9v.878m0 0a2.246 2.246 0 00-.75-.128H5.25c-.263 0-.515.045-.75.128m15 0A2.25 2.25 0 0121 12v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6c0-.98.626-1.813 1.5-2.122", hotkey: "?" }
];
function InspectorToolsDock({
  onToggleSpeedMode,
  onBurstCamera,
  onPhotoStudio,
  onToggleCheatsheet,
  activeItemId,
  hidden
}) {
  const [dockOpen, setDockOpen] = useState(false);
  if (hidden) return null;
  const handlers = {
    "speed-mode": () => {
      onToggleSpeedMode == null ? void 0 : onToggleSpeedMode();
      setDockOpen(false);
    },
    "burst-camera": () => {
      onBurstCamera == null ? void 0 : onBurstCamera(activeItemId);
      setDockOpen(false);
    },
    "photo-studio": () => {
      onPhotoStudio == null ? void 0 : onPhotoStudio();
      setDockOpen(false);
    },
    shortcuts: () => {
      onToggleCheatsheet == null ? void 0 : onToggleCheatsheet();
      setDockOpen(false);
    }
  };
  return /* @__PURE__ */ jsxs("div", { className: "fixed bottom-6 right-6 z-40", children: [
    dockOpen && /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-[-1]", onClick: () => setDockOpen(false), "aria-hidden": "true" }),
    dockOpen && /* @__PURE__ */ jsx("div", { className: "absolute bottom-16 right-0 mb-2 ih-card p-2 min-w-[200px] bg-ih-bg-card border border-ih-border rounded-lg shadow-lg", role: "menu", "aria-label": "Inspector tools", children: TILES.map((t) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-slate-100 dark:hover:bg-slate-700",
        onClick: handlers[t.id],
        role: "menuitem",
        children: [
          /* @__PURE__ */ jsx("svg", { "aria-hidden": "true", className: "w-5 h-5 text-ih-fg-3", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { d: t.iconPath }) }),
          /* @__PURE__ */ jsx("span", { className: "flex-1 text-left text-sm", children: t.label }),
          t.hotkey && /* @__PURE__ */ jsx("span", { className: "ih-kbd text-[11px] text-slate-400 bg-ih-bg-muted px-1.5 py-0.5 rounded font-mono", children: t.hotkey })
        ]
      },
      t.id
    )) }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg flex items-center justify-center text-white active:scale-95 transition-transform",
        onClick: () => setDockOpen(!dockOpen),
        "aria-label": "Open inspector tools",
        "aria-expanded": dockOpen,
        children: /* @__PURE__ */ jsx("svg", { "aria-hidden": "true", className: "w-6 h-6 transition-transform duration-150", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", viewBox: "0 0 24 24", style: dockOpen ? { transform: "rotate(45deg)" } : void 0, children: /* @__PURE__ */ jsx("path", { d: "M12 4.5v15m7.5-7.5h-15" }) })
      }
    )
  ] });
}
function BurstCamera({ open, onClose, onCommit }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const burstTimerRef = useRef(null);
  const [captures, setCaptures] = useState([]);
  const [burstActive, setBurstActive] = useState(false);
  const [burstCount, setBurstCount] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [facing, setFacing] = useState("environment");
  const startCamera = useCallback(async (facingMode) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
    } catch {
      onClose();
    }
  }, [onClose]);
  const stopCamera = useCallback(() => {
    var _a;
    (_a = streamRef.current) == null ? void 0 : _a.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);
  useEffect(() => {
    if (open) {
      startCamera(facing);
    } else {
      stopCamera();
      setCaptures([]);
      setBurstActive(false);
      setBurstCount(0);
    }
    return () => stopCamera();
  }, [open, facing, startCamera, stopCamera]);
  if (!open) return null;
  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.85);
    return { id: crypto.randomUUID(), url };
  }
  function onShutterDown() {
    const frame = captureFrame();
    if (frame) setCaptures((prev) => [...prev, frame]);
    burstTimerRef.current = setInterval(() => {
      setBurstActive(true);
      setBurstCount((c) => {
        if (c >= 30) {
          if (burstTimerRef.current) clearInterval(burstTimerRef.current);
          return c;
        }
        const f = captureFrame();
        if (f) setCaptures((prev) => [...prev, f]);
        return c + 1;
      });
    }, 100);
  }
  function onShutterUp() {
    if (burstTimerRef.current) clearInterval(burstTimerRef.current);
    burstTimerRef.current = null;
    setBurstActive(false);
    setBurstCount(0);
  }
  function discardOne(id) {
    setCaptures((prev) => prev.filter((c) => c.id !== id));
  }
  function discardAll() {
    setCaptures([]);
  }
  async function commit() {
    setUploading(true);
    try {
      const blobs = await Promise.all(
        captures.map(async (c) => {
          const res = await fetch(c.url);
          return res.blob();
        })
      );
      onCommit(blobs);
      onClose();
    } finally {
      setUploading(false);
    }
  }
  function switchFacing() {
    stopCamera();
    setFacing((f) => f === "user" ? "environment" : "user");
  }
  return /* @__PURE__ */ jsxs("div", { className: "fixed inset-0 z-50 bg-black flex flex-col", role: "dialog", "aria-label": "Burst camera", "aria-modal": "true", children: [
    /* @__PURE__ */ jsx("video", { ref: videoRef, autoPlay: true, muted: true, playsInline: true, className: "absolute inset-0 w-full h-full object-cover" }),
    /* @__PURE__ */ jsx("canvas", { ref: canvasRef, className: "hidden" }),
    /* @__PURE__ */ jsxs("div", { className: "relative z-10 flex items-center justify-between px-4 pt-4", children: [
      /* @__PURE__ */ jsx("button", { type: "button", onClick: onClose, className: "w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60", "aria-label": "Close camera", children: /* @__PURE__ */ jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) }),
      captures.length > 0 && /* @__PURE__ */ jsxs("div", { className: "text-white text-xs font-mono px-3 py-1 rounded-full bg-black/40", children: [
        captures.length,
        " captured"
      ] }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: switchFacing, className: "w-10 h-10 rounded-full bg-black/40 text-white flex items-center justify-center hover:bg-black/60", "aria-label": "Switch camera", children: /* @__PURE__ */ jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 4v5h5M20 20v-5h-5M4 9a8 8 0 0114-3M20 15a8 8 0 01-14 3" }) }) })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "flex-1" }),
    captures.length > 0 && /* @__PURE__ */ jsx("div", { className: "relative z-10 mb-3 px-4", children: /* @__PURE__ */ jsx("div", { className: "flex gap-2 overflow-x-auto pb-1", "data-testid": "burst-thumbnails", children: captures.map((c) => /* @__PURE__ */ jsxs("div", { className: "relative flex-shrink-0", children: [
      /* @__PURE__ */ jsx("img", { src: c.url, className: "w-16 h-16 object-cover rounded-md border-2 border-white/30", alt: "Captured frame" }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => discardOne(c.id), className: "absolute -top-1 -right-1 w-5 h-5 rounded-full bg-ih-bad-bg0 text-white text-xs font-bold flex items-center justify-center hover:bg-rose-600", "aria-label": "Discard this frame", children: "x" })
    ] }, c.id)) }) }),
    /* @__PURE__ */ jsxs("div", { className: "relative z-10 pb-8 px-4 flex items-center justify-between gap-4", children: [
      captures.length > 0 ? /* @__PURE__ */ jsx("button", { type: "button", onClick: discardAll, className: "text-rose-300 text-xs font-semibold hover:text-rose-200", children: "Discard all" }) : /* @__PURE__ */ jsx("div", { className: "w-20" }),
      /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          onMouseDown: onShutterDown,
          onMouseUp: onShutterUp,
          onMouseLeave: onShutterUp,
          onTouchStart: onShutterDown,
          onTouchEnd: onShutterUp,
          onTouchCancel: onShutterUp,
          className: `w-20 h-20 rounded-full bg-white border-4 transition flex items-center justify-center ${burstActive ? "border-rose-500 scale-110" : "border-white/40 hover:scale-105"}`,
          "aria-label": "Capture (tap for single, hold for burst)",
          "data-testid": "burst-shutter",
          children: burstActive ? /* @__PURE__ */ jsxs("span", { className: "text-ih-bad-fg text-xs font-bold animate-pulse", children: [
            burstCount,
            " / 30"
          ] }) : /* @__PURE__ */ jsx("span", { className: "text-slate-700 text-[10px] font-bold tracking-widest uppercase", children: "Shoot" })
        }
      ),
      captures.length > 0 ? /* @__PURE__ */ jsx("button", { type: "button", onClick: commit, className: "px-5 py-2.5 rounded-full bg-indigo-500 text-white text-sm font-bold shadow-lg hover:bg-ih-primary", "data-testid": "burst-done", children: uploading ? "Uploading..." : "Done" }) : /* @__PURE__ */ jsx("div", { className: "w-20" })
    ] })
  ] });
}
const DEFAULT_FIELDS = [
  { id: "yearBuilt", label: "Year Built", type: "number", group: "Property facts" },
  { id: "sqft", label: "Sq Ft", type: "number", group: "Property facts" },
  { id: "foundationType", label: "Foundation", type: "select", group: "Property facts", options: ["basement", "slab", "crawlspace", "other"] },
  { id: "bedrooms", label: "Bedrooms", type: "number", group: "Property facts" },
  { id: "bathrooms", label: "Bathrooms", type: "number", group: "Property facts" },
  { id: "unit", label: "Unit", type: "text", group: "Property facts" },
  { id: "county", label: "County", type: "text", group: "Property facts" }
];
function PropertyInfoForm({ inspection, templateFields, propertyAddress, onSave }) {
  const metaFields = (templateFields == null ? void 0 : templateFields.length) ? templateFields : DEFAULT_FIELDS;
  const filled = useMemo(() => metaFields.filter((f) => inspection[f.id]).length, [metaFields, inspection]);
  const groups = useMemo(() => {
    const seen = /* @__PURE__ */ new Set();
    const result = [];
    for (const f of metaFields) {
      const g = f.group || "General";
      if (!seen.has(g)) {
        seen.add(g);
        result.push(g);
      }
    }
    return result;
  }, [metaFields]);
  const fieldsByGroup = useCallback(
    (group) => metaFields.filter((f) => (f.group || "General") === group),
    [metaFields]
  );
  function handleChange(field, value) {
    onSave == null ? void 0 : onSave(field.id, value);
  }
  return /* @__PURE__ */ jsxs("div", { className: "px-6 py-6 max-w-5xl", "data-testid": "property-info-form", children: [
    /* @__PURE__ */ jsxs("header", { className: "mb-6", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-2 mb-1", children: [
        /* @__PURE__ */ jsxs("p", { className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4", children: [
          "Property Info · ",
          filled,
          " of ",
          metaFields.length,
          " fields complete"
        ] }),
        filled === metaFields.length && /* @__PURE__ */ jsx("span", { className: "inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-ih-ok-bg text-ih-ok-fg ring-1 ring-inset ring-emerald-200 dark:ring-emerald-700", children: "Complete" })
      ] }),
      /* @__PURE__ */ jsx("h2", { className: "text-2xl font-bold tracking-tight text-ih-fg-1", children: propertyAddress || inspection.propertyAddress || "Property Info" })
    ] }),
    groups.map((g) => /* @__PURE__ */ jsxs("fieldset", { className: "mb-6", children: [
      /* @__PURE__ */ jsx("legend", { className: "text-[11px] font-bold uppercase tracking-[0.15em] text-ih-fg-4 mb-2", children: g }),
      /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3", children: fieldsByGroup(g).map((f) => /* @__PURE__ */ jsxs("label", { className: "block", children: [
        /* @__PURE__ */ jsxs("span", { className: "flex items-center gap-1 text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-3", children: [
          /* @__PURE__ */ jsx("span", { children: f.label }),
          inspection[`_prefilled_${f.id}`] && /* @__PURE__ */ jsx("span", { className: "text-[9px] font-semibold text-ih-primary normal-case tracking-normal", children: "Prefilled" })
        ] }),
        (f.type === "text" || f.type === "number" || f.type === "date") && /* @__PURE__ */ jsx(
          "input",
          {
            type: f.type,
            value: inspection[f.id] ?? "",
            onChange: (e) => handleChange(f, f.type === "number" ? Number(e.target.value) : e.target.value),
            placeholder: f.unit ?? "—",
            className: "ih-input mt-1 w-full"
          }
        ),
        f.type === "select" && /* @__PURE__ */ jsxs(
          "select",
          {
            value: inspection[f.id] ?? "",
            onChange: (e) => handleChange(f, e.target.value),
            className: "ih-input mt-1 w-full",
            children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "—" }),
              (f.options ?? []).map((opt) => /* @__PURE__ */ jsx("option", { value: opt, children: opt }, opt))
            ]
          }
        ),
        f.type === "boolean" && /* @__PURE__ */ jsx("div", { className: "mt-1 flex items-center h-10", children: /* @__PURE__ */ jsx(
          "input",
          {
            type: "checkbox",
            checked: !!inspection[f.id],
            onChange: (e) => handleChange(f, e.target.checked),
            className: "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/30"
          }
        ) })
      ] }, f.id)) })
    ] }, g))
  ] });
}
function InspectionSettingsSheet({ open, onClose, inspectionId, referralSources = [] }) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState("idle");
  const [inspectors2, setInspectors] = useState([]);
  const [templates2, setTemplates] = useState([]);
  const [form, setForm] = useState({
    date: "",
    closingDate: "",
    inspectorId: "",
    orderId: "",
    referralSource: "",
    templateId: "",
    price: 0,
    paymentRequired: false,
    agreementRequired: false
  });
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inspRes, tplRes, insRes] = await Promise.all([
        fetch(`/api/inspections/${inspectionId}`, { credentials: "include" }),
        fetch("/api/inspections/templates", { credentials: "include" }),
        fetch("/api/team/members", { credentials: "include" })
      ]);
      if (inspRes.ok) {
        const { data } = await inspRes.json();
        setForm({
          date: data.date || "",
          closingDate: data.closingDate || "",
          inspectorId: data.inspectorId || "",
          orderId: data.orderId || "",
          referralSource: data.referralSource || "",
          templateId: data.templateId || "",
          price: data.price || 0,
          paymentRequired: !!data.paymentRequired,
          agreementRequired: !!data.agreementRequired
        });
      }
      if (tplRes.ok) {
        const { data } = await tplRes.json();
        setTemplates(data || []);
      }
      if (insRes.ok) {
        const { data } = await insRes.json();
        setInspectors(data || []);
      }
    } catch {
    } finally {
      setLoading(false);
    }
  }, [inspectionId]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);
  if (!open) return null;
  function updateForm(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }
  async function handleSave(e) {
    e.preventDefault();
    setSaveState("saving");
    try {
      const res = await fetch(`/api/inspections/${inspectionId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2e3);
    } catch {
      setSaveState("error");
    }
  }
  const inputClass = "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[14px] font-medium focus:border-indigo-500 focus:shadow-ih-focus outline-none";
  const labelClass = "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3";
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm", onClick: onClose, "aria-hidden": "true" }),
    /* @__PURE__ */ jsxs("aside", { className: "fixed top-0 right-0 bottom-0 w-full max-w-xl z-[61] bg-ih-bg-card border-l border-ih-border shadow-2xl flex flex-col", role: "dialog", "aria-modal": "true", "aria-label": "Inspection settings", children: [
      /* @__PURE__ */ jsxs("header", { className: "flex items-center justify-between gap-3 px-5 py-3 border-b border-ih-border", children: [
        /* @__PURE__ */ jsxs("div", { className: "min-w-0", children: [
          /* @__PURE__ */ jsx("h2", { className: "text-[14px] font-bold text-ih-fg-1", children: "Inspection settings" }),
          /* @__PURE__ */ jsx("p", { className: "text-[11px] text-ih-fg-3", children: "Schedule, people, template, pricing & gates" })
        ] }),
        /* @__PURE__ */ jsx("button", { type: "button", onClick: onClose, "aria-label": "Close", className: "p-1.5 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800", children: /* @__PURE__ */ jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", strokeWidth: 2, viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", d: "M6 18L18 6M6 6l12 12" }) }) })
      ] }),
      /* @__PURE__ */ jsx("div", { className: "flex-1 overflow-y-auto px-5 py-4", children: loading ? /* @__PURE__ */ jsxs("div", { className: "space-y-2 py-4", "aria-busy": "true", children: [
        /* @__PURE__ */ jsx("div", { className: "h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse", style: { width: "50%" } }),
        /* @__PURE__ */ jsx("div", { className: "h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse", style: { width: "75%" } })
      ] }) : /* @__PURE__ */ jsxs("form", { onSubmit: handleSave, className: "space-y-6 max-w-2xl", children: [
        /* @__PURE__ */ jsxs("fieldset", { className: "space-y-4", children: [
          /* @__PURE__ */ jsx("legend", { className: "text-[15px] font-semibold tracking-tight text-ih-fg-1", children: "Schedule" }),
          /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [
            /* @__PURE__ */ jsxs("label", { className: "block", children: [
              /* @__PURE__ */ jsx("span", { className: labelClass, children: "Date" }),
              /* @__PURE__ */ jsx("input", { type: "date", value: form.date, onChange: (e) => updateForm("date", e.target.value), className: inputClass })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "block", children: [
              /* @__PURE__ */ jsx("span", { className: labelClass, children: "Inspector" }),
              /* @__PURE__ */ jsxs("select", { value: form.inspectorId, onChange: (e) => updateForm("inspectorId", e.target.value), className: inputClass, children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "--- Unassigned ---" }),
                inspectors2.map((u) => /* @__PURE__ */ jsx("option", { value: u.id, children: u.name || u.email }, u.id))
              ] })
            ] })
          ] }),
          /* @__PURE__ */ jsx("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: /* @__PURE__ */ jsxs("label", { className: "block", children: [
            /* @__PURE__ */ jsx("span", { className: labelClass, children: "Closing Date" }),
            /* @__PURE__ */ jsx("input", { type: "date", value: form.closingDate, onChange: (e) => updateForm("closingDate", e.target.value), className: inputClass, "data-testid": "inspection-closing-date" })
          ] }) })
        ] }),
        /* @__PURE__ */ jsxs("fieldset", { className: "space-y-4", children: [
          /* @__PURE__ */ jsx("legend", { className: "text-[15px] font-semibold tracking-tight text-ih-fg-1", children: "Order & referral" }),
          /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [
            /* @__PURE__ */ jsxs("label", { className: "block", children: [
              /* @__PURE__ */ jsx("span", { className: labelClass, children: "Order ID" }),
              /* @__PURE__ */ jsx("input", { type: "text", maxLength: 64, placeholder: "---", value: form.orderId, onChange: (e) => updateForm("orderId", e.target.value), className: inputClass, "data-testid": "inspection-order-id" })
            ] }),
            /* @__PURE__ */ jsxs("label", { className: "block", children: [
              /* @__PURE__ */ jsx("span", { className: labelClass, children: "Referral Source" }),
              /* @__PURE__ */ jsxs("select", { value: form.referralSource, onChange: (e) => updateForm("referralSource", e.target.value), className: inputClass, "data-testid": "inspection-referral-source", children: [
                /* @__PURE__ */ jsx("option", { value: "", children: "--- Select source ---" }),
                referralSources.map((s) => /* @__PURE__ */ jsx("option", { value: s, children: s }, s))
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("fieldset", { className: "space-y-4", children: [
          /* @__PURE__ */ jsx("legend", { className: "text-[15px] font-semibold tracking-tight text-ih-fg-1", children: "Template" }),
          /* @__PURE__ */ jsxs("label", { className: "block", children: [
            /* @__PURE__ */ jsx("span", { className: labelClass, children: "Inspection template" }),
            /* @__PURE__ */ jsxs("select", { value: form.templateId, onChange: (e) => updateForm("templateId", e.target.value), className: inputClass, children: [
              /* @__PURE__ */ jsx("option", { value: "", children: "--- Select template ---" }),
              templates2.map((t) => /* @__PURE__ */ jsx("option", { value: t.id, children: t.name }, t.id))
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("fieldset", { className: "space-y-4", children: [
          /* @__PURE__ */ jsx("legend", { className: "text-[15px] font-semibold tracking-tight text-ih-fg-1", children: "Pricing & gates" }),
          /* @__PURE__ */ jsxs("div", { className: "grid grid-cols-1 sm:grid-cols-2 gap-4", children: [
            /* @__PURE__ */ jsxs("label", { className: "block", children: [
              /* @__PURE__ */ jsx("span", { className: labelClass, children: "Price (cents)" }),
              /* @__PURE__ */ jsx("input", { type: "number", min: 0, step: 100, value: form.price, onChange: (e) => updateForm("price", Number(e.target.value)), className: inputClass })
            ] }),
            /* @__PURE__ */ jsxs("div", { className: "flex flex-col gap-2 pt-5", children: [
              /* @__PURE__ */ jsxs("label", { className: "inline-flex items-center gap-2 text-[13px] text-ih-fg-3", children: [
                /* @__PURE__ */ jsx("input", { type: "checkbox", checked: form.paymentRequired, onChange: (e) => updateForm("paymentRequired", e.target.checked), className: "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" }),
                "Payment required to view report"
              ] }),
              /* @__PURE__ */ jsxs("label", { className: "inline-flex items-center gap-2 text-[13px] text-ih-fg-3", children: [
                /* @__PURE__ */ jsx("input", { type: "checkbox", checked: form.agreementRequired, onChange: (e) => updateForm("agreementRequired", e.target.checked), className: "h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500/20" }),
                "Agreement signature required"
              ] })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-end gap-3 border-t border-ih-border pt-4", children: [
          saveState === "saving" && /* @__PURE__ */ jsx("span", { className: "text-[12px] text-ih-watch-fg font-bold", children: "Saving..." }),
          saveState === "saved" && /* @__PURE__ */ jsx("span", { className: "text-[12px] text-ih-ok-fg font-bold", children: "Saved" }),
          saveState === "error" && /* @__PURE__ */ jsx("span", { className: "text-[12px] text-ih-bad-fg font-bold", children: "Error -- try again" }),
          /* @__PURE__ */ jsx("button", { type: "submit", disabled: saveState === "saving", className: "h-10 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 disabled:bg-slate-300", children: "Save changes" })
        ] })
      ] }) })
    ] })
  ] });
}
function meta$X() {
  return [{
    title: "Edit Inspection - OpenInspection"
  }];
}
async function loader$$({
  request,
  params
}) {
  var _a;
  const token = await requireToken(request);
  const id = params.id;
  const [inspRes, resultsRes, reportRes] = await Promise.all([apiFetch(`/api/inspections/${id}`, {
    token
  }), apiFetch(`/api/inspections/${id}/results`, {
    token
  }), apiFetch(`/api/inspections/${id}/report-data`, {
    token
  })]);
  const inspBody = inspRes.ok ? await inspRes.json() : {};
  const resultsBody = resultsRes.ok ? await resultsRes.json() : {};
  const reportBody = reportRes.ok ? await reportRes.json() : {};
  const data = inspBody.data ?? {};
  const inspection = (data == null ? void 0 : data.inspection) || {
    id,
    propertyAddress: "Loading...",
    status: "draft"
  };
  const schema = (data == null ? void 0 : data.templateSnapshot) || ((_a = data == null ? void 0 : data.template) == null ? void 0 : _a.schema) || {
    sections: []
  };
  const rdData = reportBody.data ?? {};
  const reportSections = (rdData == null ? void 0 : rdData.sections) || [];
  if (reportSections.length > 0) {
    schema.sections = reportSections.map((sec) => {
      const s = {
        ...sec
      };
      if (!s.title && s.name) s.title = s.name;
      if (Array.isArray(s.items)) {
        s.items = s.items.map((item) => {
          const it = {
            ...item
          };
          if (!it.label && it.name) it.label = it.name;
          return it;
        });
      }
      return s;
    });
  }
  const ratingLevels = (rdData == null ? void 0 : rdData.ratingLevels) || [];
  const resultsObj = resultsBody.data ?? {};
  const results = (resultsObj == null ? void 0 : resultsObj.data) || resultsObj || {};
  return {
    inspection,
    schema,
    results,
    ratingLevels,
    token
  };
}
async function action$o({
  request,
  params
}) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "rate") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const rating = String(formData.get("rating"));
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        field: "rating",
        value: rating,
        sectionId
      })
    });
  }
  if (intent === "notes") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const notes = String(formData.get("notes"));
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        field: "notes",
        value: notes,
        sectionId
      })
    });
  }
  if (intent === "toggle-canned") {
    const itemId = String(formData.get("itemId"));
    const sectionId = String(formData.get("sectionId"));
    const tabName = String(formData.get("tabName"));
    const cannedId = String(formData.get("cannedId"));
    const included = formData.get("included") === "true";
    await apiFetch(`/api/inspections/${params.id}/items/${itemId}/field`, {
      method: "PATCH",
      token,
      body: JSON.stringify({
        field: "cannedToggle",
        value: {
          tabName,
          cannedId,
          included
        },
        sectionId
      })
    });
  }
  if (intent === "save-all") {
    const data = formData.get("data");
    if (data) {
      await apiFetch(`/api/inspections/${params.id}/results`, {
        method: "PATCH",
        token,
        body: JSON.stringify({
          data: JSON.parse(String(data))
        })
      });
    }
  }
  return {
    ok: true
  };
}
const inspectionEdit = UNSAFE_withComponentProps(function InspectionEditPage() {
  var _a, _b, _c, _d;
  const loaderData = useLoaderData();
  const fetcher = useFetcher();
  useNavigate();
  const photoInputRef = useRef(null);
  const state = useInspectionState({
    inspection: loaderData.inspection,
    schema: loaderData.schema,
    results: loaderData.results,
    ratingLevels: loaderData.ratingLevels
  });
  const findings = useFindings(state.results, state.setResults, fetcher, {
    sectionIdForItem: state.sectionIdForItem,
    setDirty: state.setDirty,
    setSaveStatus: state.setSaveStatus,
    inspectionId: String(state.inspection.id)
  });
  const comments2 = useCannedComments({
    inspectionId: String(state.inspection.id),
    bucketForRatingId: state.bucketForRatingId
  });
  const offline = useOfflineQueue();
  const {
    blocker,
    confirmLeave,
    cancelLeave
  } = useUnsavedChanges(state.dirty);
  useEffect(() => {
    if (fetcher.state === "submitting") {
      state.setSaveStatus("saving");
    } else if (fetcher.state === "idle" && state.saveStatus === "saving") {
      state.setSaveStatus("saved");
      state.setDirty(false);
      const timer = setTimeout(() => state.setSaveStatus("idle"), 2e3);
      return () => clearTimeout(timer);
    }
  }, [fetcher.state]);
  const handleRating = useCallback((rating) => {
    if (!state.activeItemId || !state.currentSection) return;
    findings.setRating(state.currentSection.id, state.activeItemId, rating);
    setTimeout(() => state.advanceToNextUnrated(), 150);
  }, [state.activeItemId, state.currentSection, findings, state.advanceToNextUnrated]);
  const commentLibraryItems = useMemo(() => comments2.getFilteredComments(state.commentLibraryFilter, state.commentLibrarySearch), [comments2, state.commentLibraryFilter, state.commentLibrarySearch]);
  const toggleSpeedMode = useCallback(() => {
    if (!state.speedMode) {
      const flatItems = [];
      for (let s = 0; s < state.sections.length; s++) {
        const sec = state.sections[s];
        for (let i = 0; i < sec.items.length; i++) {
          const item = sec.items[i];
          const r = state.getResult(item.id, sec.id);
          flatItems.push({
            id: item.id,
            label: item.label || item.name || "",
            sectionName: sec.title || sec.name || "",
            sectionIdx: s,
            itemIdx: i,
            rating: (r == null ? void 0 : r.rating) || null
          });
        }
      }
      const queue = flatItems.map((it, idx) => ({
        idx,
        rating: it.rating
      })).filter((x) => !x.rating).map((x) => x.idx);
      if (queue.length === 0) return;
      state.speedItemsRef.current = flatItems;
      state.setSpeedQueue(queue);
      state.setSpeedCurrent(0);
      state.setSpeedMode(true);
    } else {
      state.setSpeedMode(false);
    }
  }, [state]);
  const speedRate = useCallback((levelIdx) => {
    if (!state.speedMode) return;
    const qi = state.speedQueue[state.speedCurrent];
    if (qi == null) return;
    const item = state.speedItemsRef.current[qi];
    if (!item || !state.ratingLevels[levelIdx]) return;
    const sid = state.sectionIdForItem(item.id);
    if (sid) {
      findings.setRating(sid, item.id, state.ratingLevels[levelIdx].id);
    }
    const newQueue = [...state.speedQueue];
    newQueue.splice(state.speedCurrent, 1);
    state.setSpeedQueue(newQueue);
    if (newQueue.length === 0) {
      setTimeout(() => state.setSpeedMode(false), 1500);
      return;
    }
    if (state.speedCurrent >= newQueue.length) {
      state.setSpeedCurrent(newQueue.length - 1);
    }
  }, [state, findings]);
  const speedItem = useMemo(() => {
    if (!state.speedMode) return null;
    const idx = state.speedQueue[state.speedCurrent];
    return idx != null ? state.speedItemsRef.current[idx] || null : null;
  }, [state.speedMode, state.speedQueue, state.speedCurrent]);
  const handlePhotoUpload = useCallback(async (e) => {
    var _a2;
    const file = (_a2 = e.target.files) == null ? void 0 : _a2[0];
    if (!file || !state.activeItemId) return;
    const formData = new FormData();
    formData.append("file", file);
    formData.append("itemId", state.activeItemId);
    try {
      const res = await fetch(`/api/inspections/${state.inspection.id}/upload`, {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      if (res.ok) {
        const json = await res.json();
        findings.addPhotoToItem(state.activeItemId, json.data.key);
      }
    } catch {
    }
    if (photoInputRef.current) photoInputRef.current.value = "";
  }, [state.activeItemId, state.inspection.id, findings]);
  const handleBurstCommit = useCallback(async (blobs) => {
    if (!state.burstCameraItemId) return;
    for (const blob of blobs) {
      const formData = new FormData();
      formData.append("file", blob, `burst-${Date.now()}.jpg`);
      formData.append("itemId", state.burstCameraItemId);
      try {
        const res = await fetch(`/api/inspections/${state.inspection.id}/upload`, {
          method: "POST",
          body: formData,
          credentials: "include"
        });
        if (res.ok) {
          const json = await res.json();
          findings.addPhotoToItem(state.burstCameraItemId, json.data.key);
        }
      } catch {
      }
    }
  }, [state.burstCameraItemId, state.inspection.id, findings]);
  const keyboardHandlers = useMemo(() => ({
    onRate: (level) => {
      if (state.activeItemId && state.currentSection && state.ratingLevels[level - 1]) {
        handleRating(state.ratingLevels[level - 1].id);
      }
    },
    onClearRating: () => {
      if (state.activeItemId && state.currentSection) {
        findings.setRating(state.currentSection.id, state.activeItemId, null);
      }
    },
    onNARating: () => {
      if (!state.activeItemId || !state.currentSection) return;
      const naLevel = state.ratingLevels.find((l) => {
        const ab = (l.abbreviation || "").toUpperCase();
        const nm = (l.name || l.label || "").toLowerCase();
        return ab === "NA" || ab === "N/A" || nm.includes("not applicable");
      });
      if (naLevel) {
        handleRating(naLevel.id);
      }
    },
    onNextItem: () => state.navigateItem(1),
    onPrevItem: () => state.navigateItem(-1),
    onToggleSpeed: toggleSpeedMode,
    speedMode: state.speedMode,
    onSpeedRate: speedRate,
    onSpeedNext: () => {
      if (state.speedCurrent < state.speedQueue.length - 1) {
        state.setSpeedCurrent(state.speedCurrent + 1);
      } else {
        state.setSpeedCurrent(0);
      }
    },
    onSpeedPrev: () => {
      if (state.speedCurrent > 0) {
        state.setSpeedCurrent(state.speedCurrent - 1);
      }
    },
    onSpeedOpenEditor: () => {
      if (!state.speedMode) return;
      const qi = state.speedQueue[state.speedCurrent];
      if (qi == null) return;
      const item = state.speedItemsRef.current[qi];
      if (!item) return;
      state.setSpeedMode(false);
      state.setActiveItemId(item.id);
      state.setCurrentSectionIdx(item.sectionIdx);
    },
    onOpenLibrary: () => {
      if (!state.activeItemId) return;
      const r = state.getResult(state.activeItemId);
      state.setCommentLibraryFilter(state.bucketForRatingId(r == null ? void 0 : r.rating));
      state.setCommentLibrarySearch("");
      state.setCommentLibrarySelectedIdx(0);
      state.setShowCommentLibrary(true);
    },
    onOpenSnippets: () => {
      if (!state.activeItemId) return;
      state.setCommentLibraryFilter("my-snippets");
      state.setCommentLibrarySearch("");
      state.setCommentLibrarySelectedIdx(0);
      state.setShowCommentLibrary(true);
    },
    showCommentLibrary: state.showCommentLibrary,
    onLibraryDown: () => {
      state.setCommentLibrarySelectedIdx(Math.min(state.commentLibrarySelectedIdx + 1, commentLibraryItems.length - 1));
    },
    onLibraryUp: () => {
      state.setCommentLibrarySelectedIdx(Math.max(state.commentLibrarySelectedIdx - 1, 0));
    },
    onLibrarySelect: () => {
      const sel = commentLibraryItems[state.commentLibrarySelectedIdx];
      if (sel && state.activeItemId && state.currentSection) {
        findings.insertComment(state.currentSection.id, state.activeItemId, sel.text);
        state.setShowCommentLibrary(false);
      }
    },
    onLibraryClose: () => state.setShowCommentLibrary(false),
    onPhoto: () => {
      var _a2;
      if (!state.activeItemId) return;
      (_a2 = photoInputRef.current) == null ? void 0 : _a2.click();
    },
    onSave: () => findings.saveNow(),
    onPublish: () => state.setShowPublishModal(true),
    onRepeatRating: () => {
      if (!state.activeItemId || !state.currentSection) return;
      findings.repeatPreviousRating(state.currentSection.id, state.activeItemId, state.currentSectionItems);
    },
    onSaveAsSnippet: () => {
      var _a2;
      if (!state.activeItemId) return;
      const r = state.getResult(state.activeItemId);
      const notes = ((r == null ? void 0 : r.notes) || "").trim();
      if (!notes) return;
      const bucket = state.bucketForRatingId(r == null ? void 0 : r.rating);
      const section = ((_a2 = state.currentSection) == null ? void 0 : _a2.title) || "";
      comments2.saveSnippet(notes, bucket, section);
    },
    onToggleCheatsheet: () => state.setShowCheatsheet(!state.showCheatsheet),
    onGotoSection: (idx) => {
      if (idx >= 0 && idx < state.sections.length) {
        state.selectSection(idx);
      }
    },
    onOpenSectionPicker: () => state.openSectionPicker(),
    onOpenTagPicker: () => {
    },
    onSetViewMode: (mode) => {
      if (mode === "preview") {
        window.open(`/inspections/${state.inspection.id}/preview`, "_blank");
        return;
      }
      state.setViewMode(mode);
    }
  }), [state, findings, handleRating, toggleSpeedMode, speedRate, comments2, commentLibraryItems]);
  useKeyboard(keyboardHandlers, true);
  const visibleItems = useMemo(() => {
    return state.currentSectionItems.filter((item) => {
      var _a2;
      if (!state.itemPassesFilter(item, (_a2 = state.currentSection) == null ? void 0 : _a2.id)) return false;
      if (state.searchNeedle && !state.itemMatchesSearch(state.currentSection, item)) return false;
      return true;
    });
  }, [state]);
  return /* @__PURE__ */ jsxs("div", {
    className: "flex h-screen bg-ih-bg-card",
    children: [/* @__PURE__ */ jsx("input", {
      ref: photoInputRef,
      type: "file",
      accept: "image/*",
      capture: "environment",
      className: "hidden",
      onChange: handlePhotoUpload
    }), state.speedMode && speedItem && /* @__PURE__ */ jsx(SpeedMode, {
      item: {
        id: speedItem.id,
        label: speedItem.label,
        type: "rich"
      },
      sectionTitle: speedItem.sectionName,
      result: state.getResult(speedItem.id),
      onRating: (rating) => {
        const levelIdx = state.ratingLevels.findIndex((l) => l.id === rating);
        if (levelIdx >= 0) speedRate(levelIdx);
      },
      onPrev: () => {
        if (state.speedCurrent > 0) state.setSpeedCurrent(state.speedCurrent - 1);
      },
      onNext: () => {
        if (state.speedCurrent < state.speedQueue.length - 1) state.setSpeedCurrent(state.speedCurrent + 1);
      },
      onExit: () => state.setSpeedMode(false),
      currentIndex: state.speedCurrent,
      totalCount: state.speedQueue.length
    }), state.showCheatsheet && /* @__PURE__ */ jsx(KeyboardHud, {}), /* @__PURE__ */ jsx(BurstCamera, {
      open: state.burstCameraOpen,
      onClose: () => {
        state.setBurstCameraOpen(false);
        state.setBurstCameraItemId(null);
      },
      onCommit: handleBurstCommit
    }), /* @__PURE__ */ jsx(InspectionSettingsSheet, {
      open: state.settingsOpen,
      onClose: () => state.setSettingsOpen(false),
      inspectionId: String(state.inspection.id)
    }), blocker.state === "blocked" && /* @__PURE__ */ jsxs("div", {
      className: "fixed inset-0 z-[200] flex items-center justify-center p-4",
      children: [/* @__PURE__ */ jsx("div", {
        className: "absolute inset-0 bg-slate-900/60 backdrop-blur-sm",
        onClick: cancelLeave
      }), /* @__PURE__ */ jsxs("div", {
        className: "relative bg-ih-bg-card rounded-lg shadow-xl p-6 max-w-sm w-full",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[15px] font-bold text-ih-fg-1",
          children: "Unsaved changes"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-2",
          children: "You have unsaved changes. Are you sure you want to leave?"
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2 mt-4",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: cancelLeave,
            className: "px-4 py-2 text-[13px] font-bold text-slate-600 hover:bg-slate-100 rounded-md",
            children: "Stay"
          }), /* @__PURE__ */ jsx("button", {
            onClick: confirmLeave,
            className: "px-4 py-2 text-[13px] font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-md",
            children: "Leave"
          })]
        })]
      })]
    }), state.showCommentLibrary && /* @__PURE__ */ jsxs("div", {
      className: "fixed inset-0 z-[80] flex",
      children: [/* @__PURE__ */ jsx("div", {
        className: "absolute inset-0 bg-slate-900/40 backdrop-blur-sm",
        onClick: () => state.setShowCommentLibrary(false)
      }), /* @__PURE__ */ jsxs("div", {
        className: "relative ml-auto w-full max-w-md bg-ih-bg-card border-l border-ih-border shadow-2xl flex flex-col h-full",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between px-4 py-3 border-b border-ih-border",
          children: [/* @__PURE__ */ jsx("h3", {
            className: "text-[14px] font-bold",
            children: "Comment Library"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => state.setShowCommentLibrary(false),
            className: "text-slate-400 hover:text-slate-600 text-lg",
            children: "✕"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex gap-1 px-4 py-2 border-b border-ih-border flex-wrap",
          children: [{
            id: "all",
            label: "All"
          }, {
            id: "satisfactory",
            label: "Satisfactory"
          }, {
            id: "monitor",
            label: "Monitor"
          }, {
            id: "defect",
            label: "Defect"
          }, {
            id: "my-snippets",
            label: "My Snippets"
          }].map((f) => /* @__PURE__ */ jsx("button", {
            onClick: () => {
              state.setCommentLibraryFilter(f.id);
              state.setCommentLibrarySelectedIdx(0);
            },
            className: `px-2.5 py-1 rounded-full text-[11px] font-bold ${state.commentLibraryFilter === f.id ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300" : "text-slate-400 hover:text-slate-600"}`,
            children: f.label
          }, f.id))
        }), /* @__PURE__ */ jsxs("div", {
          className: "px-4 py-2",
          children: [/* @__PURE__ */ jsx("input", {
            id: "comment-library-search",
            type: "text",
            placeholder: "Search comments...",
            value: state.commentLibrarySearch,
            onChange: (e) => {
              state.setCommentLibrarySearch(e.target.value);
              state.setCommentLibrarySelectedIdx(0);
            },
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-app text-[12px]",
            autoFocus: true
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[10px] text-slate-400 mt-1",
            children: [commentLibraryItems.length, " comments"]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex-1 overflow-y-auto px-4 space-y-1 pb-4",
          children: [commentLibraryItems.map((entry2, idx) => /* @__PURE__ */ jsxs("button", {
            onClick: () => {
              if (state.activeItemId && state.currentSection) {
                findings.insertComment(state.currentSection.id, state.activeItemId, entry2.text);
                state.setShowCommentLibrary(false);
              }
            },
            className: `w-full text-left p-2.5 rounded-lg text-[12px] transition-colors ${idx === state.commentLibrarySelectedIdx ? "bg-ih-primary-tint ring-1 ring-indigo-200 dark:ring-indigo-700" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`,
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-2 leading-relaxed",
              children: entry2.text
            }), entry2.section && /* @__PURE__ */ jsx("span", {
              className: "block text-[10px] text-slate-400 mt-0.5",
              children: entry2.section
            })]
          }, `${entry2.text.slice(0, 30)}-${idx}`)), commentLibraryItems.length === 0 && /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-slate-400 text-center py-8",
            children: "No comments match the current filter."
          })]
        })]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "fixed top-0 left-0 right-0 z-50",
      children: /* @__PURE__ */ jsxs("div", {
        className: "h-14 bg-ih-bg-card border-b border-ih-border flex items-center px-4 gap-3",
        children: [/* @__PURE__ */ jsx("a", {
          href: "/dashboard",
          className: "w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800",
          children: /* @__PURE__ */ jsx("svg", {
            className: "w-4 h-4",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M19 12H5M12 19l-7-7 7-7"
            })
          })
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex-1 min-w-0",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-[14px] font-bold truncate",
            children: state.inspection.propertyAddress || "Inspection"
          }), /* @__PURE__ */ jsxs("div", {
            className: "text-[11px] text-ih-fg-3 truncate",
            children: ["#", String(state.inspection.id).slice(0, 8).toUpperCase(), state.formattedDate && /* @__PURE__ */ jsx("span", {
              className: "ml-2",
              children: state.formattedDate
            })]
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "hidden lg:flex items-center",
          children: /* @__PURE__ */ jsx("input", {
            type: "text",
            placeholder: "Search report...",
            value: state.searchQuery,
            onChange: (e) => state.setSearchQuery(e.target.value),
            className: "w-44 h-8 px-3 rounded-md border border-ih-border bg-ih-bg-app text-[12px]"
          })
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-2",
          children: [/* @__PURE__ */ jsx("div", {
            className: "w-24 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden",
            children: /* @__PURE__ */ jsx("div", {
              className: "h-full bg-ih-primary dark:bg-indigo-500 rounded-full transition-all duration-300",
              style: {
                width: `${state.progress.pct}%`
              }
            })
          }), /* @__PURE__ */ jsxs("span", {
            className: "text-[11px] font-mono text-ih-fg-3 whitespace-nowrap",
            children: [state.progress.rated, "/", state.progress.total]
          })]
        }), state.saveStatus !== "idle" && /* @__PURE__ */ jsx("span", {
          className: `inline-flex items-center gap-1.5 text-[11px] font-bold ${state.saveStatus === "saving" ? "text-ih-watch" : state.saveStatus === "saved" ? "text-ih-ok" : "text-ih-bad"}`,
          children: state.saveStatus === "saving" ? /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsx("span", {
              className: "w-1.5 h-1.5 rounded-full bg-ih-watch-bg0 animate-pulse"
            }), "Saving..."]
          }) : state.saveStatus === "saved" ? /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsx("svg", {
              className: "w-3.5 h-3.5",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ jsx("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: 2,
                d: "M5 13l4 4L19 7"
              })
            }), "Saved"]
          }) : /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsx("span", {
              className: "w-1.5 h-1.5 rounded-full bg-ih-bad-bg0"
            }), "Error"]
          })
        }), /* @__PURE__ */ jsx("span", {
          className: "px-2 h-7 rounded-md text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset bg-slate-100 text-slate-600 ring-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:ring-slate-600 inline-flex items-center",
          children: state.inspection.status
        }), /* @__PURE__ */ jsx("button", {
          onClick: () => state.setSettingsOpen(true),
          className: "w-9 h-9 rounded-md flex items-center justify-center text-ih-fg-3 hover:bg-slate-100 dark:hover:bg-slate-800",
          title: "Inspection settings",
          children: /* @__PURE__ */ jsxs("svg", {
            className: "w-4 h-4",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: [/* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            }), /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            })]
          })
        }), /* @__PURE__ */ jsxs("button", {
          onClick: () => state.setShowPublishModal(true),
          className: "h-9 px-4 rounded-md bg-emerald-600 text-white font-bold text-[12px] hover:bg-emerald-700 transition-colors inline-flex items-center gap-1.5",
          children: [/* @__PURE__ */ jsx("svg", {
            className: "w-3.5 h-3.5",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            })
          }), "Publish"]
        })]
      })
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex flex-1 pt-14 pb-9",
      children: [/* @__PURE__ */ jsx(SectionRail, {
        sections: state.sections,
        activeSection: ((_a = state.currentSection) == null ? void 0 : _a.id) || "",
        onSelect: (id) => {
          state.selectSectionById(id);
        },
        results: state.results
      }), state.activeView === "property" ? /* @__PURE__ */ jsx("div", {
        className: "w-[280px] flex-shrink-0 border-r border-ih-border overflow-y-auto",
        children: /* @__PURE__ */ jsx(PropertyInfoForm, {
          inspection: state.inspection,
          onSave: (fieldId, value) => {
            state.setInspection((prev) => ({
              ...prev,
              [fieldId]: value
            }));
          }
        })
      }) : /* @__PURE__ */ jsx(ItemList, {
        items: visibleItems,
        sectionId: ((_b = state.currentSection) == null ? void 0 : _b.id) || "",
        activeItemId: state.activeItemId,
        onSelect: (id) => state.setActiveItemId(id),
        results: state.results
      }), /* @__PURE__ */ jsx("main", {
        className: "flex-1 overflow-y-auto border-t-2 border-indigo-600 p-6",
        children: state.activeItemId ? /* @__PURE__ */ jsx(ItemEditor, {
          item: state.activeItem || void 0,
          sectionTitle: (_c = state.currentSection) == null ? void 0 : _c.title,
          result: state.activeItemId ? findings.getResult(state.activeItemId, (_d = state.currentSection) == null ? void 0 : _d.id) : {},
          onRating: handleRating,
          onNotes: (notes) => {
            if (state.activeItemId && state.currentSection) {
              findings.setNotes(state.currentSection.id, state.activeItemId, notes);
            }
          },
          onNotesBlur: (notes) => {
            if (state.activeItemId && state.currentSection) {
              findings.commitNotes(state.currentSection.id, state.activeItemId, notes);
            }
          },
          onToggleCanned: (tabName, cannedId, included) => {
            if (state.activeItemId && state.currentSection) {
              findings.toggleCannedComment(state.currentSection.id, state.activeItemId, tabName, cannedId, included);
            }
          }
        }) : /* @__PURE__ */ jsx("div", {
          className: "flex items-center justify-center h-full text-slate-400",
          children: /* @__PURE__ */ jsxs("div", {
            className: "text-center",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px]",
              children: "Select an item from the list to start editing"
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-[11px] mt-2 text-slate-300",
              children: ["Press ", /* @__PURE__ */ jsx("kbd", {
                className: "px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border",
                children: "J"
              }), " / ", /* @__PURE__ */ jsx("kbd", {
                className: "px-1.5 py-0.5 bg-ih-bg-muted rounded text-[10px] font-mono border",
                children: "K"
              }), " to navigate"]
            })]
          })
        })
      }), /* @__PURE__ */ jsx(SideRail, {
        activeItem: state.activeItem
      })]
    }), /* @__PURE__ */ jsx(FooterBar, {}), /* @__PURE__ */ jsx(InspectorToolsDock, {
      onToggleSpeedMode: toggleSpeedMode,
      onBurstCamera: (itemId) => {
        state.setBurstCameraItemId(itemId || state.activeItemId || null);
        state.setBurstCameraOpen(true);
      },
      onPhotoStudio: () => {
      },
      onToggleCheatsheet: () => state.setShowCheatsheet(!state.showCheatsheet),
      activeItemId: state.activeItemId || void 0,
      hidden: state.speedMode
    }), !offline.online && /* @__PURE__ */ jsxs("div", {
      className: "fixed top-14 left-0 right-0 z-40 bg-ih-watch-bg border-b border-ih-watch px-4 py-2 text-center",
      children: [/* @__PURE__ */ jsx("span", {
        className: "text-[12px] font-bold text-ih-watch-fg",
        children: "You are offline. Changes will sync when you reconnect."
      }), offline.pendingCount > 0 && /* @__PURE__ */ jsxs("span", {
        className: "text-[11px] text-ih-watch-fg ml-2",
        children: ["(", offline.pendingCount, " pending)"]
      })]
    })]
  });
});
const route4 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$o,
  default: inspectionEdit,
  loader: loader$$,
  meta: meta$X
}, Symbol.toStringTag, { value: "Module" }));
function meta$W() {
  return [{
    title: "Edit Template - OpenInspection"
  }];
}
const RATING_PRESETS = [{
  name: "Standard 3-Level",
  levels: [{
    id: "S",
    label: "Satisfactory",
    abbreviation: "S",
    color: "#22c55e",
    severity: "good",
    isDefect: false,
    default: true,
    description: "Item is functioning as intended."
  }, {
    id: "M",
    label: "Monitor",
    abbreviation: "M",
    color: "#f59e0b",
    severity: "marginal",
    isDefect: false,
    default: false,
    description: "Functional but warrants periodic re-inspection."
  }, {
    id: "D",
    label: "Defect",
    abbreviation: "D",
    color: "#ef4444",
    severity: "significant",
    isDefect: true,
    default: false,
    description: "Broken or unsafe; recommend repair."
  }]
}, {
  name: "Standard 5-Level",
  levels: [{
    id: "S",
    label: "Satisfactory",
    abbreviation: "Sat",
    color: "#22c55e",
    severity: "good",
    isDefect: false,
    default: true,
    description: "Item is functioning as intended."
  }, {
    id: "M",
    label: "Monitor",
    abbreviation: "Mon",
    color: "#f59e0b",
    severity: "marginal",
    isDefect: false,
    default: false,
    description: "Functional but shows wear."
  }, {
    id: "D",
    label: "Defect",
    abbreviation: "D",
    color: "#ef4444",
    severity: "significant",
    isDefect: true,
    default: false,
    description: "Broken or unsafe."
  }, {
    id: "NI",
    label: "Not Inspected",
    abbreviation: "NI",
    color: "#9ca3af",
    severity: "minor",
    isDefect: false,
    default: false,
    description: "Could not be inspected."
  }, {
    id: "NP",
    label: "Not Present",
    abbreviation: "NP",
    color: "#6b7280",
    severity: "minor",
    isDefect: false,
    default: false,
    description: "Not present at this property."
  }]
}, {
  name: "TREC",
  levels: [{
    id: "I",
    label: "Inspected",
    abbreviation: "I",
    color: "#22c55e",
    severity: "good",
    isDefect: false,
    default: true,
    description: "Meets Texas Standards of Practice."
  }, {
    id: "D",
    label: "Deficient",
    abbreviation: "D",
    color: "#ef4444",
    severity: "significant",
    isDefect: true,
    default: false,
    description: "Deficiencies warrant repair."
  }, {
    id: "NI",
    label: "Not Inspected",
    abbreviation: "NI",
    color: "#9ca3af",
    severity: "minor",
    isDefect: false,
    default: false,
    description: "Not inspected per Standards."
  }, {
    id: "NP",
    label: "Not Present",
    abbreviation: "NP",
    color: "#6b7280",
    severity: "minor",
    isDefect: false,
    default: false,
    description: "Not present."
  }, {
    id: "INR",
    label: "In Need of Repair",
    abbreviation: "INR",
    color: "#f97316",
    severity: "significant",
    isDefect: true,
    default: false,
    description: "Requires repair."
  }]
}];
const ITEM_TYPES = ["rich", "boolean", "text", "textarea", "number", "select", "multi_select", "date", "photo_only"];
async function loader$_({
  request,
  params
}) {
  const token = await requireToken(request);
  const id = params.id;
  const res = await apiFetch(`/api/inspections/templates/${id}`, {
    token
  });
  const body = res.ok ? await res.json() : {};
  const raw = body.data ?? {};
  const tpl = (raw == null ? void 0 : raw.template) ? raw.template : raw;
  const name = (tpl == null ? void 0 : tpl.name) || "Untitled Template";
  const version = (tpl == null ? void 0 : tpl.version) || 1;
  let schema = (tpl == null ? void 0 : tpl.schema) || {
    schemaVersion: 2,
    sections: []
  };
  if (typeof schema === "string") {
    try {
      schema = JSON.parse(schema);
    } catch {
      schema = {
        schemaVersion: 2,
        sections: []
      };
    }
  }
  if (schema.sections) {
    schema.sections = schema.sections.map((sec) => {
      const s = {
        ...sec
      };
      if (!s.title && s.name) {
        s.title = s.name;
      }
      if (s.items) {
        s.items = s.items.map((item) => {
          const it = {
            ...item
          };
          if (!it.label && it.name) {
            it.label = it.name;
          }
          return it;
        });
      }
      return s;
    });
  }
  return {
    id,
    name,
    version,
    schema,
    token
  };
}
async function action$n({
  request,
  params
}) {
  var _a;
  const token = await requireToken(request);
  const formData = await request.formData();
  const name = formData.get("name");
  const schemaStr = formData.get("schema");
  if (!schemaStr) return {
    error: "No schema"
  };
  const res = await apiFetch(`/api/inspections/templates/${params.id}`, {
    token,
    method: "PUT",
    body: JSON.stringify({
      name,
      schema: JSON.parse(schemaStr)
    })
  });
  if (res.ok) {
    const data = await res.json();
    const newVersion = (data == null ? void 0 : data.data) ? (_a = data.data) == null ? void 0 : _a.version : null;
    return {
      ok: true,
      version: newVersion
    };
  }
  const err = await res.json().catch(() => ({}));
  return {
    error: (err == null ? void 0 : err.message) || "Failed to save"
  };
}
const templateEdit = UNSAFE_withComponentProps(function TemplateEditPage() {
  var _a, _b;
  const {
    id,
    name: initialName,
    version: initialVersion,
    schema: initial
  } = useLoaderData();
  const fetcher = useFetcher();
  const [templateName, setTemplateName] = useState(initialName);
  const [sections, setSections] = useState(initial.sections || []);
  const [ratingSystem, setRatingSystem] = useState(initial.ratingSystem || {
    name: "Standard 5-Level",
    defaultLevelId: "S",
    levels: RATING_PRESETS[1].levels
  });
  const [activeSection, setActiveSection] = useState(0);
  const [editingItem, setEditingItem] = useState(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [rightRail, setRightRail] = useState("properties");
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const [choicesText, setChoicesText] = useState("");
  const [saveSuccess, setSaveSuccess] = useState(false);
  const section = sections[activeSection] || null;
  const fetcherData = fetcher.data;
  useEffect(() => {
    if (fetcherData == null ? void 0 : fetcherData.ok) {
      setSaveSuccess(true);
      const timer = setTimeout(() => setSaveSuccess(false), 2e3);
      return () => clearTimeout(timer);
    }
  }, [fetcherData]);
  function updateSections(fn) {
    setSections((prev) => fn(structuredClone(prev)));
  }
  function addSection() {
    const newId = `sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    updateSections((s) => [...s, {
      id: newId,
      title: "New Section",
      items: []
    }]);
    setActiveSection(sections.length);
  }
  function renameSection(idx, title) {
    updateSections((s) => {
      s[idx].title = title;
      return s;
    });
  }
  function removeSection(idx) {
    updateSections((s) => {
      s.splice(idx, 1);
      return s;
    });
    if (activeSection >= sections.length - 1) setActiveSection(Math.max(0, sections.length - 2));
  }
  function moveSection(idx, dir) {
    updateSections((s) => {
      const target = idx + dir;
      if (target < 0 || target >= s.length) return s;
      [s[idx], s[target]] = [s[target], s[idx]];
      return s;
    });
    setActiveSection(Math.max(0, Math.min(sections.length - 1, activeSection + dir)));
  }
  function addItem() {
    if (!section) return;
    const itemId = `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    updateSections((s) => {
      s[activeSection].items.push({
        id: itemId,
        label: "New Item",
        type: "rich",
        ratingOptions: ["Inspected", "Not Inspected", "Not Present", "Repair", "Safety Hazard"],
        tabs: {
          information: [],
          limitations: [],
          defects: []
        },
        options: {
          choices: []
        }
      });
      return s;
    });
    setEditingItem(itemId);
    setRightRail("properties");
  }
  function removeItem(itemId) {
    updateSections((s) => {
      s[activeSection].items = s[activeSection].items.filter((i) => i.id !== itemId);
      return s;
    });
    if (editingItem === itemId) setEditingItem(null);
  }
  function moveItem(itemIdx, dir) {
    updateSections((s) => {
      const items = s[activeSection].items;
      const target = itemIdx + dir;
      if (target < 0 || target >= items.length) return s;
      [items[itemIdx], items[target]] = [items[target], items[itemIdx]];
      return s;
    });
  }
  function updateItem(itemId, patch) {
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === itemId);
      if (item) Object.assign(item, patch);
      return s;
    });
  }
  function addCannedToItem(tab) {
    if (!editingItem || !section) return;
    updateSections((s) => {
      const item = s[activeSection].items.find((i) => i.id === editingItem);
      if (!item || item.type !== "rich") return s;
      if (!item.tabs) item.tabs = {
        information: [],
        limitations: [],
        defects: []
      };
      const prefix = tab === "defects" ? "rd_" : tab === "limitations" ? "rl_" : "ri_";
      const newId = `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const entry2 = {
        id: newId,
        title: "New entry",
        comment: "",
        default: false
      };
      if (tab === "defects") {
        entry2.category = "recommendation";
        entry2.location = "";
        entry2.photos = [];
      }
      item.tabs[tab].push(entry2);
      return s;
    });
  }
  function removeCannedFromItem(tab, idx) {
    if (!editingItem || !section) return;
    updateSections((s) => {
      var _a2;
      const item = s[activeSection].items.find((i) => i.id === editingItem);
      if (!((_a2 = item == null ? void 0 : item.tabs) == null ? void 0 : _a2[tab])) return s;
      item.tabs[tab].splice(idx, 1);
      return s;
    });
  }
  function applyPreset(preset) {
    var _a2, _b2;
    setRatingSystem({
      name: preset.name,
      defaultLevelId: ((_a2 = preset.levels.find((l) => l.default)) == null ? void 0 : _a2.id) || ((_b2 = preset.levels[0]) == null ? void 0 : _b2.id),
      levels: structuredClone(preset.levels)
    });
  }
  function addRatingLevel() {
    setRatingSystem((prev) => ({
      ...prev,
      levels: [...prev.levels, {
        id: "NEW",
        label: "New Level",
        abbreviation: "",
        color: "#6b7280",
        severity: "minor",
        isDefect: false,
        default: false,
        description: ""
      }]
    }));
  }
  function toV2Payload() {
    return {
      schemaVersion: 2,
      sections: sections.map((s) => {
        var _a2;
        return {
          id: s.id,
          title: s.title,
          ...s.icon ? {
            icon: s.icon
          } : {},
          ...s.identifier ? {
            identifier: s.identifier
          } : {},
          ...s.disclaimerText ? {
            disclaimerText: s.disclaimerText
          } : {},
          ...s.alwaysPageBreak ? {
            alwaysPageBreak: true
          } : {},
          ...((_a2 = s.source) == null ? void 0 : _a2.platform) ? {
            source: s.source
          } : {},
          items: s.items.map((it) => {
            var _a3, _b2, _c, _d, _e, _f, _g;
            const base = {
              id: it.id,
              label: it.label,
              type: it.type
            };
            if (it.description) base.description = it.description;
            if (it.icon) base.icon = it.icon;
            if (typeof it.required === "boolean") base.required = it.required;
            if (typeof it.isSafety === "boolean") base.isSafety = it.isSafety;
            if (it.defaultRecommendation) base.defaultRecommendation = it.defaultRecommendation;
            if ((_a3 = it.attributes) == null ? void 0 : _a3.length) base.attributes = it.attributes;
            if ((_b2 = it.source) == null ? void 0 : _b2.platform) base.source = it.source;
            if (it.type === "rich") {
              base.ratingOptions = ((_c = it.ratingOptions) == null ? void 0 : _c.length) ? it.ratingOptions : ["Inspected"];
              base.tabs = {
                information: (((_d = it.tabs) == null ? void 0 : _d.information) || []).map((c) => ({
                  id: c.id,
                  title: c.title || "",
                  comment: c.comment || "",
                  default: !!c.default
                })),
                limitations: (((_e = it.tabs) == null ? void 0 : _e.limitations) || []).map((c) => ({
                  id: c.id,
                  title: c.title || "",
                  comment: c.comment || "",
                  default: !!c.default
                })),
                defects: (((_f = it.tabs) == null ? void 0 : _f.defects) || []).map((c) => ({
                  id: c.id,
                  title: c.title || "",
                  category: c.category || "recommendation",
                  location: c.location || "",
                  comment: c.comment || "",
                  photos: Array.isArray(c.photos) ? c.photos : [],
                  default: !!c.default
                }))
              };
            } else if (it.type !== "boolean" && it.type !== "date" && it.options) {
              const o = {};
              if ((_g = it.options.choices) == null ? void 0 : _g.length) o.choices = it.options.choices;
              if (it.options.min != null) o.min = it.options.min;
              if (it.options.max != null) o.max = it.options.max;
              if (it.options.placeholder) o.placeholder = it.options.placeholder;
              if (Object.keys(o).length) base.options = o;
            }
            return base;
          })
        };
      }),
      ratingSystem: ratingSystem.levels.length ? {
        ...ratingSystem.name ? {
          name: ratingSystem.name
        } : {},
        ...ratingSystem.defaultLevelId ? {
          defaultLevelId: ratingSystem.defaultLevelId
        } : {},
        levels: ratingSystem.levels.map((l) => {
          const lv = {
            id: l.id,
            label: l.label
          };
          if (l.abbreviation) lv.abbreviation = l.abbreviation;
          if (l.color) lv.color = l.color;
          if (l.severity) lv.severity = l.severity;
          if (typeof l.isDefect === "boolean") lv.isDefect = l.isDefect;
          if (typeof l.default === "boolean") lv.default = l.default;
          if (l.description) lv.description = l.description;
          return lv;
        })
      } : void 0
    };
  }
  function handleSave() {
    fetcher.submit({
      name: templateName,
      schema: JSON.stringify(toV2Payload())
    }, {
      method: "post"
    });
  }
  const selectedItem = (section == null ? void 0 : section.items.find((i) => i.id === editingItem)) || null;
  useEffect(() => {
    var _a2;
    if ((_a2 = selectedItem == null ? void 0 : selectedItem.options) == null ? void 0 : _a2.choices) {
      setChoicesText(selectedItem.options.choices.join("\n"));
    } else {
      setChoicesText("");
    }
  }, [editingItem]);
  return /* @__PURE__ */ jsxs("div", {
    className: "flex flex-col h-screen bg-[#f8fafc] dark:bg-[#0f172a]",
    children: [/* @__PURE__ */ jsxs("header", {
      className: "flex items-center justify-between h-12 px-4 border-b border-ih-border bg-ih-bg-card shrink-0",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3",
        children: [/* @__PURE__ */ jsx(Link, {
          to: "/templates",
          className: "text-ih-fg-4 hover:text-ih-fg-2 text-[13px]",
          children: "← Templates"
        }), /* @__PURE__ */ jsx("input", {
          value: templateName,
          onChange: (e) => setTemplateName(e.target.value),
          className: "text-[14px] font-bold bg-transparent border-b border-transparent focus:border-ih-primary outline-none text-ih-fg-1 w-48"
        }), /* @__PURE__ */ jsxs("span", {
          className: "text-[10px] font-mono text-ih-fg-4",
          children: ["v", initialVersion]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2",
        children: [/* @__PURE__ */ jsx("button", {
          onClick: () => setPreviewMode(!previewMode),
          className: `h-7 px-3 rounded-md text-[12px] font-bold transition-colors ${previewMode ? "bg-ih-watch-bg text-ih-watch-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
          children: previewMode ? "Exit Preview" : "Preview"
        }), /* @__PURE__ */ jsx("button", {
          onClick: () => setRatingModalOpen(true),
          className: "h-7 px-3 rounded-md bg-ih-bg-muted text-ih-fg-3 text-[12px] font-bold",
          children: "Rating System"
        }), /* @__PURE__ */ jsx("button", {
          onClick: handleSave,
          className: "h-7 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600",
          children: fetcher.state === "submitting" ? "Saving..." : saveSuccess ? "Saved!" : "Save"
        })]
      })]
    }), (fetcherData == null ? void 0 : fetcherData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2 bg-ih-bad-bg text-ih-bad-fg text-[12px] font-medium",
      children: fetcherData.error
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex flex-1 overflow-hidden",
      children: [/* @__PURE__ */ jsx("aside", {
        className: "w-[200px] shrink-0 border-r border-ih-border bg-ih-bg-muted overflow-y-auto",
        children: /* @__PURE__ */ jsxs("div", {
          className: "p-2 space-y-0.5",
          children: [sections.map((s, i) => /* @__PURE__ */ jsxs("div", {
            className: `group flex items-center rounded-md transition-all ${i === activeSection ? "bg-ih-primary-tint" : "hover:bg-ih-bg-muted"}`,
            children: [/* @__PURE__ */ jsxs("button", {
              onClick: () => {
                setActiveSection(i);
                setEditingItem(null);
              },
              className: `flex-1 text-left px-3 py-2 text-[13px] truncate ${i === activeSection ? "text-ih-primary font-bold" : "text-ih-fg-3"}`,
              children: [s.title, /* @__PURE__ */ jsx("span", {
                className: "ml-1 text-[10px] opacity-50",
                children: s.items.length
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "hidden group-hover:flex items-center gap-0.5 pr-1",
              children: [/* @__PURE__ */ jsx("button", {
                onClick: () => moveSection(i, -1),
                className: "text-ih-fg-4 hover:text-ih-fg-2 text-[10px]",
                children: "↑"
              }), /* @__PURE__ */ jsx("button", {
                onClick: () => moveSection(i, 1),
                className: "text-ih-fg-4 hover:text-ih-fg-2 text-[10px]",
                children: "↓"
              }), /* @__PURE__ */ jsx("button", {
                onClick: () => removeSection(i),
                className: "text-ih-fg-4 hover:text-ih-bad-fg text-[10px]",
                children: "×"
              })]
            })]
          }, s.id)), /* @__PURE__ */ jsx("button", {
            onClick: addSection,
            className: "w-full text-left px-3 py-2 text-[12px] font-bold text-ih-primary hover:bg-ih-primary-tint rounded-md",
            children: "+ Add Section"
          })]
        })
      }), /* @__PURE__ */ jsx("div", {
        className: "flex-1 overflow-y-auto p-4",
        children: section ? /* @__PURE__ */ jsxs("div", {
          className: "max-w-2xl mx-auto space-y-3",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2",
            children: [/* @__PURE__ */ jsx("input", {
              value: section.title,
              onChange: (e) => renameSection(activeSection, e.target.value),
              className: "text-[18px] font-bold bg-transparent border-b-2 border-transparent focus:border-ih-primary outline-none flex-1 text-ih-fg-1"
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[11px] text-ih-fg-4",
              children: [section.items.length, " items"]
            })]
          }), /* @__PURE__ */ jsx("input", {
            value: section.disclaimerText || "",
            onChange: (e) => updateSections((s) => {
              s[activeSection].disclaimerText = e.target.value;
              return s;
            }),
            placeholder: "Section disclaimer (optional)",
            className: "w-full text-[12px] text-ih-fg-4 bg-transparent border-b border-transparent focus:border-slate-300 outline-none"
          }), previewMode ? /* @__PURE__ */ jsx("div", {
            className: "space-y-2",
            children: section.items.map((item, idx) => /* @__PURE__ */ jsxs("div", {
              className: "bg-ih-bg-card border border-ih-border rounded-lg p-4",
              children: [/* @__PURE__ */ jsxs("p", {
                className: "text-[13px] font-bold text-ih-fg-1",
                children: [idx + 1, ". ", item.label]
              }), item.description && /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-4 mt-1",
                children: item.description
              }), /* @__PURE__ */ jsxs("div", {
                className: "mt-2",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3",
                  children: item.type
                }), item.type === "rich" && item.ratingOptions && /* @__PURE__ */ jsx("div", {
                  className: "flex gap-1 mt-2",
                  children: item.ratingOptions.map((opt) => /* @__PURE__ */ jsx("span", {
                    className: "text-[10px] px-2 py-0.5 rounded border border-ih-border text-ih-fg-3",
                    children: opt
                  }, opt))
                })]
              })]
            }, item.id))
          }) : /* @__PURE__ */ jsxs(Fragment, {
            children: [section.items.map((item, idx) => /* @__PURE__ */ jsx("div", {
              className: `bg-ih-bg-card border rounded-lg p-3 transition-colors ${editingItem === item.id ? "border-ih-primary shadow-ih-focus" : "border-ih-border"}`,
              children: /* @__PURE__ */ jsxs("div", {
                className: "flex items-center justify-between",
                children: [/* @__PURE__ */ jsxs("div", {
                  className: "flex items-center gap-2 flex-1 min-w-0",
                  children: [/* @__PURE__ */ jsx("span", {
                    className: "text-[10px] font-mono text-ih-fg-4 w-5 cursor-grab",
                    title: "Drag to reorder",
                    children: "☰"
                  }), /* @__PURE__ */ jsx("span", {
                    className: "text-[10px] font-mono text-ih-fg-4 w-5",
                    children: String(idx + 1).padStart(2, "0")
                  }), editingItem === item.id ? /* @__PURE__ */ jsx("input", {
                    value: item.label,
                    onChange: (e) => updateItem(item.id, {
                      label: e.target.value
                    }),
                    autoFocus: true,
                    className: "flex-1 text-[13px] font-medium bg-transparent border-b border-ih-primary outline-none text-ih-fg-1"
                  }) : /* @__PURE__ */ jsx("button", {
                    onClick: () => {
                      setEditingItem(item.id);
                      setRightRail("properties");
                    },
                    className: "flex-1 text-left text-[13px] font-medium text-ih-fg-1 truncate hover:text-ih-primary",
                    children: item.label
                  })]
                }), /* @__PURE__ */ jsxs("div", {
                  className: "flex items-center gap-1 shrink-0 ml-2",
                  children: [/* @__PURE__ */ jsx("select", {
                    value: item.type,
                    onChange: (e) => updateItem(item.id, {
                      type: e.target.value
                    }),
                    className: "h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none",
                    children: ITEM_TYPES.map((t) => /* @__PURE__ */ jsx("option", {
                      value: t,
                      children: t
                    }, t))
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => moveItem(idx, -1),
                    className: "w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]",
                    children: "↑"
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => moveItem(idx, 1),
                    className: "w-5 h-5 text-ih-fg-4 hover:text-ih-fg-2 text-[10px]",
                    children: "↓"
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => removeItem(item.id),
                    className: "w-5 h-5 text-ih-fg-4 hover:text-ih-bad-fg text-[10px]",
                    children: "×"
                  })]
                })]
              })
            }, item.id)), /* @__PURE__ */ jsx("button", {
              onClick: addItem,
              className: "w-full py-2 rounded-lg border-2 border-dashed border-ih-border text-[12px] font-bold text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors",
              children: "+ Add Item"
            })]
          })]
        }) : /* @__PURE__ */ jsx("div", {
          className: "flex items-center justify-center h-full text-[13px] text-ih-fg-4",
          children: "Add a section to get started"
        })
      }), selectedItem && !previewMode && /* @__PURE__ */ jsxs("aside", {
        className: "w-[280px] shrink-0 border-l border-ih-border bg-ih-bg-card overflow-y-auto",
        children: [/* @__PURE__ */ jsx("div", {
          className: "flex border-b border-ih-border",
          children: ["properties", "comments", "preview"].map((tab) => /* @__PURE__ */ jsx("button", {
            onClick: () => setRightRail(tab),
            className: `flex-1 py-2 text-[11px] font-bold capitalize border-b-2 transition-colors ${rightRail === tab ? "border-ih-primary text-ih-primary" : "border-transparent text-ih-fg-4 hover:text-ih-fg-2"}`,
            children: tab
          }, tab))
        }), /* @__PURE__ */ jsxs("div", {
          className: "p-3 space-y-3",
          children: [rightRail === "properties" && /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                children: "Label"
              }), /* @__PURE__ */ jsx("input", {
                value: selectedItem.label,
                onChange: (e) => updateItem(selectedItem.id, {
                  label: e.target.value
                }),
                className: "w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                children: "Description"
              }), /* @__PURE__ */ jsx("textarea", {
                value: selectedItem.description || "",
                onChange: (e) => updateItem(selectedItem.id, {
                  description: e.target.value
                }),
                rows: 2,
                className: "w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                children: "Type"
              }), /* @__PURE__ */ jsx("select", {
                value: selectedItem.type,
                onChange: (e) => updateItem(selectedItem.id, {
                  type: e.target.value
                }),
                className: "w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none",
                children: ITEM_TYPES.map((t) => /* @__PURE__ */ jsx("option", {
                  value: t,
                  children: t
                }, t))
              })]
            }), /* @__PURE__ */ jsxs("label", {
              className: "flex items-center gap-2",
              children: [/* @__PURE__ */ jsx("input", {
                type: "checkbox",
                checked: !!selectedItem.required,
                onChange: (e) => updateItem(selectedItem.id, {
                  required: e.target.checked
                }),
                className: "accent-ih-primary"
              }), /* @__PURE__ */ jsx("span", {
                className: "text-[12px] text-ih-fg-3",
                children: "Required"
              })]
            }), /* @__PURE__ */ jsxs("label", {
              className: "flex items-center gap-2",
              children: [/* @__PURE__ */ jsx("input", {
                type: "checkbox",
                checked: !!selectedItem.isSafety,
                onChange: (e) => updateItem(selectedItem.id, {
                  isSafety: e.target.checked
                }),
                className: "accent-ih-primary"
              }), /* @__PURE__ */ jsx("span", {
                className: "text-[12px] text-ih-fg-3",
                children: "Safety item"
              })]
            }), (selectedItem.type === "select" || selectedItem.type === "multi_select") && /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                children: "Choices (one per line)"
              }), /* @__PURE__ */ jsx("textarea", {
                value: choicesText,
                onChange: (e) => {
                  setChoicesText(e.target.value);
                  updateItem(selectedItem.id, {
                    options: {
                      ...selectedItem.options,
                      choices: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean)
                    }
                  });
                },
                rows: 4,
                className: "w-full px-2 py-1 rounded border border-ih-border text-[12px] bg-transparent outline-none font-mono"
              })]
            }), selectedItem.type === "number" && /* @__PURE__ */ jsxs("div", {
              className: "grid grid-cols-2 gap-2",
              children: [/* @__PURE__ */ jsxs("div", {
                children: [/* @__PURE__ */ jsx("label", {
                  className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                  children: "Min"
                }), /* @__PURE__ */ jsx("input", {
                  type: "number",
                  value: ((_a = selectedItem.options) == null ? void 0 : _a.min) ?? "",
                  onChange: (e) => updateItem(selectedItem.id, {
                    options: {
                      ...selectedItem.options,
                      min: e.target.value ? Number(e.target.value) : null
                    }
                  }),
                  className: "w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
                })]
              }), /* @__PURE__ */ jsxs("div", {
                children: [/* @__PURE__ */ jsx("label", {
                  className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                  children: "Max"
                }), /* @__PURE__ */ jsx("input", {
                  type: "number",
                  value: ((_b = selectedItem.options) == null ? void 0 : _b.max) ?? "",
                  onChange: (e) => updateItem(selectedItem.id, {
                    options: {
                      ...selectedItem.options,
                      max: e.target.value ? Number(e.target.value) : null
                    }
                  }),
                  className: "w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
                })]
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1",
                children: "Default recommendation"
              }), /* @__PURE__ */ jsx("input", {
                value: selectedItem.defaultRecommendation || "",
                onChange: (e) => updateItem(selectedItem.id, {
                  defaultRecommendation: e.target.value
                }),
                className: "w-full h-8 px-2 rounded border border-ih-border text-[12px] bg-transparent outline-none"
              })]
            })]
          }), rightRail === "comments" && selectedItem.type === "rich" && /* @__PURE__ */ jsx(Fragment, {
            children: ["information", "limitations", "defects"].map((tab) => {
              var _a2;
              return /* @__PURE__ */ jsxs("div", {
                children: [/* @__PURE__ */ jsxs("div", {
                  className: "flex items-center justify-between mb-1",
                  children: [/* @__PURE__ */ jsx("span", {
                    className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 capitalize",
                    children: tab
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => addCannedToItem(tab),
                    className: "text-[10px] font-bold text-ih-primary hover:text-ih-primary",
                    children: "+ Add"
                  })]
                }), (((_a2 = selectedItem.tabs) == null ? void 0 : _a2[tab]) || []).map((c, ci) => /* @__PURE__ */ jsxs("div", {
                  className: "flex items-start gap-1 mb-1.5",
                  children: [/* @__PURE__ */ jsxs("div", {
                    className: "flex-1",
                    children: [/* @__PURE__ */ jsx("input", {
                      value: c.title,
                      onChange: (e) => {
                        updateSections((s) => {
                          var _a3, _b2;
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if ((_b2 = (_a3 = it == null ? void 0 : it.tabs) == null ? void 0 : _a3[tab]) == null ? void 0 : _b2[ci]) it.tabs[tab][ci].title = e.target.value;
                          return s;
                        });
                      },
                      placeholder: "Title",
                      className: "w-full text-[11px] font-bold bg-transparent border-b border-ih-border outline-none text-ih-fg-2 mb-0.5"
                    }), /* @__PURE__ */ jsx("textarea", {
                      value: c.comment,
                      onChange: (e) => {
                        updateSections((s) => {
                          var _a3, _b2;
                          const it = s[activeSection].items.find((i) => i.id === editingItem);
                          if ((_b2 = (_a3 = it == null ? void 0 : it.tabs) == null ? void 0 : _a3[tab]) == null ? void 0 : _b2[ci]) it.tabs[tab][ci].comment = e.target.value;
                          return s;
                        });
                      },
                      placeholder: "Comment text...",
                      rows: 2,
                      className: "w-full text-[11px] bg-transparent border border-ih-border rounded px-1 py-0.5 outline-none text-ih-fg-3"
                    })]
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => removeCannedFromItem(tab, ci),
                    className: "text-ih-fg-4 hover:text-ih-bad-fg text-[10px] mt-1",
                    children: "×"
                  })]
                }, c.id))]
              }, tab);
            })
          }), rightRail === "preview" && /* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-bold text-ih-fg-1",
              children: selectedItem.label
            }), selectedItem.description && /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3",
              children: selectedItem.description
            }), /* @__PURE__ */ jsx("div", {
              className: "text-[10px] font-bold px-1.5 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 inline-block",
              children: selectedItem.type
            }), selectedItem.type === "rich" && selectedItem.ratingOptions && /* @__PURE__ */ jsx("div", {
              className: "flex flex-wrap gap-1 mt-2",
              children: selectedItem.ratingOptions.map((opt) => /* @__PURE__ */ jsx("span", {
                className: "text-[10px] px-2 py-1 rounded border border-ih-border text-ih-fg-3",
                children: opt
              }, opt))
            }), selectedItem.tabs && selectedItem.type === "rich" && /* @__PURE__ */ jsx("div", {
              className: "space-y-2 mt-3",
              children: ["information", "limitations", "defects"].map((tab) => {
                var _a2;
                const entries = ((_a2 = selectedItem.tabs) == null ? void 0 : _a2[tab]) || [];
                if (entries.length === 0) return null;
                return /* @__PURE__ */ jsxs("div", {
                  children: [/* @__PURE__ */ jsx("p", {
                    className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mb-1 capitalize",
                    children: tab
                  }), entries.map((c) => /* @__PURE__ */ jsxs("p", {
                    className: "text-[11px] text-ih-fg-3 ml-2",
                    children: ["- ", c.title, ": ", c.comment]
                  }, c.id))]
                }, tab);
              })
            })]
          })]
        })]
      })]
    }), ratingModalOpen && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setRatingModalOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-lg bg-ih-bg-card rounded-xl shadow-2xl p-6 max-h-[80vh] overflow-y-auto",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: "Rating System"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setRatingModalOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex flex-wrap gap-2 mb-4",
          children: RATING_PRESETS.map((p) => /* @__PURE__ */ jsx("button", {
            onClick: () => applyPreset(p),
            className: "text-[11px] font-bold px-2.5 py-1 rounded-md border border-ih-border text-ih-fg-3 hover:border-ih-primary hover:text-ih-primary transition-colors",
            children: p.name
          }, p.name))
        }), /* @__PURE__ */ jsx("div", {
          className: "space-y-2",
          children: ratingSystem.levels.map((level, li) => /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 p-2 rounded-lg border border-ih-border",
            children: [/* @__PURE__ */ jsx("input", {
              type: "color",
              value: level.color || "#6b7280",
              onChange: (e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].color = e.target.value;
                setRatingSystem(next);
              },
              className: "w-6 h-6 rounded border-0 cursor-pointer"
            }), /* @__PURE__ */ jsx("input", {
              value: level.label,
              onChange: (e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].label = e.target.value;
                setRatingSystem(next);
              },
              className: "flex-1 text-[12px] font-bold bg-transparent outline-none text-ih-fg-1"
            }), /* @__PURE__ */ jsx("input", {
              value: level.abbreviation || "",
              onChange: (e) => {
                const next = structuredClone(ratingSystem);
                next.levels[li].abbreviation = e.target.value;
                setRatingSystem(next);
              },
              placeholder: "Abbr",
              className: "w-12 text-[10px] font-mono bg-transparent border-b border-ih-border outline-none text-ih-fg-3 text-center"
            }), /* @__PURE__ */ jsxs("label", {
              className: "flex items-center gap-1 text-[10px] text-ih-fg-3",
              children: [/* @__PURE__ */ jsx("input", {
                type: "checkbox",
                checked: !!level.isDefect,
                onChange: (e) => {
                  const next = structuredClone(ratingSystem);
                  next.levels[li].isDefect = e.target.checked;
                  setRatingSystem(next);
                },
                className: "accent-ih-bad-fg"
              }), "Defect"]
            }), /* @__PURE__ */ jsx("button", {
              onClick: () => {
                const next = structuredClone(ratingSystem);
                next.levels.splice(li, 1);
                setRatingSystem(next);
              },
              className: "text-ih-fg-4 hover:text-ih-bad-fg text-[10px]",
              children: "×"
            })]
          }, level.id + li))
        }), /* @__PURE__ */ jsx("button", {
          onClick: addRatingLevel,
          className: "mt-3 text-[12px] font-bold text-ih-primary hover:text-ih-primary",
          children: "+ Add level"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end mt-5",
          children: /* @__PURE__ */ jsx("button", {
            onClick: () => setRatingModalOpen(false),
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600",
            children: "Done"
          })
        })]
      })
    })]
  });
});
const route5 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$n,
  default: templateEdit,
  loader: loader$_,
  meta: meta$W
}, Symbol.toStringTag, { value: "Module" }));
const publicLayout = UNSAFE_withComponentProps(function PublicLayout() {
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100",
    children: /* @__PURE__ */ jsx(Outlet, {})
  });
});
const route6 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: publicLayout
}, Symbol.toStringTag, { value: "Module" }));
function meta$V() {
  return [{
    title: "Book an Inspection - OpenInspection"
  }];
}
async function loader$Z({
  params,
  request
}) {
  const url = new URL(request.url);
  const refRaw = url.searchParams.get("ref");
  const agentRefSlug = refRaw && /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(refRaw) ? refRaw : null;
  try {
    const res = await apiFetch(`/api/public/book/${params.tenant}/${params.slug}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      profile: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Inspector not found",
      tenant: params.tenant,
      slug: params.slug,
      agentRefSlug
    };
  } catch {
    return {
      profile: null,
      error: "Service unavailable",
      tenant: "",
      slug: "",
      agentRefSlug: null
    };
  }
}
const STEPS$1 = ["Property", "Services", "Schedule", "Confirm"];
const TIME_WINDOWS = [{
  id: "morning",
  label: "Morning",
  detail: "8:00 AM - 12:00 PM"
}, {
  id: "afternoon",
  label: "Afternoon",
  detail: "12:00 PM - 5:00 PM"
}, {
  id: "allday",
  label: "All Day",
  detail: "Flexible timing"
}, {
  id: "custom",
  label: "Custom",
  detail: "Pick a specific time"
}];
const booking = UNSAFE_withComponentProps(function BookingPage() {
  var _a;
  const {
    profile,
    error,
    tenant,
    slug,
    agentRefSlug
  } = useLoaderData();
  const [step, setStep] = useState(0);
  const [address, setAddress] = useState("");
  const [selectedServices, setSelectedServices] = useState(/* @__PURE__ */ new Set());
  const [inspectionDate, setInspectionDate] = useState("");
  const [timeWindow, setTimeWindow] = useState("morning");
  const [customTime, setCustomTime] = useState("09:00");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [turnstileToken, setTurnstileToken] = useState(null);
  const turnstileRef = useRef(null);
  useEffect(() => {
    const siteKey = profile == null ? void 0 : profile.turnstileSiteKey;
    if (!siteKey || typeof window === "undefined") return;
    const existing = document.querySelector('script[src*="turnstile"]');
    if (!existing) {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad";
      s.async = true;
      document.head.appendChild(s);
    }
    window.onTurnstileLoad = () => {
      if (turnstileRef.current && window.turnstile) {
        window.turnstile.render(turnstileRef.current, {
          sitekey: siteKey,
          callback: (token) => setTurnstileToken(token)
        });
      }
    };
    if (window.turnstile && turnstileRef.current) {
      window.turnstile.render(turnstileRef.current, {
        sitekey: siteKey,
        callback: (token) => setTurnstileToken(token)
      });
    }
  }, [profile == null ? void 0 : profile.turnstileSiteKey, step]);
  const toggleService = (id) => setSelectedServices((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const totalPrice = useMemo(() => {
    if (!profile) return 0;
    return profile.services.filter((s) => selectedServices.has(s.id)).reduce((sum, s) => sum + s.price / 100, 0);
  }, [selectedServices, profile]);
  const needsTurnstile = !!(profile == null ? void 0 : profile.turnstileSiteKey);
  const canNext = step === 0 ? address.length > 2 : step === 1 ? selectedServices.size > 0 : step === 2 ? inspectionDate.length > 0 && clientName.length > 0 && clientEmail.length > 0 : needsTurnstile ? !!turnstileToken : true;
  async function handleSubmit() {
    var _a2;
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/public/book`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          address,
          date: inspectionDate,
          timeSlot: timeWindow === "custom" ? "custom" : timeWindow,
          ...timeWindow === "custom" ? {
            customTime
          } : {},
          inspectorId: profile == null ? void 0 : profile.inspectorId,
          services: [...selectedServices].map((id) => ({
            serviceId: id
          })),
          clientName,
          clientEmail,
          ...turnstileToken ? {
            turnstileToken
          } : {},
          ...agentRefSlug ? {
            agentRefSlug
          } : {}
        })
      });
      if (res.ok) {
        setMessage({
          text: "Booking request submitted! You will receive a confirmation email shortly.",
          ok: true
        });
        setStep(3);
      } else {
        const d = await res.json().catch(() => ({}));
        setMessage({
          text: ((_a2 = d == null ? void 0 : d.error) == null ? void 0 : _a2.message) || "Something went wrong. Please try again.",
          ok: false
        });
      }
    } catch {
      setMessage({
        text: "Network error. Please check your connection.",
        ok: false
      });
    } finally {
      setSubmitting(false);
    }
  }
  if (error || !profile) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center p-8",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-2xl font-bold text-ih-fg-1",
          children: "Not Available"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-ih-fg-3 mt-2",
          children: error ?? "This booking page is not available."
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-ih-bg-app py-12 px-4",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-2xl mx-auto",
      children: [/* @__PURE__ */ jsxs("nav", {
        className: "mb-8 flex items-center gap-3",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-ih-primary text-lg font-bold",
          children: profile.name.charAt(0)
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[15px] font-semibold text-ih-fg-1",
            children: profile.name
          }), profile.company && /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3",
            children: profile.company
          })]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card rounded-lg shadow-sm border border-ih-border p-6 md:p-10",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "mb-8 space-y-2",
          children: [/* @__PURE__ */ jsx("h1", {
            className: "text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight",
            children: "Schedule an inspection"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[14px] text-ih-fg-3 leading-relaxed",
            children: "Tell us about the property and pick a time that works."
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex items-center gap-1 mb-8",
          children: STEPS$1.map((s, i) => /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-1 flex-1",
            children: [/* @__PURE__ */ jsx("div", {
              className: `w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= step ? "bg-ih-primary text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-400"}`,
              children: i + 1
            }), /* @__PURE__ */ jsx("span", {
              className: `text-[11px] font-medium hidden sm:inline ${i <= step ? "text-ih-primary" : "text-slate-400"}`,
              children: s
            }), i < STEPS$1.length - 1 && /* @__PURE__ */ jsx("div", {
              className: `flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-slate-200 dark:bg-slate-700"}`
            })]
          }, s))
        }), step === 0 && /* @__PURE__ */ jsxs("section", {
          className: "space-y-5",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-1",
            children: [/* @__PURE__ */ jsx("h2", {
              className: "text-[18px] font-semibold tracking-tight text-ih-fg-1",
              children: "Property"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3",
              children: "Where is the inspection?"
            })]
          }), /* @__PURE__ */ jsxs("label", {
            className: "block",
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
              children: "Property address"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              value: address,
              onChange: (e) => setAddress(e.target.value),
              placeholder: "123 Main St, City, State ZIP",
              autoFocus: true,
              className: "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-indigo-500 focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
            })]
          })]
        }), step === 1 && /* @__PURE__ */ jsxs("section", {
          className: "space-y-5",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-1",
            children: [/* @__PURE__ */ jsx("h2", {
              className: "text-[18px] font-semibold tracking-tight text-ih-fg-1",
              children: "Services"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3",
              children: "Choose one or more inspections for this visit."
            })]
          }), /* @__PURE__ */ jsx("div", {
            className: "space-y-2",
            children: profile.services.map((svc) => {
              const selected = selectedServices.has(svc.id);
              return /* @__PURE__ */ jsxs("label", {
                className: "block cursor-pointer",
                children: [/* @__PURE__ */ jsx("input", {
                  type: "checkbox",
                  checked: selected,
                  onChange: () => toggleService(svc.id),
                  className: "sr-only"
                }), /* @__PURE__ */ jsxs("div", {
                  className: `px-4 py-3 rounded-md border transition-all flex items-center justify-between gap-3 ${selected ? "border-indigo-500 bg-ih-primary-tint ring-2 ring-indigo-500/10" : "border-ih-border bg-ih-bg-card hover:border-slate-300 dark:hover:border-slate-600"}`,
                  children: [/* @__PURE__ */ jsxs("div", {
                    className: "min-w-0",
                    children: [/* @__PURE__ */ jsx("div", {
                      className: "text-[13px] font-bold text-ih-fg-1 truncate",
                      children: svc.name
                    }), /* @__PURE__ */ jsxs("div", {
                      className: "text-[11px] text-ih-fg-3 mt-0.5",
                      children: ["~", svc.duration, " min"]
                    })]
                  }), /* @__PURE__ */ jsxs("div", {
                    className: "flex items-center gap-2 shrink-0",
                    children: [/* @__PURE__ */ jsxs("span", {
                      className: "text-sm font-semibold text-ih-fg-1",
                      children: ["$", (svc.price / 100).toFixed(2)]
                    }), selected && /* @__PURE__ */ jsx("svg", {
                      className: "w-4 h-4 text-indigo-500",
                      fill: "currentColor",
                      viewBox: "0 0 20 20",
                      children: /* @__PURE__ */ jsx("path", {
                        fillRule: "evenodd",
                        d: "M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z",
                        clipRule: "evenodd"
                      })
                    })]
                  })]
                })]
              }, svc.id);
            })
          }), selectedServices.size > 0 && /* @__PURE__ */ jsxs("div", {
            className: "px-4 py-2 rounded-md bg-slate-50 dark:bg-slate-700/50 flex items-center justify-between",
            children: [/* @__PURE__ */ jsxs("span", {
              className: "text-[12px] font-bold text-ih-fg-3",
              children: [selectedServices.size, " ", selectedServices.size === 1 ? "inspection" : "inspections"]
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[15px] font-bold text-ih-fg-1 tabular-nums",
              children: ["$", totalPrice.toFixed(2)]
            })]
          })]
        }), step === 2 && /* @__PURE__ */ jsxs("section", {
          className: "space-y-8",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-5",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "space-y-1",
              children: [/* @__PURE__ */ jsx("h2", {
                className: "text-[18px] font-semibold tracking-tight text-ih-fg-1",
                children: "Schedule"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[13px] text-ih-fg-3",
                children: "Pick a date and time window that works."
              })]
            }), /* @__PURE__ */ jsxs("label", {
              className: "block",
              children: [/* @__PURE__ */ jsx("span", {
                className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
                children: "Inspection date"
              }), /* @__PURE__ */ jsx("input", {
                type: "date",
                value: inspectionDate,
                onChange: (e) => setInspectionDate(e.target.value),
                className: "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-indigo-500 focus:shadow-ih-focus outline-none text-[14px] font-medium tabular-nums transition-colors"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("span", {
                className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
                children: "Time window"
              }), /* @__PURE__ */ jsx("div", {
                className: "grid grid-cols-2 gap-2 mt-1",
                children: TIME_WINDOWS.map((w) => /* @__PURE__ */ jsxs("label", {
                  className: "cursor-pointer",
                  children: [/* @__PURE__ */ jsx("input", {
                    type: "radio",
                    name: "timeSlot",
                    value: w.id,
                    checked: timeWindow === w.id,
                    onChange: () => setTimeWindow(w.id),
                    className: "sr-only"
                  }), /* @__PURE__ */ jsxs("div", {
                    className: `px-3 py-2.5 rounded-md border transition-all ${timeWindow === w.id ? "border-indigo-500 bg-ih-primary-tint ring-2 ring-indigo-500/10" : "border-ih-border bg-ih-bg-card"}`,
                    children: [/* @__PURE__ */ jsx("div", {
                      className: "text-[13px] font-bold text-ih-fg-1",
                      children: w.label
                    }), /* @__PURE__ */ jsx("div", {
                      className: "text-[11px] text-ih-fg-3 mt-0.5",
                      children: w.detail
                    })]
                  })]
                }, w.id))
              }), timeWindow === "custom" && /* @__PURE__ */ jsxs("div", {
                className: "mt-3 flex items-center gap-2",
                children: [/* @__PURE__ */ jsx("input", {
                  type: "time",
                  value: customTime,
                  onChange: (e) => setCustomTime(e.target.value),
                  className: "h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-indigo-500 focus:shadow-ih-focus outline-none text-[13px] font-medium tabular-nums"
                }), /* @__PURE__ */ jsx("span", {
                  className: "text-[11px] text-slate-400",
                  children: "on selected date"
                })]
              })]
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "space-y-5",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "space-y-1",
              children: [/* @__PURE__ */ jsx("h2", {
                className: "text-[18px] font-semibold tracking-tight text-ih-fg-1",
                children: "Your info"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[13px] text-ih-fg-3",
                children: "How do we reach you with the report?"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
              children: [/* @__PURE__ */ jsxs("label", {
                className: "block",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
                  children: "Full name"
                }), /* @__PURE__ */ jsx("input", {
                  type: "text",
                  value: clientName,
                  onChange: (e) => setClientName(e.target.value),
                  placeholder: "Jane Doe",
                  className: "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-indigo-500 focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
                })]
              }), /* @__PURE__ */ jsxs("label", {
                className: "block",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
                  children: "Email"
                }), /* @__PURE__ */ jsx("input", {
                  type: "email",
                  value: clientEmail,
                  onChange: (e) => setClientEmail(e.target.value),
                  placeholder: "jane@example.com",
                  className: "mt-1 w-full h-10 px-3 rounded-md border border-ih-border bg-ih-bg-card focus:border-indigo-500 focus:shadow-ih-focus outline-none text-[14px] font-medium transition-colors"
                })]
              })]
            })]
          })]
        }), step === 3 && /* @__PURE__ */ jsx("section", {
          className: "space-y-5",
          children: (message == null ? void 0 : message.ok) ? /* @__PURE__ */ jsxs("div", {
            className: "text-center py-8",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-16 h-16 rounded-full bg-ih-ok-bg flex items-center justify-center mx-auto mb-4",
              children: /* @__PURE__ */ jsx("svg", {
                className: "w-8 h-8 text-ih-ok-fg",
                fill: "none",
                stroke: "currentColor",
                viewBox: "0 0 24 24",
                children: /* @__PURE__ */ jsx("path", {
                  strokeLinecap: "round",
                  strokeLinejoin: "round",
                  strokeWidth: 2,
                  d: "M5 13l4 4L19 7"
                })
              })
            }), /* @__PURE__ */ jsx("h2", {
              className: "text-xl font-bold text-ih-fg-1 mb-2",
              children: "Request Submitted"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[14px] text-ih-fg-3",
              children: message.text
            })]
          }) : /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsxs("div", {
              className: "space-y-1",
              children: [/* @__PURE__ */ jsx("h2", {
                className: "text-[18px] font-semibold tracking-tight text-ih-fg-1",
                children: "Confirm details"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[13px] text-ih-fg-3",
                children: "Review your booking before submitting."
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "bg-slate-50 dark:bg-slate-700/50 rounded-md p-4 space-y-3 text-[13px]",
              children: [/* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Address"
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-medium text-ih-fg-1",
                  children: address
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Date"
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-medium text-ih-fg-1",
                  children: inspectionDate
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Time"
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-medium text-ih-fg-1",
                  children: timeWindow === "custom" ? customTime : (_a = TIME_WINDOWS.find((w) => w.id === timeWindow)) == null ? void 0 : _a.label
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Services"
                }), /* @__PURE__ */ jsxs("span", {
                  className: "font-medium text-ih-fg-1",
                  children: [selectedServices.size, " selected"]
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between border-t border-ih-border pt-3",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "font-bold text-ih-fg-2",
                  children: "Total"
                }), /* @__PURE__ */ jsxs("span", {
                  className: "font-bold text-ih-fg-1",
                  children: ["$", totalPrice.toFixed(2)]
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Name"
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-medium text-ih-fg-1",
                  children: clientName
                })]
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex justify-between",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-ih-fg-3",
                  children: "Email"
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-medium text-ih-fg-1",
                  children: clientEmail
                })]
              })]
            })]
          })
        }), step === 3 && needsTurnstile && /* @__PURE__ */ jsx("div", {
          className: "mt-6 flex justify-center",
          children: /* @__PURE__ */ jsx("div", {
            ref: turnstileRef
          })
        }), message && !message.ok && /* @__PURE__ */ jsx("div", {
          className: "mt-6 p-3 rounded-md bg-ih-bad-bg text-center text-[13px] font-semibold text-ih-bad-fg",
          children: message.text
        }), !(step === 3 && (message == null ? void 0 : message.ok)) && /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mt-8 pt-6 border-t border-ih-border",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => step > 0 ? setStep(step - 1) : void 0,
            disabled: step === 0,
            className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted disabled:opacity-30 disabled:cursor-not-allowed transition-colors",
            children: "Back"
          }), step < 3 ? /* @__PURE__ */ jsx("button", {
            onClick: () => setStep(step + 1),
            disabled: !canNext,
            className: "h-9 px-5 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
            children: "Continue"
          }) : /* @__PURE__ */ jsx("button", {
            onClick: handleSubmit,
            disabled: submitting || needsTurnstile && !turnstileToken,
            className: "h-9 px-5 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
            children: submitting ? "Submitting..." : "Request Inspection"
          })]
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-center text-[11px] text-ih-fg-4 mt-6",
        children: "Powered by OpenInspection"
      })]
    })
  });
});
const route7 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: booking,
  loader: loader$Z,
  meta: meta$V
}, Symbol.toStringTag, { value: "Module" }));
function meta$U() {
  return [{
    title: "Inspection Report - OpenInspection"
  }];
}
async function loader$Y({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/report/${params.tenant}/${params.id}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      report: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Report not found"
    };
  } catch {
    return {
      report: null,
      error: "Service unavailable"
    };
  }
}
const report = UNSAFE_withComponentProps(function ReportPage() {
  const {
    report: report2,
    error
  } = useLoaderData();
  if (error || !report2) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold",
        children: "Report Not Found"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error ?? "This report is not available."
      })]
    });
  }
  const {
    defectSummary: ds
  } = report2;
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-3xl mx-auto p-6",
    "data-theme": report2.reportTheme || void 0,
    children: [/* @__PURE__ */ jsxs("div", {
      className: "mb-8",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold",
        children: report2.address
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3 mt-1",
        children: ["Inspected by ", report2.inspectorName, report2.date && /* @__PURE__ */ jsxs("span", {
          children: [" on ", report2.date]
        }), report2.clientName && /* @__PURE__ */ jsxs("span", {
          children: [" for ", report2.clientName]
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex gap-2 mb-6",
      children: [ds.safety > 0 && /* @__PURE__ */ jsxs("span", {
        className: "text-[11px] font-bold px-2 py-1 rounded bg-ih-bad-bg text-ih-bad-fg",
        children: [ds.safety, " Safety"]
      }), ds.recommendation > 0 && /* @__PURE__ */ jsxs("span", {
        className: "text-[11px] font-bold px-2 py-1 rounded bg-ih-watch-bg text-ih-watch-fg",
        children: [ds.recommendation, " Recommendation"]
      }), ds.maintenance > 0 && /* @__PURE__ */ jsxs("span", {
        className: "text-[11px] font-bold px-2 py-1 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
        children: [ds.maintenance, " Maintenance"]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "space-y-2",
      children: report2.sections.map((section) => /* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between p-4 rounded-lg border border-ih-border",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[13px] font-medium",
            children: section.name
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-ih-fg-3",
            children: [section.itemCount, " items inspected"]
          })]
        }), section.defects > 0 && /* @__PURE__ */ jsxs("span", {
          className: "text-[11px] font-bold px-2 py-1 rounded bg-ih-watch-bg text-ih-watch-fg",
          children: [section.defects, " defects"]
        })]
      }, section.id))
    })]
  });
});
const route8 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: report,
  loader: loader$Y,
  meta: meta$U
}, Symbol.toStringTag, { value: "Module" }));
function meta$T() {
  return [{
    title: "Sign Agreement - OpenInspection"
  }];
}
async function loader$X({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/agreements/sign/${params.tenant}/${params.token}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      agreement: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Agreement not found",
      token: params.token,
      tenant: params.tenant
    };
  } catch {
    return {
      agreement: null,
      error: "Service unavailable",
      token: "",
      tenant: ""
    };
  }
}
const agreementSign = UNSAFE_withComponentProps(function AgreementSignPage() {
  const {
    agreement,
    error,
    token
  } = useLoaderData();
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [hasMark, setHasMark] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signed, setSigned] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [showDecline, setShowDecline] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [errorMsg, setErrorMsg] = useState(null);
  const getPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return {
      x: 0,
      y: 0
    };
    const r = canvas.getBoundingClientRect();
    const src = "touches" in e ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) * (canvas.width / r.width),
      y: (src.clientY - r.top) * (canvas.height / r.height)
    };
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.strokeStyle = "#1e293b";
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);
  const handleStart = (e) => {
    var _a;
    setDrawing(true);
    const ctx = (_a = canvasRef.current) == null ? void 0 : _a.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const handleMove = (e) => {
    var _a;
    if (!drawing) return;
    setHasMark(true);
    const ctx = (_a = canvasRef.current) == null ? void 0 : _a.getContext("2d");
    if (!ctx) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const handleEnd = () => setDrawing(false);
  const clearSig = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasMark(false);
  };
  const submitSignature = async () => {
    var _a;
    if (!hasMark) {
      setErrorMsg("Please draw your signature before submitting.");
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const signatureBase64 = canvas.toDataURL("image/png");
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/public/agreements/${token}/sign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          signatureBase64
        })
      });
      if (res.ok) {
        setSigned(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(((_a = d == null ? void 0 : d.error) == null ? void 0 : _a.message) || "Signing failed. Please try again.");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  const submitDecline = async () => {
    var _a;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/public/agreements/${token}/decline`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          reason: declineReason || void 0
        })
      });
      if (res.ok) {
        setDeclined(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(((_a = d == null ? void 0 : d.error) == null ? void 0 : _a.message) || "Failed to decline. Please try again.");
      }
    } catch {
      setErrorMsg("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };
  if (error || !agreement) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center p-8",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-2xl font-bold text-ih-fg-1",
          children: "Agreement Not Found"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-ih-fg-3 mt-2",
          children: error ?? "This agreement link is invalid or expired."
        })]
      })
    });
  }
  if (declined) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center p-8 max-w-md",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-xl font-bold text-ih-fg-1",
          children: "Thank you"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-ih-fg-3 mt-2",
          children: "The inspector has been notified that you declined this agreement."
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-ih-bg-app py-6 px-4",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-2xl mx-auto",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-6",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-10 h-10 bg-ih-primary rounded-2xl flex items-center justify-center shadow-lg",
          children: /* @__PURE__ */ jsx("svg", {
            className: "w-6 h-6 text-white",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2.5,
              d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            })
          })
        }), /* @__PURE__ */ jsx("span", {
          className: "text-xl font-bold tracking-tight text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card rounded-lg shadow-md overflow-hidden",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "px-6 py-6 sm:px-10 sm:py-8 border-b border-slate-100 dark:border-slate-700",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-2",
            children: "Document for Signature"
          }), /* @__PURE__ */ jsx("h1", {
            className: "text-xl font-bold text-ih-fg-1 tracking-tight",
            children: agreement.title
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[13px] text-ih-fg-3 mt-1",
            children: ["From ", agreement.inspectorName, agreement.clientName && /* @__PURE__ */ jsxs("span", {
              children: [" to ", agreement.clientName]
            })]
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "px-6 py-6 sm:px-10 sm:py-8 border-b border-slate-100 dark:border-slate-700 max-h-96 overflow-y-auto",
          children: /* @__PURE__ */ jsx("div", {
            className: "prose prose-sm dark:prose-invert max-w-none text-ih-fg-3 leading-relaxed",
            dangerouslySetInnerHTML: {
              __html: agreement.body
            }
          })
        }), agreement.signedAt || signed ? /* @__PURE__ */ jsxs("div", {
          className: "px-6 py-8 sm:px-10 sm:py-10 text-center",
          children: [/* @__PURE__ */ jsx("div", {
            className: "w-16 h-16 bg-ih-ok-bg rounded-full flex items-center justify-center mx-auto mb-4",
            children: /* @__PURE__ */ jsx("svg", {
              className: "w-8 h-8 text-ih-ok-fg",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ jsx("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: 2,
                d: "M5 13l4 4L19 7"
              })
            })
          }), /* @__PURE__ */ jsx("h2", {
            className: "text-xl font-bold tracking-tight text-ih-fg-1 mb-2",
            children: signed ? "Signed Successfully" : "Already Signed"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-ih-fg-3 font-medium mb-6",
            children: signed ? "Thank you for signing this agreement." : `This agreement was signed on ${agreement.signedAt}.`
          }), /* @__PURE__ */ jsxs("button", {
            onClick: () => window.print(),
            className: "inline-flex items-center gap-2 px-5 py-2.5 rounded-md bg-ih-primary text-white text-sm font-bold hover:bg-ih-primary-600 transition-all",
            children: [/* @__PURE__ */ jsx("svg", {
              className: "w-4 h-4",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ jsx("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: 2,
                d: "M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              })
            }), "Download as PDF"]
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-4 italic mt-3",
            children: 'In the print dialog, choose "Save as PDF" as destination.'
          })]
        }) : /* @__PURE__ */ jsxs("div", {
          className: "px-6 py-6 sm:px-10 sm:py-8",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-sm font-bold text-ih-fg-3 mb-4",
            children: "Draw your signature below:"
          }), /* @__PURE__ */ jsx("div", {
            className: "border-2 border-ih-border rounded-2xl overflow-hidden bg-ih-bg-app mb-4",
            style: {
              touchAction: "none"
            },
            children: /* @__PURE__ */ jsx("canvas", {
              ref: canvasRef,
              width: 580,
              height: 180,
              className: "w-full cursor-crosshair block",
              onMouseDown: handleStart,
              onMouseMove: handleMove,
              onMouseUp: handleEnd,
              onMouseLeave: handleEnd,
              onTouchStart: handleStart,
              onTouchMove: handleMove,
              onTouchEnd: handleEnd
            })
          }), errorMsg && /* @__PURE__ */ jsx("div", {
            className: "mb-4 px-3 py-2 rounded-md bg-ih-bad-bg text-[13px] font-medium text-ih-bad-fg text-center",
            children: errorMsg
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex gap-3 mb-6",
            children: [/* @__PURE__ */ jsx("button", {
              onClick: clearSig,
              className: "flex-1 h-10 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-3 text-sm font-semibold hover:bg-ih-bg-muted transition-all",
              children: "Clear"
            }), /* @__PURE__ */ jsx("button", {
              onClick: submitSignature,
              disabled: submitting,
              className: "flex-[2] h-10 px-4 bg-ih-primary text-white rounded-md font-bold text-sm hover:bg-ih-primary-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed",
              children: submitting ? "Signing..." : "Sign Agreement"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "border-t border-slate-100 dark:border-slate-700 pt-4",
            children: [/* @__PURE__ */ jsx("button", {
              onClick: () => setShowDecline(!showDecline),
              className: "text-xs text-ih-bad-fg hover:underline font-semibold",
              children: showDecline ? "Cancel decline" : "Decline this agreement"
            }), showDecline && /* @__PURE__ */ jsxs("div", {
              className: "mt-3 p-4 bg-ih-bad-bg rounded-lg border border-rose-100 dark:border-rose-800",
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[10px] font-bold text-ih-bad-fg uppercase tracking-widest mb-2",
                children: "Reason (optional)"
              }), /* @__PURE__ */ jsx("textarea", {
                value: declineReason,
                onChange: (e) => setDeclineReason(e.target.value),
                rows: 3,
                className: "w-full px-3 py-2 rounded-lg border border-ih-bad bg-ih-bg-card text-sm text-ih-fg-1 focus:ring-2 focus:ring-rose-500/20 outline-none",
                placeholder: "Let the inspector know why..."
              }), /* @__PURE__ */ jsx("button", {
                onClick: submitDecline,
                disabled: submitting,
                className: "mt-3 px-5 py-2 rounded-lg bg-rose-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-rose-700 transition disabled:opacity-50",
                children: submitting ? "Submitting..." : "Decline Agreement"
              })]
            })]
          })]
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-center text-[11px] text-ih-fg-4 mt-6",
        children: "Powered by OpenInspection"
      })]
    })
  });
});
const route9 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: agreementSign,
  loader: loader$X,
  meta: meta$T
}, Symbol.toStringTag, { value: "Module" }));
function meta$S() {
  return [{
    title: "Invoice - OpenInspection"
  }];
}
async function loader$W({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/r/${params.id}/invoice`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      invoice: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Invoice not found"
    };
  } catch {
    return {
      invoice: null,
      error: "Service unavailable"
    };
  }
}
const STATUS_STYLES$1 = {
  paid: "bg-ih-ok-bg text-ih-ok-fg",
  sent: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  overdue: "bg-ih-bad-bg text-ih-bad-fg",
  draft: "bg-ih-bg-muted text-ih-fg-3",
  void: "bg-ih-bg-muted text-ih-fg-3"
};
const invoice = UNSAFE_withComponentProps(function InvoicePage() {
  const {
    invoice: invoice2,
    error
  } = useLoaderData();
  if (error || !invoice2) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold",
        children: "Invoice Not Found"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error ?? "This invoice is not available."
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-2xl mx-auto p-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-start justify-between mb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsxs("h1", {
          className: "text-xl font-bold",
          children: ["Invoice ", invoice2.number]
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: [invoice2.date, invoice2.dueDate && /* @__PURE__ */ jsxs("span", {
            children: [" · Due ", invoice2.dueDate]
          })]
        })]
      }), /* @__PURE__ */ jsx("span", {
        className: `text-[11px] font-bold uppercase px-2.5 py-1 rounded ${STATUS_STYLES$1[invoice2.status] ?? STATUS_STYLES$1.draft}`,
        children: invoice2.status
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "text-[13px] text-ih-fg-3 mb-6",
      children: [/* @__PURE__ */ jsxs("p", {
        children: [/* @__PURE__ */ jsx("span", {
          className: "text-ih-fg-4",
          children: "From:"
        }), " ", invoice2.inspectorName]
      }), /* @__PURE__ */ jsxs("p", {
        children: [/* @__PURE__ */ jsx("span", {
          className: "text-ih-fg-4",
          children: "To:"
        }), " ", invoice2.clientName]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "border border-ih-border rounded-lg overflow-hidden mb-6",
      children: [invoice2.lineItems.map((item, i) => /* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-700 last:border-b-0",
        children: [/* @__PURE__ */ jsx("span", {
          className: "text-[13px]",
          children: item.description
        }), /* @__PURE__ */ jsxs("span", {
          className: "text-[13px] font-medium",
          children: ["$", item.amount]
        })]
      }, i)), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between px-4 py-3 bg-ih-bg-app font-bold text-sm",
        children: [/* @__PURE__ */ jsx("span", {
          children: "Total"
        }), /* @__PURE__ */ jsxs("span", {
          children: ["$", invoice2.total]
        })]
      })]
    }), invoice2.status !== "paid" && invoice2.status !== "void" && /* @__PURE__ */ jsx("button", {
      type: "button",
      className: "w-full h-10 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
      children: "Pay Now"
    })]
  });
});
const route10 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: invoice,
  loader: loader$W,
  meta: meta$S
}, Symbol.toStringTag, { value: "Module" }));
function meta$R() {
  return [{
    title: "Verify Signature - OpenInspection"
  }];
}
async function loader$V({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/verify/${params.envelopeId}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      result: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Verification failed"
    };
  } catch {
    return {
      result: null,
      error: "Service unavailable"
    };
  }
}
const verify = UNSAFE_withComponentProps(function VerifyPage() {
  const {
    result,
    error
  } = useLoaderData();
  if (error || !result) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold",
        children: "Verification Failed"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error ?? "Unable to verify this signature."
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-xl mx-auto p-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: `p-4 rounded-lg text-center mb-6 ${result.valid ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bad-bg text-ih-bad-fg"}`,
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-lg font-bold",
        children: result.valid ? "Signature Verified" : "Invalid Signature"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] mt-1",
        children: [result.documentTitle, " · signed by ", result.signerName, " on", " ", result.signedAt]
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3",
      children: "Audit Trail"
    }), /* @__PURE__ */ jsx("div", {
      className: "space-y-2",
      children: result.auditTrail.map((entry2, i) => /* @__PURE__ */ jsxs("div", {
        className: "flex items-start gap-3 text-[13px] p-3 rounded-lg border border-ih-border",
        children: [/* @__PURE__ */ jsx("span", {
          className: "shrink-0 w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500 mt-1.5"
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "font-medium",
            children: entry2.action
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-ih-fg-3",
            children: [entry2.actor, " · ", entry2.timestamp]
          })]
        })]
      }, i))
    })]
  });
});
const route11 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: verify,
  loader: loader$V,
  meta: meta$R
}, Symbol.toStringTag, { value: "Module" }));
function meta$Q() {
  return [{
    title: "Observe Inspection - OpenInspection"
  }];
}
async function loader$U({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/observe/inspections/${params.id}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      inspection: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Inspection not found"
    };
  } catch {
    return {
      inspection: null,
      error: "Service unavailable"
    };
  }
}
const observe = UNSAFE_withComponentProps(function ObservePage() {
  const {
    inspection,
    error
  } = useLoaderData();
  if (error || !inspection) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold",
        children: "Inspection Not Found"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error ?? "This observation link is invalid or expired."
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-2xl mx-auto p-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "mb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2 mb-1",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-xl font-bold",
          children: inspection.address
        }), /* @__PURE__ */ jsx("span", {
          className: "text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400",
          children: inspection.status
        })]
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Inspector: ", inspection.inspectorName, inspection.date && /* @__PURE__ */ jsxs("span", {
          children: [" · ", inspection.date]
        })]
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-sm font-semibold uppercase tracking-wide text-ih-fg-3 mb-3",
      children: "Progress"
    }), /* @__PURE__ */ jsx("div", {
      className: "space-y-2",
      children: inspection.sections.map((section, i) => {
        const pct = section.totalItems > 0 ? Math.round(section.completedItems / section.totalItems * 100) : 0;
        return /* @__PURE__ */ jsxs("div", {
          className: "p-4 rounded-lg border border-ih-border",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center justify-between mb-2",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-medium",
              children: section.name
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[11px] text-ih-fg-3",
              children: [section.completedItems, "/", section.totalItems]
            })]
          }), /* @__PURE__ */ jsx("div", {
            className: "h-1.5 rounded-full bg-ih-bg-muted overflow-hidden",
            children: /* @__PURE__ */ jsx("div", {
              className: "h-full rounded-full bg-indigo-500 transition-all",
              style: {
                width: `${pct}%`
              }
            })
          })]
        }, i);
      })
    })]
  });
});
const route12 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: observe,
  loader: loader$U,
  meta: meta$Q
}, Symbol.toStringTag, { value: "Module" }));
function meta$P() {
  return [{
    title: "Book on behalf of client - OpenInspection"
  }];
}
async function loader$T({
  request,
  params
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch(`/api/concierge/book-info`, {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      data: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Not found"
    };
  } catch {
    return {
      data: null,
      error: "Service unavailable"
    };
  }
}
async function action$m({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body = {
    tenantId: fd.get("tenantId"),
    inspectorContactId: fd.get("inspectorContactId"),
    clientName: fd.get("clientName"),
    clientEmail: fd.get("clientEmail"),
    clientPhone: fd.get("clientPhone") || void 0,
    propertyAddress: fd.get("propertyAddress"),
    date: fd.get("date"),
    timeSlot: fd.get("timeSlot"),
    agreementRequired: fd.get("agreementRequired") === "on",
    paymentRequired: fd.get("paymentRequired") === "on"
  };
  const res = await apiFetch("/api/concierge/book", {
    token,
    method: "POST",
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = json.error;
    return {
      success: false,
      error: (err == null ? void 0 : err.message) || "Could not submit booking"
    };
  }
  return {
    success: true,
    error: null
  };
}
const TIMELINE_STEPS = [{
  label: "Submitted",
  sub: "Booking sent.",
  done: true,
  active: false
}, {
  label: "Client confirms",
  sub: "Magic link sent -- waiting on the client.",
  done: false,
  active: true
}, {
  label: "Agreement signed",
  sub: "Client reads and e-signs the inspection agreement.",
  done: false,
  active: false
}, {
  label: "Inspection scheduled",
  sub: "You'll see it on your dashboard once locked in.",
  done: false,
  active: false
}];
const conciergeBook = UNSAFE_withComponentProps(function ConciergeBookPage() {
  const {
    data,
    error: loaderError
  } = useLoaderData();
  const actionData = useActionData();
  const [submitting, setSubmitting] = useState(false);
  if (loaderError || !data) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3",
        children: "Could not load booking information."
      })
    });
  }
  const inspectorName = data.inspector.name || data.inspector.slug || "this inspector";
  const agentName = data.agent.name || "Partner agent";
  const submitted = (actionData == null ? void 0 : actionData.success) === true;
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen bg-ih-bg-card",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "sticky top-0 z-50 bg-orange-50 dark:bg-orange-900/30 border-b border-orange-200 dark:border-orange-800/40 px-6 py-3 flex items-center justify-between text-sm font-semibold text-orange-800 dark:text-orange-300",
      children: [/* @__PURE__ */ jsxs("span", {
        className: "flex items-center gap-2",
        children: [/* @__PURE__ */ jsx("span", {
          className: "text-lg",
          "aria-hidden": "true",
          children: "🔔"
        }), /* @__PURE__ */ jsx("span", {
          children: "Booking on behalf of client"
        })]
      }), /* @__PURE__ */ jsxs("span", {
        className: "text-[13px] text-orange-700 dark:text-orange-400",
        children: [agentName, " — ", data.tenantName]
      })]
    }), /* @__PURE__ */ jsxs("main", {
      className: "max-w-[720px] mx-auto px-5 py-10",
      children: [/* @__PURE__ */ jsxs("h1", {
        className: "font-serif text-[1.75rem] font-bold leading-tight mb-1 text-ih-fg-1",
        children: ["Book for ", /* @__PURE__ */ jsx("span", {
          className: "text-ih-fg-3",
          children: inspectorName
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[15px] text-ih-fg-3 leading-relaxed mb-7",
        children: "Fill in your client's details and pick a date. They'll get an email to confirm and review the inspection agreement before anything is finalized."
      }), !submitted ? /* @__PURE__ */ jsxs(Form, {
        method: "post",
        autoComplete: "off",
        onSubmit: () => setSubmitting(true),
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "tenantId",
          value: data.tenantId
        }), /* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "inspectorContactId",
          value: data.inspector.contactId
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsxs("label", {
            className: "space-y-1.5",
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
              children: "Client name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              name: "clientName",
              required: true,
              maxLength: 200,
              placeholder: "Sarah Buyer",
              className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
            })]
          }), /* @__PURE__ */ jsxs("label", {
            className: "space-y-1.5",
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
              children: "Client email"
            }), /* @__PURE__ */ jsx("input", {
              type: "email",
              name: "clientEmail",
              required: true,
              maxLength: 200,
              placeholder: "sarah@example.com",
              className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
            })]
          })]
        }), /* @__PURE__ */ jsxs("label", {
          className: "space-y-1.5 block",
          children: [/* @__PURE__ */ jsxs("span", {
            className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
            children: ["Client phone", " ", /* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-4 font-medium normal-case tracking-normal",
              children: "(optional)"
            })]
          }), /* @__PURE__ */ jsx("input", {
            type: "tel",
            name: "clientPhone",
            maxLength: 40,
            placeholder: "(555) 123-4567",
            className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
          })]
        }), /* @__PURE__ */ jsxs("label", {
          className: "space-y-1.5 block",
          children: [/* @__PURE__ */ jsx("span", {
            className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
            children: "Property address"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            name: "propertyAddress",
            required: true,
            maxLength: 500,
            placeholder: "1 Main St, Springfield",
            className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsxs("label", {
            className: "space-y-1.5",
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
              children: "Date"
            }), /* @__PURE__ */ jsx("input", {
              type: "date",
              name: "date",
              required: true,
              className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500"
            })]
          }), /* @__PURE__ */ jsxs("label", {
            className: "space-y-1.5",
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[13px] font-bold text-ih-fg-3 uppercase tracking-wide",
              children: "Time slot"
            }), /* @__PURE__ */ jsxs("select", {
              name: "timeSlot",
              required: true,
              className: "w-full px-3 py-2.5 border border-ih-border rounded-lg bg-ih-bg-card text-base text-ih-fg-1 outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500",
              children: [/* @__PURE__ */ jsx("option", {
                value: "",
                children: "Select a slot"
              }), /* @__PURE__ */ jsx("option", {
                value: "08:00",
                children: "8:00 AM"
              }), /* @__PURE__ */ jsx("option", {
                value: "09:00",
                children: "9:00 AM"
              }), /* @__PURE__ */ jsx("option", {
                value: "10:00",
                children: "10:00 AM"
              }), /* @__PURE__ */ jsx("option", {
                value: "11:00",
                children: "11:00 AM"
              }), /* @__PURE__ */ jsx("option", {
                value: "13:00",
                children: "1:00 PM"
              }), /* @__PURE__ */ jsx("option", {
                value: "14:00",
                children: "2:00 PM"
              }), /* @__PURE__ */ jsx("option", {
                value: "15:00",
                children: "3:00 PM"
              })]
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2.5",
          children: [/* @__PURE__ */ jsxs("label", {
            className: "flex items-center gap-2.5 px-3 py-2.5 border border-ih-border rounded-lg text-[14px] text-ih-fg-3 font-medium",
            children: [/* @__PURE__ */ jsx("input", {
              type: "checkbox",
              name: "agreementRequired",
              defaultChecked: true
            }), "Inspector requires the client to e-sign an inspection agreement"]
          }), /* @__PURE__ */ jsxs("label", {
            className: "flex items-center gap-2.5 px-3 py-2.5 border border-ih-border rounded-lg text-[14px] text-ih-fg-3 font-medium",
            children: [/* @__PURE__ */ jsx("input", {
              type: "checkbox",
              name: "paymentRequired"
            }), "Inspector requires payment before the inspection"]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "pt-2",
          children: [/* @__PURE__ */ jsx("button", {
            type: "submit",
            disabled: submitting,
            className: "w-full px-6 py-3.5 bg-[#F55A1A] text-white rounded-lg font-bold text-base hover:brightness-95 disabled:bg-slate-400 disabled:cursor-wait transition-all",
            children: submitting ? "Sending..." : "Send booking to client"
          }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
            className: "mt-3 px-4 py-3 bg-ih-bad-bg border border-ih-bad rounded-lg text-[14px] text-ih-bad-fg",
            children: actionData.error
          })]
        })]
      }) : (
        /* Post-submit timeline */
        /* @__PURE__ */ jsx("div", {
          className: "bg-ih-bg-card border border-ih-border rounded-xl p-7 space-y-3.5 mt-5",
          children: TIMELINE_STEPS.map((step, idx) => /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-3 py-2.5",
            children: [/* @__PURE__ */ jsx("span", {
              className: `w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${step.done ? "bg-green-500 text-white" : step.active ? "bg-[#F55A1A] text-white animate-pulse" : "bg-ih-bg-muted text-ih-fg-3"}`,
              children: step.done ? "✓" : idx + 1
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[15px] font-semibold text-ih-fg-1",
                children: step.label
              }), /* @__PURE__ */ jsx("div", {
                className: "text-[13px] text-ih-fg-3 mt-0.5",
                children: step.sub
              })]
            })]
          }, step.label))
        })
      )]
    })]
  });
});
const route13 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$m,
  default: conciergeBook,
  loader: loader$T,
  meta: meta$P
}, Symbol.toStringTag, { value: "Module" }));
function meta$O() {
  return [{
    title: "Confirm your inspection - OpenInspection"
  }];
}
async function loader$S({
  request
}) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return {
      data: null,
      error: "no-token"
    };
  }
  try {
    const res = await apiFetch(`/api/concierge/confirm-info?token=${encodeURIComponent(token)}`);
    const body = res.ok ? await res.json() : {};
    if (!res.ok) {
      return {
        data: null,
        error: "expired"
      };
    }
    const d = body.data ?? {};
    return {
      data: d && Object.keys(d).length > 0 ? {
        ...d,
        token
      } : null,
      error: null
    };
  } catch {
    return {
      data: null,
      error: "unknown"
    };
  }
}
async function action$l({
  request
}) {
  const fd = await request.formData();
  const token = fd.get("token");
  const res = await apiFetch("/api/concierge/confirm", {
    method: "POST",
    body: JSON.stringify({
      token
    })
  });
  const json = await res.json().catch(() => ({}));
  if (res.ok && json.success) {
    const data = json.data;
    return {
      error: null,
      redirect: (data == null ? void 0 : data.redirect) || "/"
    };
  }
  const err = json.error;
  return {
    error: (err == null ? void 0 : err.message) || "Could not confirm. Please try again.",
    redirect: null
  };
}
function initials$2(name) {
  var _a, _b, _c;
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (((_a = parts[0]) == null ? void 0 : _a[0]) ?? "?").toUpperCase();
  return ((((_b = parts[0]) == null ? void 0 : _b[0]) ?? "") + (((_c = parts[parts.length - 1]) == null ? void 0 : _c[0]) ?? "")).toUpperCase();
}
const conciergeConfirm = UNSAFE_withComponentProps(function ConciergeConfirmPage() {
  const {
    data,
    error: loaderError
  } = useLoaderData();
  const actionData = useActionData();
  const [submitting, setSubmitting] = useState(false);
  if (typeof window !== "undefined" && (actionData == null ? void 0 : actionData.redirect)) {
    window.location.href = actionData.redirect;
  }
  if (loaderError || !data) {
    const headline = loaderError === "expired" ? "This confirmation link has expired" : loaderError === "no-token" ? "No confirmation link provided" : "We couldn't find that confirmation link";
    const body = loaderError === "expired" ? "Confirmation links are valid for 7 days. Reach out to your agent or inspector and they can send you a fresh one." : loaderError === "no-token" ? "It looks like the link is incomplete. Use the original email and try again, or contact your agent." : "The link may have been mistyped, or the booking was cancelled. Get in touch with your agent.";
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsxs("div", {
        className: "max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 flex items-center justify-center text-2xl font-bold mb-4",
          children: "!"
        }), /* @__PURE__ */ jsx("h1", {
          className: "font-serif text-2xl font-bold mb-2 text-ih-fg-1",
          children: headline
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[15px] text-ih-fg-3 leading-relaxed",
          children: body
        })]
      })
    });
  }
  const inspectorName = data.inspector.name || data.inspector.email || "your inspector";
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("main", {
      className: "max-w-[640px] mx-auto px-5 py-10",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2.5 font-serif text-lg font-bold mb-10 text-ih-fg-1",
        children: [/* @__PURE__ */ jsx("span", {
          className: "w-8 h-8 rounded-lg bg-[#F55A1A] text-white flex items-center justify-center font-bold text-sm",
          children: "O"
        }), /* @__PURE__ */ jsx("span", {
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "font-serif text-[2rem] font-bold leading-tight mb-2 text-ih-fg-1",
        children: "Confirm your inspection"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-base text-ih-fg-3 leading-relaxed mb-8",
        children: [data.inspector.name ? /* @__PURE__ */ jsx("strong", {
          className: "text-ih-fg-1",
          children: data.inspector.name
        }) : "Your inspector", " ", "has scheduled an inspection on your behalf. Review the details below and confirm to lock it in."]
      }), /* @__PURE__ */ jsxs("article", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden mb-6",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-4 p-7 border-b border-ih-border",
          children: [data.inspector.photoUrl ? /* @__PURE__ */ jsx("span", {
            className: "w-[72px] h-[72px] rounded-full overflow-hidden shrink-0 bg-orange-50 dark:bg-orange-900/20",
            children: /* @__PURE__ */ jsx("img", {
              src: data.inspector.photoUrl,
              alt: inspectorName,
              className: "w-full h-full object-cover"
            })
          }) : /* @__PURE__ */ jsx("span", {
            className: "w-[72px] h-[72px] rounded-full bg-orange-50 dark:bg-orange-900/20 text-[#F55A1A] flex items-center justify-center font-serif font-bold text-2xl shrink-0",
            children: initials$2(data.inspector.name)
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("div", {
              className: "text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4 mb-1",
              children: "Your inspector"
            }), /* @__PURE__ */ jsx("div", {
              className: "font-serif text-2xl font-bold text-ih-fg-1 leading-tight",
              children: inspectorName
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "p-6 space-y-3.5",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4",
              children: "Property"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-base font-semibold text-ih-fg-1",
              children: data.inspection.propertyAddress
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4",
              children: "Date"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-base font-semibold text-ih-fg-1",
              children: data.inspection.date
            })]
          }), data.inspection.clientName && /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("span", {
              className: "block text-[11px] font-bold uppercase tracking-[0.12em] text-ih-fg-4",
              children: "Client"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-base font-semibold text-ih-fg-1",
              children: data.inspection.clientName
            })]
          })]
        })]
      }), data.inspection.agreementRequired && data.agreementSnippet && /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-6 mb-6",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "font-serif text-lg font-bold text-ih-fg-1 mb-2",
          children: "Inspection agreement (preview)"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[15px] italic text-ih-fg-3 leading-relaxed",
          children: data.agreementSnippet
        }), /* @__PURE__ */ jsx("p", {
          className: "mt-3.5 text-[13px] text-ih-fg-4",
          children: "After confirming you'll be taken to the full agreement to read and e-sign."
        })]
      }), data.inspection.agreementRequired && !data.agreementSnippet && /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-6 mb-6",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "font-serif text-lg font-bold text-ih-fg-1 mb-2",
          children: "Inspection agreement"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[15px] italic text-ih-fg-3 leading-relaxed",
          children: "After confirming you'll be taken to the full inspection agreement to read and e-sign."
        })]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        onSubmit: () => setSubmitting(true),
        className: "mt-7",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "token",
          value: data.token
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          disabled: submitting,
          className: "w-full px-6 py-4 bg-[#F55A1A] text-white rounded-lg font-bold text-base hover:brightness-95 disabled:bg-slate-400 disabled:cursor-wait transition-all",
          children: submitting ? "Confirming..." : "Confirm and continue"
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "mt-3 px-4 py-3 bg-ih-bad-bg border border-ih-bad rounded-lg text-[14px] text-ih-bad-fg",
          children: actionData.error
        })]
      })]
    })
  });
});
const route14 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$l,
  default: conciergeConfirm,
  loader: loader$S,
  meta: meta$O
}, Symbol.toStringTag, { value: "Module" }));
function meta$N() {
  return [{
    title: "Confirmation link unavailable - OpenInspection"
  }];
}
async function loader$R({
  request
}) {
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "unknown";
  return {
    reason
  };
}
const conciergeExpired = UNSAFE_withComponentProps(function ConciergeExpiredPage() {
  const {
    reason
  } = useLoaderData();
  const headline = reason === "expired" ? "This confirmation link has expired" : reason === "unknown" ? "We couldn't find that confirmation link" : "No confirmation link provided";
  const body = reason === "expired" ? "Confirmation links are valid for 7 days. Reach out to your agent or inspector and they can send you a fresh one in a minute." : reason === "unknown" ? "The link may have been mistyped, or the booking was cancelled. Get in touch with your agent -- they can reissue a new confirmation." : "It looks like the link is incomplete. Use the original email and try again, or contact your agent.";
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center p-6 bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("main", {
      className: "max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-9",
      children: [/* @__PURE__ */ jsx("div", {
        className: "w-12 h-12 rounded-xl bg-orange-100 dark:bg-orange-900/30 text-[#F55A1A] flex items-center justify-center text-2xl font-bold mb-4",
        children: "!"
      }), /* @__PURE__ */ jsx("h1", {
        className: "font-serif text-2xl font-bold leading-tight mb-2.5 text-ih-fg-1",
        children: headline
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[15px] text-ih-fg-3 leading-relaxed",
        children: body
      })]
    })
  });
});
const route15 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: conciergeExpired,
  loader: loader$R,
  meta: meta$N
}, Symbol.toStringTag, { value: "Module" }));
function meta$M({
  data
}) {
  var _a, _b, _c;
  const d = data;
  const name = ((_a = d == null ? void 0 : d.profile) == null ? void 0 : _a.name) ?? "Inspector";
  return [{
    title: `${name} - Home Inspector`
  }, {
    name: "description",
    content: ((_c = (_b = d == null ? void 0 : d.profile) == null ? void 0 : _b.bio) == null ? void 0 : _c.slice(0, 160)) || `Book a home inspection with ${name}.`
  }];
}
async function loader$Q({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/inspector/${params.tenant}/${params.slug}`);
    const body = res.ok ? await res.json() : {};
    const data = body.data ?? {};
    return {
      profile: (data == null ? void 0 : data.profile) ?? null,
      services: Array.isArray(data == null ? void 0 : data.services) ? data.services : [],
      tenantSlug: params.tenant ?? "",
      error: res.ok ? null : "Inspector not found"
    };
  } catch {
    return {
      profile: null,
      services: [],
      tenantSlug: "",
      error: "Service unavailable"
    };
  }
}
function fmtPrice(cents) {
  return "$" + Math.round(cents / 100).toLocaleString();
}
function fmtDuration(min) {
  if (min == null || min <= 0) return "";
  if (min >= 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${min}m`;
}
const inspectorProfile = UNSAFE_withComponentProps(function InspectorProfilePage() {
  const {
    profile,
    services,
    tenantSlug,
    error
  } = useLoaderData();
  if (error || !profile) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "font-serif text-[32px] font-semibold mb-4 text-ih-fg-1",
          children: "Inspector not found"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-ih-fg-3 text-[15px]",
          children: "Double-check the link or contact whoever shared it."
        })]
      })
    });
  }
  const displayName = profile.name ?? "Inspector";
  const initials2 = displayName.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen",
    children: [/* @__PURE__ */ jsxs("header", {
      className: "grid grid-cols-1 lg:grid-cols-2 gap-8 items-end max-w-[1200px] mx-auto px-6 lg:px-16 pt-24 pb-12",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h1", {
          className: "font-serif text-[96px] lg:text-[96px] text-[56px] font-semibold tracking-tight leading-[0.95] -translate-x-3 text-ih-fg-1",
          children: displayName
        }), profile.licenseNumber && /* @__PURE__ */ jsxs("div", {
          className: "mt-4 font-mono text-xs tracking-wide uppercase text-ih-fg-4",
          children: ["License ", profile.licenseNumber]
        }), profile.serviceAreas.length > 0 && /* @__PURE__ */ jsx("div", {
          className: "mt-3 flex flex-wrap gap-1.5",
          children: profile.serviceAreas.slice(0, 5).map((a) => /* @__PURE__ */ jsxs("span", {
            className: "inline-block px-2.5 py-1 rounded-full bg-ih-bg-muted text-ih-fg-3 text-xs",
            children: [a.city, ", ", a.state]
          }, `${a.city}-${a.state}`))
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "flex justify-end lg:justify-end",
        children: profile.photoUrl ? /* @__PURE__ */ jsx("img", {
          src: profile.photoUrl,
          alt: `${displayName}, home inspector`,
          className: "w-full max-w-[360px] aspect-square rounded-full object-cover translate-y-12"
        }) : /* @__PURE__ */ jsx("div", {
          className: "w-full max-w-[360px] aspect-square rounded-full bg-ih-bg-muted text-ih-fg-4 flex items-center justify-center font-serif text-[96px] font-semibold",
          children: initials2 || "I"
        })
      })]
    }), profile.bio && /* @__PURE__ */ jsx("section", {
      className: "max-w-[640px] mx-auto px-6 lg:px-16 py-6 text-lg leading-relaxed text-ih-fg-3",
      children: profile.bio
    }), services.length > 0 && /* @__PURE__ */ jsx("section", {
      className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 max-w-[1200px] mx-auto px-6 lg:px-16 py-12",
      children: services.slice(0, 6).map((s) => /* @__PURE__ */ jsxs("article", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-6",
        children: [/* @__PURE__ */ jsx("div", {
          className: "font-mono text-xs text-ih-fg-4 uppercase tracking-wide",
          children: fmtDuration(s.durationMinutes)
        }), /* @__PURE__ */ jsx("div", {
          className: "font-serif text-[32px] font-semibold mt-2 mb-2 text-ih-fg-1",
          children: fmtPrice(s.price)
        }), /* @__PURE__ */ jsx("div", {
          className: "text-sm text-ih-fg-3",
          children: s.name
        })]
      }, s.name))
    }), /* @__PURE__ */ jsxs("div", {
      className: "bg-slate-900 dark:bg-slate-800 text-white dark:text-slate-300 py-6 px-6 lg:px-16 mt-12 flex flex-wrap justify-center gap-12 text-[13px] tracking-wide",
      children: [/* @__PURE__ */ jsx("span", {
        children: "Insured"
      }), /* @__PURE__ */ jsxs("span", {
        children: ["Licensed", profile.licenseNumber ? ` · ${profile.licenseNumber}` : ""]
      }), /* @__PURE__ */ jsxs("span", {
        children: [profile.serviceAreas.length, " service area", profile.serviceAreas.length === 1 ? "" : "s"]
      })]
    }), /* @__PURE__ */ jsx("section", {
      className: "text-center py-16 px-6",
      children: profile.slug && /* @__PURE__ */ jsx("a", {
        href: `/book/${tenantSlug}/${profile.slug}`,
        className: "inline-block bg-ih-primary text-white px-8 py-4 rounded-lg font-bold text-base hover:opacity-90 transition-opacity",
        children: "Book an inspection"
      })
    }), /* @__PURE__ */ jsxs("footer", {
      className: "text-center py-8 px-6 border-t border-ih-border text-[13px] text-ih-fg-4",
      children: [profile.email && /* @__PURE__ */ jsx("a", {
        href: `mailto:${profile.email}`,
        className: "hover:underline",
        children: "Contact via email"
      }), profile.phone && /* @__PURE__ */ jsx("span", {
        className: "ml-4",
        children: profile.phone
      })]
    })]
  });
});
const route16 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: inspectorProfile,
  loader: loader$Q,
  meta: meta$M
}, Symbol.toStringTag, { value: "Module" }));
function meta$L() {
  return [{
    title: "Inspector not found - OpenInspection"
  }];
}
async function loader$P({
  request
}) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug") || "unknown";
  const companyName = url.searchParams.get("company") || void 0;
  return {
    slug,
    companyName
  };
}
const inspectorNotFound = UNSAFE_withComponentProps(function InspectorNotFoundPage() {
  const {
    slug,
    companyName
  } = useLoaderData();
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center p-6 bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-[420px] text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "font-serif text-[32px] font-semibold mb-4 text-ih-fg-1",
        children: "Inspector not found"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-ih-fg-3 text-[15px] leading-relaxed",
        children: ["We couldn't find an inspector with the link", " ", /* @__PURE__ */ jsxs("code", {
          className: "bg-ih-bg-muted px-1.5 py-0.5 rounded text-[13px] font-mono",
          children: ["/inspector/", slug]
        }), companyName ? ` at ${companyName}` : "", ". Double-check with whoever shared the link."]
      })]
    })
  });
});
const route17 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: inspectorNotFound,
  loader: loader$P,
  meta: meta$L
}, Symbol.toStringTag, { value: "Module" }));
function meta$K() {
  return [{
    title: "Report access - OpenInspection"
  }];
}
async function loader$O({
  params,
  request
}) {
  try {
    const res = await apiFetch(`/api/public/report-gate/${params.tenant}/${params.id}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      gate: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Not found"
    };
  } catch {
    return {
      gate: null,
      error: "Service unavailable"
    };
  }
}
function formatDate(scheduledDate) {
  if (!scheduledDate) return null;
  try {
    return new Date(scheduledDate).toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    });
  } catch {
    return scheduledDate;
  }
}
function formatAmount(amountCents, currency) {
  if (typeof amountCents !== "number" || amountCents <= 0) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: amountCents % 100 === 0 ? 0 : 2
  }).format(amountCents / 100);
}
const reportGate = UNSAFE_withComponentProps(function ReportGatePage() {
  const {
    gate,
    error
  } = useLoaderData();
  if (error || !gate) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3",
        children: "Report not found."
      })
    });
  }
  const title = gate.reason === "payment" ? "Pending payment" : "Pending agreement signature";
  const message = gate.reason === "payment" ? "Your inspection report is ready, but the invoice has not been paid yet. Please complete payment to view the report -- your inspector's contact details are listed below." : "Your inspection report is ready, but the inspection agreement has not been signed yet. Please sign the agreement to view the report.";
  const formattedDate = formatDate(gate.scheduledDate);
  const formattedAmount = formatAmount(gate.amountCents, gate.currency);
  const ctaLabel = gate.reason === "payment" && formattedAmount ? `Pay ${formattedAmount} now` : gate.actionLabel;
  const hasContact = !!(gate.inspectorEmail || gate.inspectorPhone || gate.inspectorLicense);
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center p-6 bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-xl p-8 shadow-sm",
      children: [/* @__PURE__ */ jsxs("span", {
        className: "inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-semibold tracking-wide bg-ih-watch-bg text-ih-watch-fg mb-4",
        children: [/* @__PURE__ */ jsx("span", {
          className: "w-1.5 h-1.5 rounded-full bg-ih-watch-bg0 animate-pulse"
        }), title]
      }), /* @__PURE__ */ jsx("h1", {
        className: "font-serif text-[26px] font-semibold tracking-tight leading-tight mb-2 text-ih-fg-1",
        children: "Your report is almost ready."
      }), /* @__PURE__ */ jsx("p", {
        className: "text-sm text-ih-fg-3 leading-relaxed mb-6",
        children: message
      }), (formattedAmount || gate.propertyAddress || gate.inspectorName || formattedDate || hasContact) && /* @__PURE__ */ jsxs("div", {
        className: "bg-slate-50 dark:bg-slate-700/50 border border-ih-border rounded-lg p-4 mb-6 text-[13px] text-ih-fg-3",
        children: [formattedAmount && /* @__PURE__ */ jsxs("div", {
          className: "flex justify-between items-baseline pb-3 mb-3 border-b border-ih-border",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-[11px] uppercase tracking-wide text-ih-fg-4",
            children: "Amount due"
          }), /* @__PURE__ */ jsx("span", {
            className: "font-serif text-[22px] font-semibold text-ih-fg-1 tracking-tight",
            children: formattedAmount
          })]
        }), gate.propertyAddress && /* @__PURE__ */ jsx(MetaRow, {
          label: "Property",
          children: /* @__PURE__ */ jsx("strong", {
            className: "text-ih-fg-1 font-semibold",
            children: gate.propertyAddress
          })
        }), formattedDate && /* @__PURE__ */ jsx(MetaRow, {
          label: "Scheduled",
          children: formattedDate
        }), gate.inspectorName && /* @__PURE__ */ jsx(MetaRow, {
          label: "Inspector",
          children: gate.inspectorName
        }), hasContact && (gate.propertyAddress || gate.inspectorName || formattedDate) && /* @__PURE__ */ jsx("div", {
          className: "h-px bg-ih-bg-muted my-3"
        }), gate.inspectorEmail && /* @__PURE__ */ jsx(MetaRow, {
          label: "Email",
          children: /* @__PURE__ */ jsx("a", {
            href: `mailto:${gate.inspectorEmail}`,
            className: "text-ih-primary hover:underline",
            children: gate.inspectorEmail
          })
        }), gate.inspectorPhone && /* @__PURE__ */ jsx(MetaRow, {
          label: "Phone",
          children: /* @__PURE__ */ jsx("a", {
            href: `tel:${gate.inspectorPhone}`,
            className: "text-ih-primary hover:underline",
            children: gate.inspectorPhone
          })
        }), gate.inspectorLicense && /* @__PURE__ */ jsx(MetaRow, {
          label: "License",
          children: gate.inspectorLicense
        })]
      }), /* @__PURE__ */ jsx("a", {
        href: gate.actionUrl,
        className: "inline-flex items-center justify-center h-11 px-6 rounded-lg text-sm font-bold text-white hover:opacity-95 hover:-translate-y-px transition-all shadow-sm",
        style: {
          backgroundColor: gate.primaryColor
        },
        children: ctaLabel
      }), gate.reason === "payment" ? /* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-center gap-1.5 mt-5 text-[11px] text-ih-fg-4",
        children: [/* @__PURE__ */ jsxs("svg", {
          className: "w-3 h-3",
          viewBox: "0 0 16 16",
          fill: "none",
          stroke: "currentColor",
          strokeWidth: "1.5",
          children: [/* @__PURE__ */ jsx("rect", {
            x: "3",
            y: "7",
            width: "10",
            height: "6",
            rx: "1"
          }), /* @__PURE__ */ jsx("path", {
            d: "M5.5 7V5a2.5 2.5 0 0 1 5 0v2"
          })]
        }), "Secured by Stripe · ", gate.companyName]
      }) : /* @__PURE__ */ jsx("div", {
        className: "mt-5 text-center text-[11px] text-ih-fg-4",
        children: gate.companyName
      })]
    })
  });
});
function MetaRow({
  label,
  children
}) {
  return /* @__PURE__ */ jsxs("div", {
    className: "flex gap-2 items-baseline mt-1.5 first:mt-0",
    children: [/* @__PURE__ */ jsx("span", {
      className: "flex-none w-[80px] text-[11px] uppercase tracking-wide text-ih-fg-4",
      children: label
    }), /* @__PURE__ */ jsx("span", {
      className: "text-ih-fg-1",
      children
    })]
  });
}
const route18 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: reportGate,
  loader: loader$O,
  meta: meta$K
}, Symbol.toStringTag, { value: "Module" }));
function meta$J({
  data
}) {
  const d = data;
  return [{
    title: `Report - ${(d == null ? void 0 : d.address) ?? "Inspection"} - OpenInspection`
  }];
}
async function loader$N({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/report/${params.tenant}/${params.id}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      inspectionId: (d == null ? void 0 : d.inspectionId) ?? params.id ?? "",
      address: (d == null ? void 0 : d.address) ?? "",
      date: (d == null ? void 0 : d.date) ?? "",
      inspectorName: (d == null ? void 0 : d.inspectorName) ?? null,
      stats: (d == null ? void 0 : d.stats) ?? {
        total: 0,
        satisfactory: 0,
        monitor: 0,
        defect: 0
      },
      sections: (d == null ? void 0 : d.sections) ?? [],
      showEstimates: (d == null ? void 0 : d.showEstimates) ?? false,
      enableRepairList: (d == null ? void 0 : d.enableRepairList) ?? false,
      enableCustomerRepairExport: (d == null ? void 0 : d.enableCustomerRepairExport) ?? false,
      messageToken: (d == null ? void 0 : d.messageToken) ?? null,
      isDelivered: (d == null ? void 0 : d.isDelivered) ?? false,
      error: res.ok ? null : "Report not found",
      reportTheme: d == null ? void 0 : d.reportTheme
    };
  } catch {
    return {
      inspectionId: "",
      address: "",
      date: "",
      inspectorName: null,
      stats: {
        total: 0,
        satisfactory: 0,
        monitor: 0,
        defect: 0
      },
      sections: [],
      showEstimates: false,
      enableRepairList: false,
      enableCustomerRepairExport: false,
      messageToken: null,
      isDelivered: false,
      error: "Service unavailable"
    };
  }
}
const SECTION_ICONS = {
  roof: "🏠",
  exterior: "🏗️",
  electrical: "⚡",
  plumbing: "🔧",
  hvac: "❄️",
  interior: "🛋️",
  structural: "🏛️",
  appliances: "🔌"
};
function getSectionIcon(title) {
  const key = title.toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, v] of Object.entries(SECTION_ICONS)) {
    if (key.includes(k)) return v;
  }
  return "📋";
}
function isDefect(bucket) {
  return /defect|safety|major/i.test(bucket);
}
const reportCardStack = UNSAFE_withComponentProps(function ReportCardStackPage() {
  const data = useLoaderData();
  const [filter, setFilter] = useState("all");
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [repairPanel, setRepairPanel] = useState(false);
  const [repairItems, setRepairItems] = useState({});
  if (data.error) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3",
        children: data.error
      })
    });
  }
  const toggleRepairItem = (id) => {
    setRepairItems((prev) => ({
      ...prev,
      [id]: !prev[id]
    }));
  };
  const selectedRepairList = data.sections.flatMap((s) => s.items).filter((item) => repairItems[item.id]);
  const filteredSections = filter === "defects" ? data.sections.filter((s) => s.defectCount > 0).map((s) => ({
    ...s,
    items: s.items.filter((i) => isDefect(i.severityBucket))
  })) : data.sections;
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen bg-ih-bg-card",
    "data-theme": data.reportTheme || void 0,
    children: [/* @__PURE__ */ jsxs("button", {
      type: "button",
      onClick: () => window.print(),
      className: "print:hidden fixed bottom-6 right-6 z-50 px-5 py-3 rounded-full bg-slate-900 text-white text-xs font-bold uppercase tracking-widest shadow-2xl hover:bg-ih-primary transition-all flex items-center gap-2",
      children: [/* @__PURE__ */ jsx("svg", {
        className: "w-4 h-4",
        fill: "none",
        stroke: "currentColor",
        viewBox: "0 0 24 24",
        children: /* @__PURE__ */ jsx("path", {
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeWidth: "2",
          d: "M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v10a2 2 0 01-2 2H5a2 2 0 01-2-2z"
        })
      }), "Download PDF"]
    }), /* @__PURE__ */ jsxs("div", {
      className: "max-w-4xl mx-auto px-4 sm:px-6 pt-8 pb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-start justify-between mb-6",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-3",
          children: [/* @__PURE__ */ jsx("div", {
            className: "w-10 h-10 rounded-full bg-green-500/10 flex items-center justify-center",
            children: /* @__PURE__ */ jsx("svg", {
              className: "w-5 h-5 text-green-500",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ jsx("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              })
            })
          }), /* @__PURE__ */ jsx("span", {
            className: "text-xs font-semibold tracking-widest uppercase text-ih-fg-4",
            children: "Certified Inspection Report"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-2 print:hidden",
          children: [data.messageToken && /* @__PURE__ */ jsx("a", {
            href: `/messages/${data.messageToken}`,
            className: "px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
            children: "Message Inspector"
          }), data.enableRepairList && /* @__PURE__ */ jsx("a", {
            href: `/inspections/${data.inspectionId}/repair-list`,
            className: "px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
            children: "View Repair List"
          }), data.enableCustomerRepairExport && /* @__PURE__ */ jsx("a", {
            href: `/r/${data.inspectionId}/repair-request`,
            className: "px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
            children: "Generate repair request"
          }), /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => window.print(),
            className: "px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors",
            children: "PDF"
          }), /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setRepairPanel(!repairPanel),
            className: "px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-white flex items-center gap-2",
            children: "Repair Request"
          })]
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "text-2xl sm:text-3xl font-bold leading-tight mb-2 text-ih-fg-1",
        children: data.address
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-sm text-ih-fg-3",
        children: [data.date, " · Inspector: ", data.inspectorName || "N/A"]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "max-w-4xl mx-auto px-4 sm:px-6 mb-6",
      children: /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-2 sm:grid-cols-4 gap-3",
        children: [{
          label: "Total",
          value: data.stats.total,
          color: "text-ih-fg-1"
        }, {
          label: "Satisfactory",
          value: data.stats.satisfactory,
          color: "text-green-600 dark:text-green-400"
        }, {
          label: "Monitor",
          value: data.stats.monitor,
          color: "text-ih-watch-fg"
        }, {
          label: "Defects",
          value: data.stats.defect,
          color: "text-ih-bad-fg"
        }].map((s) => /* @__PURE__ */ jsxs("div", {
          className: "bg-ih-bg-card border border-ih-border rounded-lg p-4 text-center",
          children: [/* @__PURE__ */ jsx("div", {
            className: `text-2xl font-bold ${s.color}`,
            children: s.value
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[11px] text-ih-fg-4 uppercase tracking-widest mt-1",
            children: s.label
          })]
        }, s.label))
      })
    }), /* @__PURE__ */ jsx("div", {
      className: "max-w-4xl mx-auto px-4 sm:px-6 mb-8",
      children: /* @__PURE__ */ jsx("div", {
        className: "flex gap-2",
        children: ["all", "defects", "summary"].map((f) => /* @__PURE__ */ jsx("button", {
          type: "button",
          onClick: () => setFilter(f),
          className: `px-4 py-1.5 text-xs font-semibold rounded-full transition-all ${filter === f ? "bg-ih-primary text-white" : "border border-ih-border text-ih-fg-3"}`,
          children: f === "all" ? "All" : f === "defects" ? "Defects Only" : "Summary"
        }, f))
      })
    }), /* @__PURE__ */ jsx("div", {
      className: `max-w-4xl mx-auto px-4 sm:px-6 ${repairPanel ? "pb-[65vh]" : "pb-32"}`,
      children: filteredSections.map((section, sectionIdx) => {
        if (filter === "defects" && section.items.length === 0) return null;
        return /* @__PURE__ */ jsxs("div", {
          className: "mb-6 group/section relative",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-3 mb-4",
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-2xl",
              children: getSectionIcon(section.title)
            }), /* @__PURE__ */ jsxs("h2", {
              className: "text-2xl font-bold italic text-ih-fg-1",
              children: [/* @__PURE__ */ jsxs("span", {
                className: "font-mono not-italic mr-1 text-ih-fg-4",
                children: [sectionIdx + 1, " -"]
              }), section.title]
            }), /* @__PURE__ */ jsx("div", {
              className: "flex-1 h-px border-t border-ih-border"
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-xs font-mono text-ih-fg-4",
              children: [section.items.length, " items"]
            })]
          }), filter !== "summary" && /* @__PURE__ */ jsx("div", {
            className: "space-y-3",
            children: section.items.map((item) => {
              var _a, _b;
              return /* @__PURE__ */ jsx("div", {
                className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
                style: {
                  borderLeftWidth: 4,
                  borderLeftColor: item.ratingColor
                },
                children: /* @__PURE__ */ jsxs("div", {
                  className: "p-4",
                  children: [/* @__PURE__ */ jsxs("div", {
                    className: "flex items-start justify-between mb-2",
                    children: [/* @__PURE__ */ jsx("h3", {
                      className: "font-semibold text-ih-fg-1",
                      children: item.label
                    }), item.ratingLabel && /* @__PURE__ */ jsx("span", {
                      className: "text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide",
                      style: {
                        background: `${item.ratingColor}20`,
                        color: item.ratingColor
                      },
                      children: item.ratingLabel
                    })]
                  }), item.type && item.type !== "rich" && item.value !== void 0 && item.value !== null && item.value !== "" && /* @__PURE__ */ jsxs("p", {
                    className: "mt-2 text-sm font-semibold text-ih-fg-1",
                    children: [/* @__PURE__ */ jsx("span", {
                      className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mr-2",
                      children: item.type
                    }), Array.isArray(item.value) ? item.value.join(" · ") : item.type === "boolean" ? item.value ? "Yes" : "No" : String(item.value), item.unit && /* @__PURE__ */ jsx("span", {
                      className: "text-ih-fg-4 ml-1.5",
                      children: item.unit
                    })]
                  }), item.notes && /* @__PURE__ */ jsx("p", {
                    className: "text-sm text-ih-fg-3 mt-2 leading-relaxed",
                    children: item.notes
                  }), item.recommendation && /* @__PURE__ */ jsxs("div", {
                    className: "mt-2 flex items-center gap-2 flex-wrap",
                    children: [/* @__PURE__ */ jsxs("span", {
                      className: "text-[10px] font-semibold px-2 py-0.5 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 uppercase",
                      children: ["Recommend: ", item.recommendation]
                    }), data.showEstimates && (item.estimateMin != null || item.estimateMax != null) && /* @__PURE__ */ jsxs("span", {
                      className: "text-[11px] font-semibold px-2 py-0.5 rounded-md bg-ih-ok-bg text-ih-ok-fg tabular-nums",
                      children: ["Estimated cost: $", ((_a = item.estimateMin) == null ? void 0 : _a.toLocaleString()) ?? "?", " - $", ((_b = item.estimateMax) == null ? void 0 : _b.toLocaleString()) ?? "?"]
                    })]
                  }), item.photos.length > 0 && /* @__PURE__ */ jsx("div", {
                    className: "mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2",
                    children: item.photos.map((photo, idx) => /* @__PURE__ */ jsx("img", {
                      src: photo.url,
                      alt: `${item.label} photo ${idx + 1}`,
                      className: "w-full h-32 object-cover rounded cursor-pointer",
                      loading: "lazy",
                      onClick: () => setLightboxUrl(photo.url)
                    }, photo.key))
                  }), (item.severityBucket === "defect" || item.severityBucket === "monitor") && /* @__PURE__ */ jsxs("label", {
                    className: "flex items-center gap-2 mt-3 cursor-pointer text-sm text-ih-fg-3",
                    children: [/* @__PURE__ */ jsx("input", {
                      type: "checkbox",
                      checked: !!repairItems[item.id],
                      onChange: () => toggleRepairItem(item.id),
                      className: "rounded border-gray-300"
                    }), "Add to repair request"]
                  })]
                })
              }, item.id);
            })
          }), filter === "summary" && /* @__PURE__ */ jsx("div", {
            className: "bg-ih-bg-card border border-ih-border rounded-lg p-4",
            children: /* @__PURE__ */ jsxs("div", {
              className: "flex items-center justify-between",
              children: [/* @__PURE__ */ jsxs("span", {
                className: "font-medium text-ih-fg-1",
                children: [section.items.length, " items inspected"]
              }), /* @__PURE__ */ jsx("span", {
                className: "text-sm font-semibold",
                style: {
                  color: section.defectCount > 0 ? "#f43f5e" : "#22c55e"
                },
                children: section.defectCount > 0 ? `${section.defectCount} defect${section.defectCount > 1 ? "s" : ""}` : "All clear"
              })]
            })
          }), section.disclaimerText && filter !== "summary" && /* @__PURE__ */ jsxs("div", {
            className: "mt-4 px-4 py-3 rounded-md border border-ih-border bg-ih-watch-bg/40 text-[12px] leading-relaxed text-ih-fg-3",
            children: [/* @__PURE__ */ jsx("div", {
              className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-watch-fg mb-1",
              children: "Disclaimer"
            }), /* @__PURE__ */ jsx("p", {
              className: "whitespace-pre-line",
              children: section.disclaimerText
            })]
          })]
        }, section.id);
      })
    }), repairPanel && /* @__PURE__ */ jsx("div", {
      className: "fixed bottom-0 left-0 right-0 z-50 bg-ih-bg-card border-t border-ih-border max-h-[60vh] overflow-y-auto rounded-t-xl",
      children: /* @__PURE__ */ jsxs("div", {
        className: "max-w-4xl mx-auto p-6",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h3", {
            className: "text-lg font-bold text-ih-fg-1",
            children: "Repair Request"
          }), /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setRepairPanel(false),
            className: "text-slate-400 hover:text-slate-600 dark:hover:text-slate-300",
            children: /* @__PURE__ */ jsx("svg", {
              className: "w-5 h-5",
              fill: "none",
              stroke: "currentColor",
              viewBox: "0 0 24 24",
              children: /* @__PURE__ */ jsx("path", {
                strokeLinecap: "round",
                strokeLinejoin: "round",
                strokeWidth: "2",
                d: "M6 18L18 6M6 6l12 12"
              })
            })
          })]
        }), selectedRepairList.length === 0 ? /* @__PURE__ */ jsx("div", {
          className: "text-center py-8 text-ih-fg-4",
          children: 'No items selected. Check "Add to repair request" on defect cards above.'
        }) : /* @__PURE__ */ jsxs(Fragment, {
          children: [selectedRepairList.map((item) => /* @__PURE__ */ jsxs("div", {
            className: "flex items-center justify-between py-2 border-b border-ih-border",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("span", {
                className: "font-medium text-sm text-ih-fg-1",
                children: item.label
              }), item.recommendation && /* @__PURE__ */ jsxs("span", {
                className: "text-xs text-ih-fg-4 ml-2",
                children: ["-- ", item.recommendation]
              })]
            }), data.showEstimates && (item.estimateMin || item.estimateMax) && /* @__PURE__ */ jsxs("span", {
              className: "text-xs font-mono text-ih-fg-4",
              children: ["$", item.estimateMin || "?", " - $", item.estimateMax || "?"]
            })]
          }, item.id)), /* @__PURE__ */ jsxs("div", {
            className: "mt-4 flex items-center justify-between",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "text-sm font-semibold text-ih-fg-1",
              children: [selectedRepairList.length, " items"]
            }), /* @__PURE__ */ jsxs("div", {
              className: "flex gap-2",
              children: [/* @__PURE__ */ jsx("button", {
                type: "button",
                onClick: () => window.print(),
                className: "px-4 py-2 text-sm font-medium rounded-lg border border-ih-border text-ih-fg-3",
                children: "Export PDF"
              }), /* @__PURE__ */ jsx("button", {
                type: "button",
                className: "px-4 py-2 text-sm font-semibold rounded-lg bg-ih-primary text-white",
                children: "Send to Inspector"
              })]
            })]
          })]
        })]
      })
    }), lightboxUrl && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4 cursor-pointer",
      onClick: () => setLightboxUrl(null),
      children: /* @__PURE__ */ jsx("img", {
        src: lightboxUrl,
        alt: "",
        className: "max-w-full max-h-[90vh] object-contain rounded-lg"
      })
    })]
  });
});
const route19 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: reportCardStack,
  loader: loader$N,
  meta: meta$J
}, Symbol.toStringTag, { value: "Module" }));
function meta$I() {
  return [{
    title: "Messages - OpenInspection"
  }];
}
async function loader$M({
  params
}) {
  return {
    token: params.token ?? ""
  };
}
const messages = UNSAFE_withComponentProps(function MessagesPublicPage() {
  const {
    token
  } = useLoaderData();
  const [messages2, setMessages] = useState([]);
  const [inspection, setInspection] = useState(null);
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);
  const loadMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/public/messages/${token}`);
      const json = await res.json();
      if (json.success) {
        const data = json.data;
        setMessages(data.messages ?? []);
        if (data.inspection) setInspection(data.inspection);
      }
    } catch {
    }
  }, [token]);
  useEffect(() => {
    loadMessages();
  }, [loadMessages]);
  async function handleSend() {
    if (!composeBody.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/public/messages/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          body: composeBody
        })
      });
      if (res.ok) {
        setComposeBody("");
        loadMessages();
      }
    } catch {
    } finally {
      setSending(false);
    }
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-2xl mx-auto py-8 px-4",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold mb-2 text-ih-fg-1",
        children: "Messages"
      }), inspection && /* @__PURE__ */ jsxs("p", {
        className: "text-sm text-ih-fg-3 mb-6",
        children: ["Inspection: ", inspection.propertyAddress]
      }), /* @__PURE__ */ jsxs("div", {
        className: "space-y-3 max-h-[60vh] overflow-y-auto mb-4",
        children: [messages2.map((m) => /* @__PURE__ */ jsxs("div", {
          className: `rounded-md p-3 ${m.fromRole === "client" ? "ml-12 bg-ih-primary-tint" : "mr-12 bg-ih-watch-bg"}`,
          children: [/* @__PURE__ */ jsxs("div", {
            className: "text-xs text-ih-fg-3 mb-1",
            children: [m.fromName || m.fromRole, " ·", " ", new Date(m.createdAt).toLocaleString()]
          }), /* @__PURE__ */ jsx("p", {
            className: "text-sm whitespace-pre-wrap text-ih-fg-1",
            children: m.body
          }), m.attachments && m.attachments.length > 0 && /* @__PURE__ */ jsx("div", {
            className: "mt-2 flex flex-wrap gap-2",
            children: m.attachments.map((a) => /* @__PURE__ */ jsx("a", {
              href: `/api/photos/${encodeURIComponent(a.key)}`,
              target: "_blank",
              rel: "noreferrer",
              className: "text-xs bg-ih-bg-card border border-ih-border rounded-lg px-2 py-1 hover:bg-ih-bg-muted",
              children: a.name
            }, a.id))
          })]
        }, m.id)), messages2.length === 0 && /* @__PURE__ */ jsxs("div", {
          className: "text-center py-8",
          children: [/* @__PURE__ */ jsx("h3", {
            className: "font-semibold text-ih-fg-3",
            children: "No messages yet"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-sm text-ih-fg-3 mt-1",
            children: "Send the first one below."
          })]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "border-t border-ih-border pt-3 bg-ih-bg-card p-4 rounded-md",
        children: [/* @__PURE__ */ jsx("textarea", {
          value: composeBody,
          onChange: (e) => setComposeBody(e.target.value),
          rows: 3,
          placeholder: "Type your message...",
          className: "w-full px-3 py-2 rounded-xl border border-ih-border text-sm resize-none bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500"
        }), /* @__PURE__ */ jsx("div", {
          className: "mt-2 flex items-center justify-end",
          children: /* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: handleSend,
            disabled: !composeBody.trim() || sending,
            className: "px-4 py-2 rounded-xl bg-ih-primary text-white text-sm font-semibold disabled:opacity-50 transition-opacity",
            children: sending ? "Sending..." : "Send"
          })
        })]
      })]
    })
  });
});
const route20 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: messages,
  loader: loader$M,
  meta: meta$I
}, Symbol.toStringTag, { value: "Module" }));
function meta$H() {
  return [{
    title: "Repair Request - OpenInspection"
  }];
}
async function loader$L({
  params
}) {
  try {
    const res = await apiFetch(`/api/public/repair-request/${params.id}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      data: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Not found"
    };
  } catch {
    return {
      data: null,
      error: "Service unavailable"
    };
  }
}
const CATEGORY_TONE = {
  safety: {
    bg: "bg-ih-bad-bg",
    text: "text-ih-bad-fg",
    ring: "ring-rose-200 dark:ring-rose-800",
    label: "Safety"
  },
  recommendation: {
    bg: "bg-ih-watch-bg",
    text: "text-ih-watch-fg",
    ring: "ring-amber-200 dark:ring-amber-800",
    label: "Recommend"
  },
  maintenance: {
    bg: "bg-slate-50 dark:bg-slate-700/50",
    text: "text-ih-fg-3",
    ring: "ring-ih-border",
    label: "Maintain"
  }
};
function formatMoney(cents) {
  if (cents == null || cents <= 0) return "";
  return "$" + Math.round(cents / 100).toLocaleString();
}
function groupBySection(entries) {
  const order = [];
  const map = /* @__PURE__ */ new Map();
  for (const e of entries) {
    if (!map.has(e.sectionId)) {
      map.set(e.sectionId, {
        sectionId: e.sectionId,
        sectionTitle: e.sectionTitle,
        items: []
      });
      order.push(e.sectionId);
    }
    map.get(e.sectionId).items.push(e);
  }
  return order.map((id) => map.get(id));
}
const repairRequest = UNSAFE_withComponentProps(function CustomerRepairRequestPage() {
  const {
    data,
    error
  } = useLoaderData();
  const [email, setEmail] = useState((data == null ? void 0 : data.clientEmail) ?? "");
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState(null);
  const [itemNotes, setItemNotes] = useState({});
  if (error || !data) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3",
        children: "Repair request not found."
      })
    });
  }
  const grouped = groupBySection(data.defects);
  async function sendEmail() {
    if (!email || sending || !data) return;
    setSending(true);
    setToast(null);
    try {
      const res = await fetch("/api/public/repair-request/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          inspectionId: data.inspectionId,
          recipientEmail: email,
          itemNotes
        })
      });
      if (res.ok) {
        setToast({
          text: "Email sent!",
          error: false
        });
      } else {
        setToast({
          text: "Failed to send email",
          error: true
        });
      }
    } catch {
      setToast({
        text: "Network error",
        error: true
      });
    } finally {
      setSending(false);
    }
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-3xl mx-auto px-4 sm:px-6 py-8",
    children: [/* @__PURE__ */ jsxs("header", {
      className: "mb-6",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1",
        children: "Repair Request"
      }), /* @__PURE__ */ jsx("h1", {
        className: "text-[24px] sm:text-[28px] font-semibold tracking-tight text-ih-fg-1 leading-tight",
        children: data.propertyAddress
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mt-2",
        children: "Generated from your inspection report. Review the items below, add any comments for your contractor, then print this list or email a copy to yourself."
      }), (data.inspectionDate || data.inspectorName) && /* @__PURE__ */ jsxs("p", {
        className: "text-[12px] text-ih-fg-3 mt-1",
        children: [data.inspectionDate && /* @__PURE__ */ jsxs("span", {
          children: ["Inspected", " ", /* @__PURE__ */ jsx("strong", {
            className: "text-ih-fg-3",
            children: data.inspectionDate
          })]
        }), data.inspectorName && /* @__PURE__ */ jsxs("span", {
          children: [" ", "· By", " ", /* @__PURE__ */ jsx("strong", {
            className: "text-ih-fg-3",
            children: data.inspectorName
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "print:hidden mb-6 flex flex-wrap items-center gap-2",
      children: [/* @__PURE__ */ jsxs("button", {
        type: "button",
        onClick: () => window.print(),
        className: "inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-700 transition-colors",
        children: [/* @__PURE__ */ jsx("svg", {
          className: "w-4 h-4",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ jsx("path", {
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: "2",
            d: "M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
          })
        }), "Download PDF"]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2 flex-1 min-w-[260px]",
        children: [/* @__PURE__ */ jsx("input", {
          type: "email",
          value: email,
          onChange: (e) => setEmail(e.target.value),
          placeholder: "you@example.com",
          className: "flex-1 h-9 px-3 rounded-md border border-ih-border text-[13px] text-ih-fg-1 placeholder-slate-400 bg-ih-bg-card focus:outline-none focus:ring-2 focus:ring-slate-300"
        }), /* @__PURE__ */ jsx("button", {
          type: "button",
          onClick: sendEmail,
          disabled: sending || !email,
          className: "inline-flex items-center gap-1.5 px-3 h-9 rounded-md bg-blue-600 text-white text-[12px] font-bold hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed transition-colors",
          children: sending ? "Sending..." : "Email this list to me"
        })]
      })]
    }), toast && /* @__PURE__ */ jsx("div", {
      className: `print:hidden mb-4 px-4 py-2 rounded-md text-[13px] font-semibold ${toast.error ? "bg-ih-bad-bg text-ih-bad-fg border border-ih-bad" : "bg-ih-ok-bg text-ih-ok-fg border border-ih-ok"}`,
      children: toast.text
    }), data.defects.length === 0 && /* @__PURE__ */ jsxs("div", {
      className: "text-center py-12 px-6 rounded-md bg-ih-ok-bg border border-ih-ok",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-[14px] text-ih-ok-fg font-semibold",
        children: "Good news! No defects were flagged on your inspection."
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[12px] text-ih-ok-fg mt-1",
        children: "There is nothing to request a repair for."
      })]
    }), grouped.map((group) => /* @__PURE__ */ jsxs("section", {
      className: "space-y-3 mb-8",
      children: [/* @__PURE__ */ jsxs("header", {
        className: "flex items-baseline justify-between border-b border-ih-border pb-2",
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-[14px] font-bold text-ih-fg-1",
          children: group.sectionTitle
        }), /* @__PURE__ */ jsxs("span", {
          className: "text-[11px] text-ih-fg-4 font-mono",
          children: [group.items.length, " item", group.items.length === 1 ? "" : "s"]
        })]
      }), /* @__PURE__ */ jsx("ul", {
        className: "space-y-3",
        children: group.items.map((d, idx) => {
          const tone = CATEGORY_TONE[d.category];
          const lo = formatMoney(d.estimateLow);
          const hi = formatMoney(d.estimateHigh);
          const showEstimateBadge = data.showEstimates && (lo || hi);
          return /* @__PURE__ */ jsxs("li", {
            className: "rounded-md border border-ih-border bg-ih-bg-card px-5 py-4",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex items-start justify-between gap-3 mb-2",
              children: [/* @__PURE__ */ jsxs("div", {
                className: "flex-1 min-w-0",
                children: [/* @__PURE__ */ jsxs("div", {
                  className: "flex flex-wrap items-center gap-2 mb-1",
                  children: [/* @__PURE__ */ jsx("span", {
                    className: `inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${tone.bg} ${tone.text} ${tone.ring}`,
                    children: tone.label
                  }), /* @__PURE__ */ jsxs("span", {
                    className: "text-[11px] font-mono text-ih-fg-4",
                    children: [group.sectionTitle, " › ", d.itemLabel]
                  })]
                }), /* @__PURE__ */ jsx("p", {
                  className: "text-[14px] font-semibold text-ih-fg-1 leading-snug",
                  children: d.itemLabel
                }), d.location && /* @__PURE__ */ jsxs("p", {
                  className: "text-[12px] text-ih-fg-3 mt-0.5",
                  children: ["Location: ", d.location]
                })]
              }), d.recommendationLabel && /* @__PURE__ */ jsx("span", {
                className: "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 ring-1 ring-inset ring-blue-200 dark:ring-blue-800",
                children: d.recommendationLabel
              })]
            }), d.comment && /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3 leading-relaxed whitespace-pre-line",
              children: d.comment
            }), showEstimateBadge && /* @__PURE__ */ jsxs("div", {
              className: "mt-3 inline-flex items-center px-2 py-1 rounded-md text-[12px] font-semibold bg-ih-ok-bg text-ih-ok-fg tabular-nums",
              children: ["Estimated cost: ", lo || "$?", " - ", hi || "$?"]
            }), d.photos.length > 0 && /* @__PURE__ */ jsx("div", {
              className: "mt-3 grid grid-cols-3 gap-2",
              children: d.photos.slice(0, 6).map((p, pi) => /* @__PURE__ */ jsx("img", {
                src: p.url,
                alt: `${d.itemLabel} photo ${pi + 1}`,
                className: "w-full h-24 object-cover rounded border border-ih-border",
                loading: "lazy"
              }, p.key))
            }), /* @__PURE__ */ jsxs("div", {
              className: "mt-3",
              children: [/* @__PURE__ */ jsx("label", {
                htmlFor: `crr-note-${d.itemId}-${idx}`,
                className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 mb-1",
                children: "Your notes for the contractor"
              }), /* @__PURE__ */ jsx("textarea", {
                id: `crr-note-${d.itemId}-${idx}`,
                rows: 2,
                className: "w-full px-3 py-2 rounded-md border border-ih-border text-[13px] text-ih-fg-1 placeholder-slate-400 bg-slate-50 dark:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-300",
                placeholder: "Optional comment (e.g. preferred quote scope, timing, access details)",
                onChange: (e) => setItemNotes((prev) => ({
                  ...prev,
                  [d.itemId]: e.target.value
                }))
              })]
            })]
          }, d.itemId);
        })
      })]
    }, group.sectionId)), /* @__PURE__ */ jsxs("footer", {
      className: "print:hidden mt-12 pt-6 border-t border-ih-border text-[11px] text-ih-fg-4 text-center",
      children: ["Generated by ", /* @__PURE__ */ jsx("strong", {
        className: "text-ih-fg-3",
        children: "OpenInspection"
      }), ". This list reflects items flagged in your inspection report and does not constitute a legally binding contract or repair scope."]
    })]
  });
});
const route21 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: repairRequest,
  loader: loader$L,
  meta: meta$H
}, Symbol.toStringTag, { value: "Module" }));
function meta$G() {
  return [{
    title: "Signed Agreement - OpenInspection"
  }];
}
async function loader$K({
  params
}) {
  try {
    const res = await apiFetch(`/api/internal/agreement-render/${params.token}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      agreement: Object.keys(d).length > 0 ? d : null,
      error: res.ok ? null : "Not found"
    };
  } catch {
    return {
      agreement: null,
      error: "Service unavailable"
    };
  }
}
function ensureDataUri(b64) {
  if (!b64) return "";
  if (b64.startsWith("data:")) return b64;
  return "data:image/png;base64," + b64;
}
const agreementPrintable = UNSAFE_withComponentProps(function AgreementPrintablePage() {
  const {
    agreement,
    error
  } = useLoaderData();
  if (error || !agreement) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center p-6",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3",
        children: "Agreement not found."
      })
    });
  }
  const sigSrc = ensureDataUri(agreement.signatureBase64);
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen",
    style: {
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif",
      color: "#1e293b",
      fontSize: 13,
      lineHeight: 1.6,
      padding: 32
    },
    children: [/* @__PURE__ */ jsx("h1", {
      className: "text-[22px] font-bold tracking-tight mb-1 text-slate-900",
      children: agreement.agreementName
    }), /* @__PURE__ */ jsxs("div", {
      className: "text-[10px] text-ih-fg-3 font-mono mb-6",
      children: ["Envelope ID: ", agreement.envelopeId]
    }), /* @__PURE__ */ jsx("div", {
      className: "text-[13px] leading-[1.7] [&_p]:mb-3 [&_strong]:font-semibold [&_ol]:pl-6 [&_ul]:pl-6 [&_ol]:mb-3 [&_ul]:mb-3",
      dangerouslySetInnerHTML: {
        __html: agreement.bodyHtml
      }
    }), /* @__PURE__ */ jsxs("div", {
      className: "mt-12 pt-6 border-t border-slate-200",
      children: [/* @__PURE__ */ jsx("div", {
        className: "text-[10px] font-bold uppercase tracking-wide text-ih-fg-3 mb-3",
        children: "Signed by"
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-end gap-8",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex-1",
          children: [sigSrc ? /* @__PURE__ */ jsx("img", {
            src: sigSrc,
            alt: "Signature",
            className: "h-20 max-w-[240px] border-b border-slate-400 block mb-1.5"
          }) : /* @__PURE__ */ jsx("div", {
            className: "h-20 max-w-[240px] bg-slate-50 border-b border-slate-400 mb-1.5"
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[13px] font-semibold text-slate-900",
            children: agreement.clientName ?? agreement.clientEmail
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[10px] text-ih-fg-3 font-mono",
            children: agreement.clientEmail
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-[10px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
            children: "Date signed (UTC)"
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[13px] font-semibold text-slate-900",
            children: agreement.signedAtUtcIso ?? "--"
          })]
        })]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "mt-12 pt-4 border-t border-slate-200 text-[9px] text-slate-400 font-mono",
      children: "This document constitutes a binding electronic agreement under the United States Electronic Signatures in Global and National Commerce Act (15 U.S.C. section 7001 et seq.) and the Uniform Electronic Transactions Act (UETA). Independent verification: see Certificate of Completion."
    })]
  });
});
const route22 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: agreementPrintable,
  loader: loader$K,
  meta: meta$G
}, Symbol.toStringTag, { value: "Module" }));
function meta$F() {
  return [{
    title: "Setup - OpenInspection"
  }];
}
async function loader$J({
  request
}) {
  const token = await getToken(request);
  if (token) return redirect("/dashboard");
  try {
    const res = await apiFetch("/api/auth/setup-status");
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    if (d == null ? void 0 : d.isSetUp) {
      return redirect("/login");
    }
  } catch {
  }
  return {
    ready: true
  };
}
async function action$k({
  request
}) {
  var _a;
  const formData = await request.formData();
  const workspaceName = String(formData.get("workspaceName") || "");
  const adminName = String(formData.get("adminName") || "");
  const email = String(formData.get("email") || "");
  const password = String(formData.get("password") || "");
  const setupCode = String(formData.get("setupCode") || "");
  try {
    const res = await apiFetch("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify({
        workspaceName,
        adminName,
        email,
        password,
        setupCode
      }),
      csrf: true
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        error: ((_a = body == null ? void 0 : body.error) == null ? void 0 : _a.message) ?? "Setup failed. Please check your inputs."
      };
    }
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(/(?:inspector_token|__Host-inspector_token)=([^;]+)/);
    const jwt = tokenMatch == null ? void 0 : tokenMatch[1];
    if (jwt) {
      return createSessionWithToken(jwt, "/dashboard");
    }
    return {
      error: "Setup succeeded but no session was created"
    };
  } catch {
    return {
      error: "Network error — is the API server running?"
    };
  }
}
const setup = UNSAFE_withComponentProps(function SetupPage() {
  const actionData = useActionData();
  useLoaderData();
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "w-full max-w-md p-8",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-8",
        children: [/* @__PURE__ */ jsx("img", {
          src: "/logo.svg",
          alt: "",
          className: "w-8 h-8"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-lg font-bold text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1 mb-2",
        children: "Set up your workspace"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-sm text-ih-fg-3 mb-6",
        children: "Create the first admin account and configure your inspection workspace."
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Workspace name"
          }), /* @__PURE__ */ jsx("input", {
            name: "workspaceName",
            type: "text",
            required: true,
            autoFocus: true,
            placeholder: "Acme Home Inspections",
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Your name"
          }), /* @__PURE__ */ jsx("input", {
            name: "adminName",
            type: "text",
            required: true,
            autoComplete: "name",
            placeholder: "Mike Reynolds",
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          }), /* @__PURE__ */ jsx("p", {
            className: "mt-1 text-[11px] text-ih-fg-3",
            children: "Shown on your public booking link, signed agreements, and invoices."
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Admin email"
          }), /* @__PURE__ */ jsx("input", {
            name: "email",
            type: "email",
            required: true,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Password"
          }), /* @__PURE__ */ jsx("input", {
            name: "password",
            type: "password",
            required: true,
            minLength: 8,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Setup code"
          }), /* @__PURE__ */ jsx("input", {
            name: "setupCode",
            type: "text",
            required: true,
            placeholder: "000000",
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          }), /* @__PURE__ */ jsxs("p", {
            className: "mt-1 text-[11px] text-ih-fg-3",
            children: ["Find the 6-digit code in your Cloudflare deployment logs, or check the ", /* @__PURE__ */ jsx("code", {
              className: "px-1 py-0.5 bg-ih-bg-muted rounded text-ih-fg-3 font-mono text-[10px]",
              children: "setup_verification_code"
            }), " key in KV namespace."]
          })]
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg",
          children: actionData.error
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors",
          children: "Create Workspace"
        })]
      })]
    })
  });
});
const route23 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$k,
  default: setup,
  loader: loader$J,
  meta: meta$F
}, Symbol.toStringTag, { value: "Module" }));
function meta$E() {
  return [{
    title: "Inspection Form - OpenInspection"
  }];
}
async function loader$I({
  request,
  params
}) {
  const token = await requireToken(request);
  const id = params.id;
  try {
    const [inspRes, resultsRes] = await Promise.all([apiFetch(`/api/inspections/${id}`, {
      token
    }), apiFetch(`/api/inspections/${id}/results`, {
      token
    }).catch(() => null)]);
    const inspBody = inspRes.ok ? await inspRes.json() : {};
    const data = inspBody.data ?? {};
    let schema = null;
    if (data == null ? void 0 : data.templateSnapshot) {
      schema = data.templateSnapshot;
    } else if (data == null ? void 0 : data.template) {
      const tpl = data.template;
      const raw = tpl.schema;
      schema = typeof raw === "string" ? JSON.parse(raw) : raw;
    }
    if (schema == null ? void 0 : schema.sections) {
      schema.sections = schema.sections.map((sec) => {
        const s = {
          ...sec
        };
        if (!s.title && s.name) {
          s.title = s.name;
        }
        if (s.items) {
          s.items = s.items.map((item) => {
            const it = {
              ...item
            };
            if (!it.label && it.name) {
              it.label = it.name;
            }
            return it;
          });
        }
        return s;
      });
    }
    let existingResults = {};
    if (resultsRes && resultsRes.ok) {
      const rj = await resultsRes.json();
      existingResults = rj.data ?? {};
    }
    return {
      inspectionId: id,
      address: (data == null ? void 0 : data.propertyAddress) || (data == null ? void 0 : data.address) || "",
      status: (data == null ? void 0 : data.status) || "",
      sections: (schema == null ? void 0 : schema.sections) ?? [],
      existingResults,
      error: inspRes.ok ? null : "Inspection not found"
    };
  } catch {
    return {
      inspectionId: id,
      address: "",
      status: "",
      sections: [],
      existingResults: {},
      error: "Service unavailable"
    };
  }
}
async function action$j({
  request,
  params
}) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "save") {
    const results = formData.get("results");
    if (!results) return {
      error: "No results"
    };
    const res = await apiFetch(`/api/inspections/${params.id}/results/batch`, {
      method: "POST",
      token,
      body: results
    });
    if (!res.ok) return {
      error: "Failed to save results"
    };
    return {
      success: true
    };
  }
  if (intent === "complete") {
    const res = await apiFetch(`/api/inspections/${params.id}/complete`, {
      method: "POST",
      token
    });
    if (!res.ok) return {
      error: "Failed to mark as complete"
    };
    return {
      completed: true
    };
  }
  return {
    error: "Unknown intent"
  };
}
function FormField({
  item,
  value,
  onChange
}) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const base = "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-indigo-500 outline-none";
  switch (item.type) {
    case "boolean":
      return /* @__PURE__ */ jsxs("label", {
        className: "flex items-center gap-2",
        children: [/* @__PURE__ */ jsx("input", {
          type: "checkbox",
          checked: !!value,
          onChange: (e) => onChange(e.target.checked),
          className: "accent-indigo-600"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-[13px] text-ih-fg-3",
          children: item.label
        })]
      });
    case "select":
      return /* @__PURE__ */ jsxs("select", {
        value: String(value || ""),
        onChange: (e) => onChange(e.target.value),
        className: base,
        children: [/* @__PURE__ */ jsx("option", {
          value: "",
          children: "Select..."
        }), (_b = (_a = item.options) == null ? void 0 : _a.choices) == null ? void 0 : _b.map((opt) => /* @__PURE__ */ jsx("option", {
          value: opt,
          children: opt
        }, opt))]
      });
    case "multi_select":
      return /* @__PURE__ */ jsx("select", {
        multiple: true,
        value: String(value || "").split(",").filter(Boolean),
        onChange: (e) => {
          const selected = Array.from(e.target.selectedOptions).map((o) => o.value);
          onChange(selected.join(","));
        },
        className: `${base} min-h-[80px]`,
        children: (_d = (_c = item.options) == null ? void 0 : _c.choices) == null ? void 0 : _d.map((opt) => /* @__PURE__ */ jsx("option", {
          value: opt,
          children: opt
        }, opt))
      });
    case "textarea":
      return /* @__PURE__ */ jsx("textarea", {
        value: String(value || ""),
        onChange: (e) => onChange(e.target.value),
        rows: 3,
        className: base,
        placeholder: ((_e = item.options) == null ? void 0 : _e.placeholder) || item.label,
        maxLength: ((_f = item.options) == null ? void 0 : _f.maxLength) ?? void 0
      });
    case "number":
      return /* @__PURE__ */ jsx("input", {
        type: "number",
        value: value === "" || value == null ? "" : Number(value),
        onChange: (e) => onChange(e.target.value ? Number(e.target.value) : ""),
        className: base,
        placeholder: ((_g = item.options) == null ? void 0 : _g.placeholder) || item.label,
        min: ((_h = item.options) == null ? void 0 : _h.min) ?? void 0,
        max: ((_i = item.options) == null ? void 0 : _i.max) ?? void 0,
        step: ((_j = item.options) == null ? void 0 : _j.step) ?? void 0
      });
    case "date":
      return /* @__PURE__ */ jsx("input", {
        type: "date",
        value: String(value || ""),
        onChange: (e) => onChange(e.target.value),
        className: base
      });
    case "photo_only":
      return /* @__PURE__ */ jsx("div", {
        className: "p-4 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-slate-400",
        children: "Photo capture is available in the inspection editor"
      });
    case "rich":
      return null;
    // Handled by RichItemRenderer
    default:
      return /* @__PURE__ */ jsx("input", {
        type: "text",
        value: String(value || ""),
        onChange: (e) => onChange(e.target.value),
        className: base,
        placeholder: ((_k = item.options) == null ? void 0 : _k.placeholder) || item.label,
        maxLength: ((_l = item.options) == null ? void 0 : _l.maxLength) ?? void 0
      });
  }
}
function RichItemRenderer({
  item,
  result,
  onRatingChange,
  onNotesChange,
  ratingOptions
}) {
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-2",
    children: [/* @__PURE__ */ jsx("div", {
      className: "flex flex-wrap gap-1.5",
      children: ratingOptions.map((opt) => /* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: () => onRatingChange(opt),
        className: `px-3 py-1.5 rounded-md text-[11px] font-bold border transition-colors ${result.rating === opt ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-400" : "border-ih-border text-ih-fg-3 hover:border-slate-300"}`,
        children: opt
      }, opt))
    }), /* @__PURE__ */ jsx("textarea", {
      value: result.notes || "",
      onChange: (e) => onNotesChange(e.target.value),
      rows: 2,
      placeholder: "Notes...",
      className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-[13px] focus:shadow-ih-focus focus:border-indigo-500 outline-none"
    }), item.tabs && /* @__PURE__ */ jsx("div", {
      className: "flex flex-wrap gap-1",
      children: ["information", "limitations", "defects"].map((tab) => {
        var _a;
        return (((_a = item.tabs) == null ? void 0 : _a[tab]) || []).filter((c) => c.default).map((c) => /* @__PURE__ */ jsx("button", {
          type: "button",
          onClick: () => onNotesChange((result.notes || "") + (result.notes ? "\n" : "") + c.comment),
          className: "text-[10px] px-2 py-0.5 rounded bg-ih-bg-muted text-ih-fg-3 hover:bg-indigo-50 hover:text-ih-primary transition-colors",
          title: c.comment,
          children: c.title || c.comment.slice(0, 30)
        }, c.id));
      })
    })]
  });
}
const formRenderer = UNSAFE_withComponentProps(function FormRendererPage() {
  const {
    inspectionId,
    address,
    status,
    sections,
    existingResults,
    error
  } = useLoaderData();
  const fetcher = useFetcher();
  const [results, setResults] = useState(() => {
    const init = {};
    for (const sec of sections) {
      for (const item of sec.items) {
        const key = `_default:${sec.id}:${item.id}`;
        init[key] = existingResults[key] || existingResults[item.id] || {
          rating: null,
          value: null,
          notes: "",
          photos: []
        };
      }
    }
    return init;
  });
  const [openSections, setOpenSections] = useState(() => {
    var _a;
    const first = (_a = sections[0]) == null ? void 0 : _a.id;
    return first ? /* @__PURE__ */ new Set([first]) : /* @__PURE__ */ new Set();
  });
  const [activeSectionIdx, setActiveSectionIdx] = useState(0);
  const fetcherData = fetcher.data;
  const isSaving = fetcher.state === "submitting";
  function getKey(sectionId, itemId) {
    return `_default:${sectionId}:${itemId}`;
  }
  function getResult(sectionId, itemId) {
    const key = getKey(sectionId, itemId);
    return results[key] || {
      rating: null,
      value: null,
      notes: "",
      photos: []
    };
  }
  function updateResult(sectionId, itemId, patch) {
    const key = getKey(sectionId, itemId);
    setResults((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...patch
      }
    }));
  }
  function toggleSection(id) {
    setOpenSections((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }
  const totalItems = sections.reduce((acc, s) => acc + s.items.length, 0);
  const filledItems = useMemo(() => {
    let count = 0;
    for (const sec of sections) {
      for (const item of sec.items) {
        const r = getResult(sec.id, item.id);
        if (item.type === "rich" ? r.rating : r.value != null && r.value !== "") count++;
      }
    }
    return count;
  }, [results, sections]);
  const progress = totalItems > 0 ? Math.round(filledItems / totalItems * 100) : 0;
  function handleSave() {
    fetcher.submit({
      intent: "save",
      results: JSON.stringify({
        results
      })
    }, {
      method: "post"
    });
  }
  function handleComplete() {
    fetcher.submit({
      intent: "complete"
    }, {
      method: "post"
    });
  }
  function goToSection(idx) {
    setActiveSectionIdx(idx);
    const sec = sections[idx];
    if (sec) {
      setOpenSections((prev) => /* @__PURE__ */ new Set([...prev, sec.id]));
    }
  }
  if (error) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1",
        children: "Form Unavailable"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-2xl mx-auto py-8 px-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between mb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("div", {
          className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary mb-1",
          children: "Inspection Form"
        }), /* @__PURE__ */ jsx("h1", {
          className: "text-2xl font-bold text-ih-fg-1",
          children: address || "Field Checklist"
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-[11px] text-slate-400 font-mono mt-0.5",
          children: ["#", String(inspectionId || "").slice(0, 8).toUpperCase(), status && /* @__PURE__ */ jsx("span", {
            className: "ml-2 text-ih-fg-3",
            children: status.replace(/_/g, " ")
          })]
        })]
      }), /* @__PURE__ */ jsxs(Link, {
        to: "/dashboard",
        className: "h-8 px-3 rounded-md border border-ih-border text-[12px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-1.5",
        children: [/* @__PURE__ */ jsx("svg", {
          className: "w-3.5 h-3.5",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ jsx("path", {
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: 2,
            d: "M10 19l-7-7m0 0l7-7m-7 7h18"
          })
        }), "Dashboard"]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "mb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between mb-1",
        children: [/* @__PURE__ */ jsxs("span", {
          className: "text-[12px] font-bold text-ih-fg-3",
          children: [progress, "% complete"]
        }), /* @__PURE__ */ jsxs("span", {
          className: "text-[11px] text-slate-400",
          children: [filledItems, "/", totalItems, " items"]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden",
        children: /* @__PURE__ */ jsx("div", {
          className: "h-full rounded-full bg-ih-primary transition-all duration-300",
          style: {
            width: `${progress}%`
          }
        })
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "flex items-center gap-1 mb-6 overflow-x-auto pb-1",
      children: sections.map((sec, idx) => {
        const secFilled = sec.items.filter((item) => {
          const r = getResult(sec.id, item.id);
          return item.type === "rich" ? r.rating : r.value != null && r.value !== "";
        }).length;
        return /* @__PURE__ */ jsxs("button", {
          onClick: () => goToSection(idx),
          className: `shrink-0 px-3 py-1.5 rounded-md text-[11px] font-bold transition-colors ${activeSectionIdx === idx ? "bg-ih-primary text-white" : "bg-ih-bg-muted text-ih-fg-3 hover:bg-slate-200"}`,
          children: [sec.title, /* @__PURE__ */ jsxs("span", {
            className: "ml-1 opacity-70",
            children: [secFilled, "/", sec.items.length]
          })]
        }, sec.id);
      })
    }), (fetcherData == null ? void 0 : fetcherData.success) && /* @__PURE__ */ jsx("div", {
      className: "mb-6 px-4 py-3 rounded-lg bg-ih-ok-bg border border-ih-ok text-[13px] font-medium text-ih-ok-fg text-center",
      children: "Results saved successfully."
    }), (fetcherData == null ? void 0 : fetcherData.completed) && /* @__PURE__ */ jsx("div", {
      className: "mb-6 px-4 py-3 rounded-lg bg-ih-ok-bg border border-ih-ok text-[13px] font-medium text-ih-ok-fg text-center",
      children: "Inspection marked as complete!"
    }), (fetcherData == null ? void 0 : fetcherData.error) && /* @__PURE__ */ jsx("div", {
      className: "mb-6 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[13px] font-medium text-ih-bad-fg text-center",
      children: fetcherData.error
    }), /* @__PURE__ */ jsx("div", {
      className: "space-y-6",
      children: sections.map((section, secIdx) => /* @__PURE__ */ jsxs("fieldset", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden",
        children: [/* @__PURE__ */ jsxs("button", {
          type: "button",
          onClick: () => toggleSection(section.id),
          className: "w-full flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2",
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-[13px] font-bold text-ih-fg-1",
              children: section.title
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[10px] text-slate-400 font-mono",
              children: [section.items.length, " ", section.items.length === 1 ? "item" : "items"]
            })]
          }), /* @__PURE__ */ jsx("svg", {
            className: `w-4 h-4 text-slate-400 transition-transform ${openSections.has(section.id) ? "rotate-180" : ""}`,
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M19 9l-7 7-7-7"
            })
          })]
        }), section.disclaimerText && openSections.has(section.id) && /* @__PURE__ */ jsx("div", {
          className: "px-5 py-2 bg-ih-watch-bg text-[11px] text-ih-watch-fg border-t border-ih-watch",
          children: section.disclaimerText
        }), openSections.has(section.id) && /* @__PURE__ */ jsx("div", {
          className: "px-5 py-4 space-y-5 border-t border-slate-100 dark:border-slate-700",
          children: section.items.map((item) => {
            const r = getResult(section.id, item.id);
            return /* @__PURE__ */ jsxs("div", {
              children: [item.type !== "boolean" && /* @__PURE__ */ jsxs("label", {
                className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
                children: [item.label, item.required && /* @__PURE__ */ jsx("span", {
                  className: "text-ih-bad ml-0.5",
                  children: "*"
                }), item.isSafety && /* @__PURE__ */ jsx("span", {
                  className: "ml-1 text-[9px] font-bold text-ih-bad bg-ih-bad-bg px-1 py-0.5 rounded",
                  children: "SAFETY"
                })]
              }), item.description && /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-slate-400 mb-1.5",
                children: item.description
              }), item.type === "rich" ? /* @__PURE__ */ jsx(RichItemRenderer, {
                item,
                result: r,
                ratingOptions: item.ratingOptions || ["Inspected", "Not Inspected"],
                onRatingChange: (rating) => updateResult(section.id, item.id, {
                  rating
                }),
                onNotesChange: (notes) => updateResult(section.id, item.id, {
                  notes
                })
              }) : /* @__PURE__ */ jsx(FormField, {
                item,
                value: r.value ?? "",
                onChange: (val) => updateResult(section.id, item.id, {
                  value: val
                })
              })]
            }, item.id);
          })
        })]
      }, section.id))
    }), sections.length > 0 && /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-3 mt-8",
      children: [/* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: handleSave,
        disabled: isSaving,
        className: "flex-1 py-2.5 rounded-lg bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        children: isSaving ? "Saving..." : "Save Results"
      }), progress === 100 && /* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: handleComplete,
        disabled: isSaving,
        className: "py-2.5 px-6 rounded-lg bg-emerald-600 text-white font-bold text-[13px] hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
        children: "Complete"
      })]
    }), sections.length > 1 && /* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between mt-4",
      children: [/* @__PURE__ */ jsx("button", {
        onClick: () => goToSection(Math.max(0, activeSectionIdx - 1)),
        disabled: activeSectionIdx === 0,
        className: "text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary disabled:opacity-30 disabled:cursor-not-allowed",
        children: "← Previous section"
      }), /* @__PURE__ */ jsxs("span", {
        className: "text-[11px] text-slate-400",
        children: [activeSectionIdx + 1, " / ", sections.length]
      }), /* @__PURE__ */ jsx("button", {
        onClick: () => goToSection(Math.min(sections.length - 1, activeSectionIdx + 1)),
        disabled: activeSectionIdx === sections.length - 1,
        className: "text-[12px] font-bold text-ih-fg-3 hover:text-ih-primary disabled:opacity-30 disabled:cursor-not-allowed",
        children: "Next section →"
      })]
    }), sections.length === 0 && /* @__PURE__ */ jsx("div", {
      className: "p-6 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-slate-400",
      children: "No template sections found for this inspection."
    })]
  });
});
const route24 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$j,
  default: formRenderer,
  loader: loader$I,
  meta: meta$E
}, Symbol.toStringTag, { value: "Module" }));
function meta$D() {
  return [{
    title: "Accept Invite - OpenInspection"
  }];
}
async function loader$H({
  request
}) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    return {
      valid: false,
      error: "Missing invite token",
      invite: null
    };
  }
  try {
    const res = await apiFetch(`/api/auth/invite/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      return {
        valid: false,
        error: "Invalid or expired invite link",
        invite: null
      };
    }
    const body = await res.json();
    const d = body.data ?? {};
    return {
      valid: true,
      error: null,
      invite: Object.keys(d).length > 0 ? d : null
    };
  } catch {
    return {
      valid: false,
      error: "Service unavailable",
      invite: null
    };
  }
}
async function action$i({
  request
}) {
  var _a;
  const formData = await request.formData();
  const token = String(formData.get("token") || "");
  const password = String(formData.get("password") || "");
  const name = String(formData.get("name") || "");
  try {
    const res = await apiFetch("/api/auth/invite/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        password,
        name
      }),
      csrf: true
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        error: ((_a = body == null ? void 0 : body.error) == null ? void 0 : _a.message) ?? "Could not accept invite. The link may have expired."
      };
    }
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(/(?:inspector_token|__Host-inspector_token)=([^;]+)/);
    const jwt = tokenMatch == null ? void 0 : tokenMatch[1];
    if (jwt) {
      const {
        createSessionWithToken: createSession
      } = await Promise.resolve().then(() => session_server);
      return createSession(jwt, "/dashboard");
    }
    return redirect("/login");
  } catch {
    return {
      error: "Network error — is the API server running?"
    };
  }
}
const join = UNSAFE_withComponentProps(function JoinPage() {
  const {
    valid,
    error: loaderError,
    invite
  } = useLoaderData();
  const actionData = useActionData();
  if (!valid) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center p-8",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-2xl font-bold text-ih-fg-1 mb-2",
          children: "Invalid Invite"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-sm text-ih-fg-3",
          children: loaderError
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "w-full max-w-md p-8",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-8",
        children: [/* @__PURE__ */ jsx("img", {
          src: "/logo.svg",
          alt: "",
          className: "w-8 h-8"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-lg font-bold text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsxs("h1", {
        className: "text-2xl font-bold text-ih-fg-1 mb-2",
        children: ["Join ", (invite == null ? void 0 : invite.workspaceName) ?? "the team"]
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-sm text-ih-fg-3 mb-6",
        children: ["You have been invited", (invite == null ? void 0 : invite.email) ? ` as ${invite.email}` : "", ". Set your name and password to get started."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "token",
          value: new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Full name"
          }), /* @__PURE__ */ jsx("input", {
            name: "name",
            type: "text",
            required: true,
            autoFocus: true,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Password"
          }), /* @__PURE__ */ jsx("input", {
            name: "password",
            type: "password",
            required: true,
            minLength: 8,
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg",
          children: actionData.error
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors",
          children: "Accept Invite"
        })]
      })]
    })
  });
});
const route25 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$i,
  default: join,
  loader: loader$H,
  meta: meta$D
}, Symbol.toStringTag, { value: "Module" }));
function meta$C() {
  return [{
    title: "Join as Guest - OpenInspection"
  }];
}
async function loader$G({
  request
}) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") || "";
  if (!token) {
    return {
      valid: false,
      error: "Missing invite token",
      invite: null
    };
  }
  try {
    const res = await apiFetch(`/api/auth/guest/validate?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      return {
        valid: false,
        error: "Invalid or expired guest link",
        invite: null
      };
    }
    const body = await res.json();
    const d = body.data ?? {};
    return {
      valid: true,
      error: null,
      invite: Object.keys(d).length > 0 ? d : null
    };
  } catch {
    return {
      valid: false,
      error: "Service unavailable",
      invite: null
    };
  }
}
async function action$h({
  request
}) {
  var _a;
  const formData = await request.formData();
  const token = String(formData.get("token") || "");
  const name = String(formData.get("name") || "");
  try {
    const res = await apiFetch("/api/auth/guest/accept", {
      method: "POST",
      body: JSON.stringify({
        token,
        name
      }),
      csrf: true
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return {
        error: ((_a = body == null ? void 0 : body.error) == null ? void 0 : _a.message) ?? "Could not join. The link may have expired."
      };
    }
    const setCookieHeader = res.headers.get("set-cookie") || "";
    const tokenMatch = setCookieHeader.match(/(?:inspector_token|__Host-inspector_token)=([^;]+)/);
    const jwt = tokenMatch == null ? void 0 : tokenMatch[1];
    if (jwt) {
      return createSessionWithToken(jwt, "/dashboard");
    }
    return redirect("/dashboard");
  } catch {
    return {
      error: "Network error — is the API server running?"
    };
  }
}
const guestJoin = UNSAFE_withComponentProps(function GuestJoinPage() {
  const {
    valid,
    error: loaderError,
    invite
  } = useLoaderData();
  const actionData = useActionData();
  if (!valid) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
      children: /* @__PURE__ */ jsxs("div", {
        className: "text-center p-8",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-2xl font-bold text-ih-fg-1 mb-2",
          children: "Link Unavailable"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-sm text-ih-fg-3",
          children: loaderError
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-app",
    children: /* @__PURE__ */ jsxs("div", {
      className: "w-full max-w-md p-8",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-8",
        children: [/* @__PURE__ */ jsx("img", {
          src: "/logo.svg",
          alt: "",
          className: "w-8 h-8"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-lg font-bold text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1 mb-2",
        children: "Join as a guest"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-sm text-ih-fg-3 mb-6",
        children: invite ? `${invite.inspectorName} has invited you to collaborate on the inspection at ${invite.inspectionAddress}.` : "You have been invited to collaborate on an inspection."
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "token",
          value: new URL(typeof window !== "undefined" ? window.location.href : "http://localhost").searchParams.get("token") || ""
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-xs font-bold text-ih-fg-3 mb-1",
            children: "Your name"
          }), /* @__PURE__ */ jsx("input", {
            name: "name",
            type: "text",
            required: true,
            autoFocus: true,
            placeholder: "Jane Smith",
            className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-ih-fg-1 text-sm focus:shadow-ih-focus focus:border-indigo-500 outline-none"
          })]
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "px-3 py-2 rounded-lg bg-ih-bad-bg border border-ih-bad text-sm text-ih-bad-fg",
          children: actionData.error
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "w-full py-2.5 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors",
          children: "Join Inspection"
        })]
      })]
    })
  });
});
const route26 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$h,
  default: guestJoin,
  loader: loader$G,
  meta: meta$C
}, Symbol.toStringTag, { value: "Module" }));
function meta$B() {
  return [{
    title: "Resolve Conflicts - OpenInspection"
  }];
}
async function loader$F({
  request
}) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const inspectionId = url.searchParams.get("inspection") || "";
  if (!inspectionId) {
    return {
      conflicts: [],
      inspectionId: "",
      error: "No inspection specified"
    };
  }
  try {
    const res = await apiFetch(`/api/inspections/${inspectionId}/conflicts`, {
      token
    });
    if (!res.ok) {
      return {
        conflicts: [],
        inspectionId,
        error: "No conflicts found"
      };
    }
    const body = await res.json();
    return {
      conflicts: body.data ?? [],
      inspectionId,
      error: null
    };
  } catch {
    return {
      conflicts: [],
      inspectionId,
      error: "Service unavailable"
    };
  }
}
async function action$g({
  request
}) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const inspectionId = String(formData.get("inspectionId") || "");
  const resolutions = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("resolve:")) {
      resolutions[key.replace("resolve:", "")] = String(value);
    }
  }
  try {
    const res = await apiFetch(`/api/inspections/${inspectionId}/conflicts/resolve`, {
      method: "POST",
      token,
      body: JSON.stringify({
        resolutions
      })
    });
    if (!res.ok) return {
      error: "Failed to resolve conflicts"
    };
    return {
      success: true
    };
  } catch {
    return {
      error: "Network error"
    };
  }
}
const conflictResolver = UNSAFE_withComponentProps(function ConflictResolverPage() {
  const {
    conflicts,
    inspectionId,
    error
  } = useLoaderData();
  const fetcher = useFetcher();
  const [resolved, setResolved] = useState({});
  if (error) {
    return /* @__PURE__ */ jsxs("div", {
      className: "max-w-3xl mx-auto p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1",
        children: "Conflict Resolver"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error
      })]
    });
  }
  const allResolved = conflicts.length > 0 && Object.keys(resolved).length === conflicts.length;
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-6xl mx-auto py-8 px-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "mb-6",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1",
        children: "Resolve Conflicts"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3 mt-1",
        children: [conflicts.length, " conflict", conflicts.length !== 1 ? "s" : "", " detected — choose which version to keep for each field."]
      })]
    }), /* @__PURE__ */ jsxs(fetcher.Form, {
      method: "post",
      children: [/* @__PURE__ */ jsx("input", {
        type: "hidden",
        name: "inspectionId",
        value: inspectionId
      }), /* @__PURE__ */ jsx("div", {
        className: "space-y-4",
        children: conflicts.map((c) => {
          const choice = resolved[c.id];
          const resolvedValue = choice === "yours" ? c.yours : choice === "theirs" ? c.theirs : c.base;
          return /* @__PURE__ */ jsxs("div", {
            className: "bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border",
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-semibold text-ih-fg-1",
                children: c.item
              }), /* @__PURE__ */ jsxs("p", {
                className: "text-[11px] text-slate-400 mt-0.5",
                children: [c.section, " / ", c.field]
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-700",
              children: [/* @__PURE__ */ jsxs("button", {
                type: "button",
                onClick: () => setResolved((p) => ({
                  ...p,
                  [c.id]: "base"
                })),
                className: `p-4 text-left transition-colors ${choice === "base" ? "bg-ih-primary-tint ring-2 ring-inset ring-indigo-500" : "hover:bg-ih-bg-muted/30"}`,
                children: [/* @__PURE__ */ jsx("p", {
                  className: "text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-2",
                  children: "Base"
                }), /* @__PURE__ */ jsx("p", {
                  className: "text-[13px] text-ih-fg-3",
                  children: c.base ?? /* @__PURE__ */ jsx("span", {
                    className: "italic text-slate-400",
                    children: "empty"
                  })
                })]
              }), /* @__PURE__ */ jsxs("button", {
                type: "button",
                onClick: () => setResolved((p) => ({
                  ...p,
                  [c.id]: "yours"
                })),
                className: `p-4 text-left transition-colors ${choice === "yours" ? "bg-ih-ok-bg ring-2 ring-inset ring-emerald-500" : "hover:bg-ih-bg-muted/30"}`,
                children: [/* @__PURE__ */ jsx("p", {
                  className: "text-[11px] font-bold uppercase tracking-widest text-ih-ok-fg mb-2",
                  children: "Yours"
                }), /* @__PURE__ */ jsx("p", {
                  className: "text-[13px] text-ih-fg-3",
                  children: c.yours ?? /* @__PURE__ */ jsx("span", {
                    className: "italic text-slate-400",
                    children: "empty"
                  })
                })]
              }), /* @__PURE__ */ jsxs("button", {
                type: "button",
                onClick: () => setResolved((p) => ({
                  ...p,
                  [c.id]: "theirs"
                })),
                className: `p-4 text-left transition-colors ${choice === "theirs" ? "bg-ih-watch-bg ring-2 ring-inset ring-amber-500" : "hover:bg-ih-bg-muted/30"}`,
                children: [/* @__PURE__ */ jsx("p", {
                  className: "text-[11px] font-bold uppercase tracking-widest text-ih-watch-fg mb-2",
                  children: "Theirs"
                }), /* @__PURE__ */ jsx("p", {
                  className: "text-[13px] text-ih-fg-3",
                  children: c.theirs ?? /* @__PURE__ */ jsx("span", {
                    className: "italic text-slate-400",
                    children: "empty"
                  })
                })]
              })]
            }), choice && /* @__PURE__ */ jsx("input", {
              type: "hidden",
              name: `resolve:${c.id}`,
              value: resolvedValue ?? ""
            })]
          }, c.id);
        })
      }), conflicts.length > 0 && /* @__PURE__ */ jsxs("div", {
        className: "mt-6 flex items-center justify-between",
        children: [/* @__PURE__ */ jsxs("p", {
          className: "text-[13px] text-ih-fg-3",
          children: [Object.keys(resolved).length, " of ", conflicts.length, " resolved"]
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          disabled: !allResolved,
          className: "h-10 px-6 rounded-lg bg-ih-primary text-white font-bold text-sm hover:bg-ih-primary-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
          children: "Apply Resolutions"
        })]
      })]
    })]
  });
});
const route27 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$g,
  default: conflictResolver,
  loader: loader$F,
  meta: meta$B
}, Symbol.toStringTag, { value: "Module" }));
function meta$A() {
  return [{
    title: "Version Diff - OpenInspection"
  }];
}
async function loader$E({
  request,
  params
}) {
  const token = await requireToken(request);
  const {
    id,
    n
  } = params;
  try {
    const res = await apiFetch(`/api/inspections/${id}/versions/${n}/diff`, {
      token
    });
    if (!res.ok) {
      return {
        inspectionId: id,
        version: n,
        diffs: [],
        error: "Version not found"
      };
    }
    const body = await res.json();
    return {
      inspectionId: id,
      version: n,
      diffs: body.data ?? [],
      error: null
    };
  } catch {
    return {
      inspectionId: id,
      version: n,
      diffs: [],
      error: "Service unavailable"
    };
  }
}
const versionDiff = UNSAFE_withComponentProps(function VersionDiffPage() {
  const {
    inspectionId,
    version,
    diffs,
    error
  } = useLoaderData();
  if (error) {
    return /* @__PURE__ */ jsxs("div", {
      className: "max-w-3xl mx-auto p-8 text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-2xl font-bold text-ih-fg-1",
        children: "Version Diff"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-ih-fg-3 mt-2",
        children: error
      }), /* @__PURE__ */ jsx("a", {
        href: `/inspections/${inspectionId}/edit`,
        className: "inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
        children: "Back to Inspection"
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-4xl mx-auto py-8 px-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between mb-6",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsxs("h1", {
          className: "text-2xl font-bold text-ih-fg-1",
          children: ["Version ", version, " Changes"]
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: ["Inspection #", String(inspectionId).slice(0, 8).toUpperCase(), " — ", diffs.length, " change", diffs.length !== 1 ? "s" : ""]
        })]
      }), /* @__PURE__ */ jsx("a", {
        href: `/inspections/${inspectionId}/edit`,
        className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors inline-flex items-center",
        children: "Back to Editor"
      })]
    }), diffs.length === 0 ? /* @__PURE__ */ jsx("div", {
      className: "p-6 rounded-lg border border-dashed border-ih-border-strong text-center text-[13px] text-slate-400",
      children: "No changes in this version."
    }) : /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-[1fr_1fr_1fr] gap-0 text-[11px] font-bold uppercase tracking-widest text-slate-400 bg-ih-bg-app/30 border-b border-ih-border",
        children: [/* @__PURE__ */ jsx("div", {
          className: "px-4 py-3",
          children: "Field"
        }), /* @__PURE__ */ jsx("div", {
          className: "px-4 py-3 border-l border-ih-border",
          children: "Before"
        }), /* @__PURE__ */ jsx("div", {
          className: "px-4 py-3 border-l border-ih-border",
          children: "After"
        })]
      }), diffs.map((d, i) => /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-[1fr_1fr_1fr] gap-0 border-b last:border-b-0 border-slate-100 dark:border-slate-700",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "px-4 py-3",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[13px] font-semibold text-ih-fg-1",
            children: d.item
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-slate-400 mt-0.5",
            children: [d.section, " / ", d.field]
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "px-4 py-3 border-l border-ih-border bg-ih-bad-bg/50",
          children: /* @__PURE__ */ jsx("span", {
            className: "text-[13px] text-ih-bad-fg",
            children: d.before ?? /* @__PURE__ */ jsx("span", {
              className: "italic text-slate-400",
              children: "empty"
            })
          })
        }), /* @__PURE__ */ jsx("div", {
          className: "px-4 py-3 border-l border-ih-border bg-ih-ok-bg/50",
          children: /* @__PURE__ */ jsx("span", {
            className: "text-[13px] text-ih-ok-fg",
            children: d.after ?? /* @__PURE__ */ jsx("span", {
              className: "italic text-slate-400",
              children: "empty"
            })
          })
        })]
      }, i))]
    })]
  });
});
const route28 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: versionDiff,
  loader: loader$E,
  meta: meta$A
}, Symbol.toStringTag, { value: "Module" }));
function meta$z() {
  return [{
    title: "Book inspection"
  }];
}
async function loader$D({
  params,
  request
}) {
  const url = new URL(request.url);
  const style = url.searchParams.get("style") === "compact" ? "compact" : "full";
  try {
    const res = await apiFetch(`/api/public/embed/${params.tenant}/${params.slug}`);
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      data: d ? {
        slug: d.slug ?? params.slug ?? "",
        inspectorId: d.inspectorId ?? "",
        inspectorName: d.inspectorName ?? "Inspector",
        tenantSubdomain: d.tenantSubdomain ?? params.tenant ?? "",
        siteKey: d.siteKey ?? "",
        style
      } : null,
      error: res.ok ? null : "Not found"
    };
  } catch {
    return {
      data: null,
      error: "Service unavailable"
    };
  }
}
const bookingEmbed = UNSAFE_withComponentProps(function BookingEmbedPage() {
  const {
    data,
    error
  } = useLoaderData();
  const [showForm, setShowForm] = useState(false);
  if (error || !data) {
    return /* @__PURE__ */ jsx("div", {
      style: {
        padding: 16
      },
      children: /* @__PURE__ */ jsx("p", {
        style: {
          color: "#64748b",
          fontSize: 13
        },
        children: "Booking unavailable."
      })
    });
  }
  if (data.style === "compact" && !showForm) {
    return /* @__PURE__ */ jsxs("div", {
      className: "p-6 text-center bg-ih-bg-card border border-ih-border rounded-xl",
      children: [/* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3 mb-3",
        children: ["Book with ", data.inspectorName]
      }), /* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: () => setShowForm(true),
        className: "w-full px-4 py-3 bg-ih-primary text-white rounded-lg font-bold text-sm hover:opacity-90 transition-opacity",
        children: "Schedule an inspection"
      })]
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "p-4",
    children: /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-xl p-5",
      children: [/* @__PURE__ */ jsxs("h2", {
        className: "text-base font-bold text-ih-fg-1 mb-1",
        children: ["Book with ", data.inspectorName]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mb-4",
        children: "Pick a date and we'll confirm by email."
      }), /* @__PURE__ */ jsx(BookingForm, {
        data
      })]
    })
  });
});
function BookingForm({
  data
}) {
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState(null);
  async function handleSubmit(e) {
    var _a;
    e.preventDefault();
    setSubmitting(true);
    setStatus(null);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/public/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          slug: fd.get("slug"),
          inspectorId: fd.get("inspectorId"),
          address: fd.get("address"),
          clientName: fd.get("clientName"),
          clientEmail: fd.get("clientEmail"),
          clientPhone: fd.get("clientPhone") || void 0,
          date: fd.get("date"),
          turnstileToken: fd.get("cf-turnstile-response") || void 0
        })
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.success) {
        setStatus({
          text: "Booking request sent! Check your email.",
          ok: true
        });
        (_a = window.parent) == null ? void 0 : _a.postMessage({
          type: "oi-embed",
          kind: "success",
          slug: data.slug
        }, "*");
      } else {
        const err = json == null ? void 0 : json.error;
        setStatus({
          text: (err == null ? void 0 : err.message) || "Could not submit",
          ok: false
        });
      }
    } catch {
      setStatus({
        text: "Network error",
        ok: false
      });
    } finally {
      setSubmitting(false);
    }
  }
  return /* @__PURE__ */ jsxs("form", {
    onSubmit: handleSubmit,
    children: [/* @__PURE__ */ jsx("input", {
      type: "hidden",
      name: "slug",
      value: data.slug
    }), /* @__PURE__ */ jsx("input", {
      type: "hidden",
      name: "inspectorId",
      value: data.inspectorId
    }), /* @__PURE__ */ jsxs("div", {
      className: "mb-3",
      children: [/* @__PURE__ */ jsx("label", {
        className: "block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
        children: "Property address"
      }), /* @__PURE__ */ jsx("input", {
        type: "text",
        name: "address",
        required: true,
        placeholder: "123 Main St, Austin, TX",
        className: "w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "grid grid-cols-2 gap-3 mb-3",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("label", {
          className: "block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
          children: "Your name"
        }), /* @__PURE__ */ jsx("input", {
          type: "text",
          name: "clientName",
          required: true,
          placeholder: "Jane Doe",
          className: "w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
        })]
      }), /* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("label", {
          className: "block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
          children: "Email"
        }), /* @__PURE__ */ jsx("input", {
          type: "email",
          name: "clientEmail",
          required: true,
          placeholder: "jane@example.com",
          className: "w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "grid grid-cols-2 gap-3 mb-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("label", {
          className: "block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
          children: "Phone"
        }), /* @__PURE__ */ jsx("input", {
          type: "tel",
          name: "clientPhone",
          placeholder: "(555) 555-5555",
          className: "w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
        })]
      }), /* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("label", {
          className: "block text-[11px] font-bold uppercase tracking-wide text-ih-fg-3 mb-1",
          children: "Preferred date"
        }), /* @__PURE__ */ jsx("input", {
          type: "date",
          name: "date",
          required: true,
          className: "w-full px-2.5 py-2 border border-ih-border rounded-md text-sm bg-ih-bg-card text-ih-fg-1 outline-none focus:border-indigo-500 focus:shadow-ih-focus"
        })]
      })]
    }), /* @__PURE__ */ jsx("button", {
      type: "submit",
      disabled: submitting,
      className: "w-full px-4 py-3 bg-ih-primary text-white rounded-lg font-bold text-sm hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity",
      children: submitting ? "Submitting..." : "Request booking"
    }), status && /* @__PURE__ */ jsx("div", {
      className: `mt-3 text-[13px] ${status.ok ? "text-green-700 dark:text-green-400" : "text-ih-bad-fg"}`,
      children: status.text
    })]
  });
}
const route29 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: bookingEmbed,
  loader: loader$D,
  meta: meta$z
}, Symbol.toStringTag, { value: "Module" }));
function meta$y() {
  return [{
    title: "You're invited - OpenInspection"
  }];
}
async function loader$C({
  request
}) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  if (!token) {
    return {
      invite: null,
      error: "no-token"
    };
  }
  try {
    const res = await apiFetch(`/api/agents/invite-info?token=${encodeURIComponent(token)}`);
    const body = res.ok ? await res.json() : {};
    if (!res.ok) {
      return {
        invite: null,
        error: "expired"
      };
    }
    const data = body.data ?? {};
    return {
      invite: data && Object.keys(data).length > 0 ? {
        ...data,
        token
      } : null,
      error: null
    };
  } catch {
    return {
      invite: null,
      error: "unknown"
    };
  }
}
async function action$f({
  request
}) {
  const fd = await request.formData();
  const body = {
    token: fd.get("token"),
    password: fd.get("password"),
    name: fd.get("name")
  };
  const res = await apiFetch("/api/agents/accept", {
    method: "POST",
    body: JSON.stringify(body)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = json.error;
    return {
      error: (err == null ? void 0 : err.message) || "Could not accept invite",
      redirect: null
    };
  }
  const data = json.data;
  return {
    error: null,
    redirect: (data == null ? void 0 : data.redirect) || "/agent-dashboard"
  };
}
function getInitials(name) {
  return name.split(/\s+/).map((p) => {
    var _a;
    return ((_a = p[0]) == null ? void 0 : _a.toUpperCase()) ?? "";
  }).join("").slice(0, 2);
}
const inviteAccept = UNSAFE_withComponentProps(function AgentInviteAcceptPage() {
  const {
    invite,
    error: loaderError
  } = useLoaderData();
  const actionData = useActionData();
  const [submitting, setSubmitting] = useState(false);
  if (typeof window !== "undefined" && (actionData == null ? void 0 : actionData.redirect)) {
    window.location.href = actionData.redirect;
  }
  if (loaderError || !invite) {
    return /* @__PURE__ */ jsx("div", {
      className: "min-h-screen flex items-center justify-center bg-ih-bg-card p-6",
      children: /* @__PURE__ */ jsxs("div", {
        className: "max-w-md text-center",
        children: [/* @__PURE__ */ jsx("h1", {
          className: "font-serif text-2xl font-bold mb-3 text-ih-fg-1",
          children: "Invite unavailable"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[15px] text-ih-fg-3 mb-6",
          children: "This invite link is expired, already used, or invalid."
        }), /* @__PURE__ */ jsx("a", {
          href: "/agent-signup",
          className: "inline-block px-6 py-3 bg-ih-primary text-white rounded-xl font-semibold hover:opacity-90 transition-opacity",
          children: "Sign up directly instead"
        })]
      })
    });
  }
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-[540px] mx-auto px-6 py-14",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 mb-10",
        children: [/* @__PURE__ */ jsx("img", {
          src: "/logo.svg",
          alt: "",
          className: "w-8 h-8"
        }), /* @__PURE__ */ jsx("span", {
          className: "font-serif font-bold text-lg tracking-tight text-ih-fg-1",
          children: "OpenInspection"
        })]
      }), /* @__PURE__ */ jsx("h1", {
        className: "font-serif font-bold text-4xl leading-tight tracking-tight mb-3 text-ih-fg-1",
        children: "You're invited"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-base text-ih-fg-3 leading-relaxed mb-9",
        children: [/* @__PURE__ */ jsx("strong", {
          className: "text-ih-fg-1",
          children: invite.inspector.name
        }), " ", "at", " ", /* @__PURE__ */ jsx("strong", {
          className: "text-ih-fg-1",
          children: invite.tenantName
        }), " ", "has invited you to be a partner agent. See every inspection your inspectors complete for the clients you refer."]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-4 p-5 bg-ih-bg-card border border-ih-border rounded-2xl mb-8",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-14 h-14 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center font-serif font-bold text-xl shrink-0 overflow-hidden",
          children: invite.inspector.photoUrl ? /* @__PURE__ */ jsx("img", {
            src: invite.inspector.photoUrl,
            alt: invite.inspector.name,
            className: "w-full h-full object-cover rounded-full"
          }) : getInitials(invite.inspector.name)
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("div", {
            className: "font-semibold text-base text-ih-fg-1",
            children: invite.inspector.name
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[14px] text-ih-fg-3 mt-0.5",
            children: invite.tenantName
          })]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-1 sm:grid-cols-3 gap-3 mb-9",
        children: [{
          icon: "↗",
          title: "Real-time referrals",
          sub: "See reports the moment they're ready"
        }, {
          icon: "⊕",
          title: "Cross-tenant view",
          sub: "All your inspectors, one dashboard"
        }, {
          icon: "★",
          title: "Free",
          sub: "No fees, no card on file"
        }].map((v) => /* @__PURE__ */ jsxs("div", {
          className: "p-4 bg-ih-bg-card border border-ih-border rounded-xl text-center",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-2xl mb-2",
            children: v.icon
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[13px] font-semibold text-ih-fg-1 leading-snug",
            children: v.title
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[12px] text-ih-fg-3 mt-1",
            children: v.sub
          })]
        }, v.title))
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        autoComplete: "off",
        onSubmit: () => setSubmitting(true),
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "token",
          value: invite.token
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-5",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "email",
              className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
              children: "Email"
            }), /* @__PURE__ */ jsx("input", {
              type: "email",
              id: "email",
              name: "email",
              value: invite.inviteEmail,
              readOnly: true,
              className: "w-full px-4 py-3 text-[15px] bg-ih-bg-muted border border-ih-border rounded-xl text-ih-fg-3 cursor-not-allowed"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "name",
              className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
              children: "Your full name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              id: "name",
              name: "name",
              placeholder: "Jane Smith",
              required: true,
              minLength: 2,
              className: "w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "password",
              className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
              children: "Create a password"
            }), /* @__PURE__ */ jsx("input", {
              type: "password",
              id: "password",
              name: "password",
              placeholder: "At least 12 characters",
              required: true,
              minLength: 12,
              className: "w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
            })]
          })]
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          disabled: submitting,
          className: "w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-ih-primary rounded-xl hover:opacity-90 active:scale-[0.985] disabled:opacity-50 disabled:cursor-not-allowed transition-all",
          children: submitting ? "Setting up your account..." : "Accept invitation"
        }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
          className: "mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg",
          children: actionData.error
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "mt-10 text-xs text-ih-fg-4 text-center leading-relaxed",
        children: "By accepting you agree to receive notifications when your referrals are inspected. You can unsubscribe at any time."
      })]
    })
  });
});
const route30 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$f,
  default: inviteAccept,
  loader: loader$C,
  meta: meta$y
}, Symbol.toStringTag, { value: "Module" }));
function meta$x() {
  return [{
    title: "Invite expired - OpenInspection"
  }];
}
async function loader$B({
  request
}) {
  const url = new URL(request.url);
  const reason = url.searchParams.get("reason") || "unknown";
  const inviterName = url.searchParams.get("inviterName") || void 0;
  const inviterEmail = url.searchParams.get("inviterEmail") || void 0;
  const tenantName = url.searchParams.get("tenantName") || void 0;
  return {
    reason,
    inviterName,
    inviterEmail,
    tenantName
  };
}
function getHeadline(reason) {
  switch (reason) {
    case "used":
      return "This invite has already been used";
    case "no-token":
      return "No invite token in this link";
    default:
      return "This invite has expired";
  }
}
function getExplainer(reason) {
  switch (reason) {
    case "used":
      return "Looks like this invite has already been claimed. If that wasn't you, ask the inspector to resend.";
    case "no-token":
      return "The link is missing the invite token. Most likely the email got mangled in transit. Ask the inspector to copy the full link.";
    default:
      return "Invites expire after seven days. Ask the inspector for a fresh one -- the link below pre-fills the message.";
  }
}
function buildMailto(inviterEmail, inviterName, tenantName) {
  if (!inviterEmail) return null;
  const subject = "Could you re-send my partner agent invite?";
  const bodyLines = [`Hi${inviterName ? " " + inviterName : ""},`, "", `My partner-agent invite to ${tenantName || "OpenInspection"} expired before I could accept it. Could you re-send it?`, "", "Thanks!"];
  return `mailto:${inviterEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
}
const inviteExpired = UNSAFE_withComponentProps(function AgentInviteExpiredPage() {
  const {
    reason,
    inviterName,
    inviterEmail,
    tenantName
  } = useLoaderData();
  const mailto = buildMailto(inviterEmail, inviterName, tenantName);
  const inspector = inviterName || "the inspector who invited you";
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-card p-6",
    children: /* @__PURE__ */ jsxs("div", {
      className: "max-w-[480px] w-full bg-ih-bg-card border border-ih-border rounded-2xl p-10 text-center",
      children: [/* @__PURE__ */ jsx("span", {
        className: "inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-ih-watch-bg text-ih-watch-fg rounded-full text-xs font-semibold uppercase tracking-wide mb-5",
        children: "Invite needs a refresh"
      }), /* @__PURE__ */ jsx("h1", {
        className: "font-serif font-bold text-[1.75rem] leading-tight tracking-tight mb-3 text-ih-fg-1",
        children: getHeadline(reason)
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[15px] text-ih-fg-3 leading-relaxed mb-7",
        children: getExplainer(reason)
      }), mailto ? /* @__PURE__ */ jsxs("a", {
        href: mailto,
        className: "inline-block px-6 py-3 bg-ih-primary text-white font-semibold rounded-xl text-[15px] hover:opacity-90 transition-opacity",
        children: ["Ask ", inspector, " for a new invite"]
      }) : /* @__PURE__ */ jsx(Link, {
        to: "/agent-signup",
        className: "inline-block px-6 py-3 bg-ih-primary text-white font-semibold rounded-xl text-[15px] hover:opacity-90 transition-opacity",
        children: "Sign up directly instead"
      }), /* @__PURE__ */ jsx(Link, {
        to: "/agent-signup",
        className: "block mt-5 text-[14px] text-ih-fg-4 hover:text-slate-700 dark:hover:text-slate-300 transition-colors",
        children: "Or sign up directly without an invite"
      })]
    })
  });
});
const route31 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: inviteExpired,
  loader: loader$B,
  meta: meta$x
}, Symbol.toStringTag, { value: "Module" }));
function meta$w() {
  return [{
    title: "Page Not Found - OpenInspection"
  }];
}
const notFound = UNSAFE_withComponentProps(function NotFoundPage() {
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("div", {
      className: "text-center",
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-6xl font-bold text-slate-300 dark:text-slate-600",
        children: "404"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-lg font-semibold text-ih-fg-2 mt-4",
        children: "Page not found"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mt-2 max-w-sm",
        children: "The page you are looking for does not exist or has been moved."
      }), /* @__PURE__ */ jsx(Link, {
        to: "/",
        className: "inline-flex items-center gap-1.5 mt-6 h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors",
        children: "Go Home"
      })]
    })
  });
});
const route32 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: notFound,
  meta: meta$w
}, Symbol.toStringTag, { value: "Module" }));
function meta$v() {
  return [{
    title: "Feature Disabled - OpenInspection"
  }];
}
const featureDisabled = UNSAFE_withComponentProps(function FeatureDisabledPage() {
  return /* @__PURE__ */ jsx("div", {
    className: "min-h-screen flex items-center justify-center bg-ih-bg-card",
    children: /* @__PURE__ */ jsxs("div", {
      className: "text-center",
      children: [/* @__PURE__ */ jsx("div", {
        className: "w-16 h-16 mx-auto mb-4 rounded-xl bg-ih-watch-bg flex items-center justify-center",
        children: /* @__PURE__ */ jsx("svg", {
          className: "w-8 h-8 text-ih-watch dark:text-amber-400",
          fill: "none",
          stroke: "currentColor",
          viewBox: "0 0 24 24",
          children: /* @__PURE__ */ jsx("path", {
            strokeLinecap: "round",
            strokeLinejoin: "round",
            strokeWidth: 1.5,
            d: "M12 9v2m0 4h.01M10.29 3.86l-8.6 14.86A1 1 0 002.56 20h18.88a1 1 0 00.87-1.28l-8.6-14.86a1 1 0 00-1.72 0z"
          })
        })
      }), /* @__PURE__ */ jsx("p", {
        className: "text-lg font-semibold text-ih-fg-2",
        children: "Feature Not Available"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mt-2 max-w-sm mx-auto",
        children: "This feature is not enabled for your workspace. Contact your administrator or upgrade your plan."
      }), /* @__PURE__ */ jsx(Link, {
        to: "/dashboard",
        className: "inline-flex items-center gap-1.5 mt-6 h-9 px-4 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors",
        children: "Back to Dashboard"
      })]
    })
  });
});
const route33 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: featureDisabled,
  meta: meta$v
}, Symbol.toStringTag, { value: "Module" }));
function getStoredScheme() {
  if (typeof window === "undefined") return "auto";
  try {
    const v = localStorage.getItem("oi-color-scheme");
    if (v === "light" || v === "dark") return v;
  } catch {
  }
  return "auto";
}
function resolveScheme(scheme) {
  if (scheme !== "auto") return scheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyScheme(scheme) {
  const resolved = resolveScheme(scheme);
  const root2 = document.documentElement;
  root2.setAttribute("data-color-scheme", resolved);
  if (resolved === "dark") {
    root2.classList.add("dark");
  } else {
    root2.classList.remove("dark");
  }
}
function useTheme() {
  const [scheme, setScheme] = useState(getStoredScheme);
  useEffect(() => {
    applyScheme(scheme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (scheme === "auto") applyScheme("auto");
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [scheme]);
  const setColorScheme = useCallback((next) => {
    setScheme(next);
    try {
      if (next === "auto") {
        localStorage.removeItem("oi-color-scheme");
      } else {
        localStorage.setItem("oi-color-scheme", next);
      }
    } catch {
    }
    applyScheme(next);
  }, []);
  return { scheme, resolved: resolveScheme(scheme), setColorScheme };
}
function useSessionContext() {
  const data = useRouteLoaderData("routes/auth-layout");
  return (data == null ? void 0 : data.context) ?? null;
}
const STORAGE_KEY = "oi-sidebar-collapsed";
function getInitialCollapsed() {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
const IC = "w-4 h-4 shrink-0";
const WORKSPACE_ITEMS = [
  { to: "/dashboard", label: "Inspections", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" }) }) },
  { to: "/calendar", label: "Calendar", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" }) }) },
  { to: "/contacts", label: "Contacts", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" }) }) },
  { to: "/invoices", label: "Invoices", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" }) }) },
  { to: "/metrics", label: "Metrics", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" }) }) }
];
const LIBRARY_ITEMS = [
  { to: "/templates", label: "Templates", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" }) }) },
  { to: "/marketplace", label: "Marketplace", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z" }) }) },
  { to: "/comments", label: "Comments", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" }) }) },
  { to: "/recommendations", label: "Repair Items", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" }) }) },
  { to: "/library/tags", label: "Tags", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" }) }) },
  { to: "/agreements", label: "Agreements", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" }) }) },
  { to: "/library/rating-systems", label: "Rating Systems", icon: /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" }) }) }
];
function SidebarNavItem({ item, collapsed }) {
  return /* @__PURE__ */ jsxs(
    NavLink,
    {
      to: item.to,
      className: ({ isActive }) => `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"} ${collapsed ? "justify-center" : ""}`,
      title: collapsed ? item.label : void 0,
      children: [
        item.icon,
        !collapsed && /* @__PURE__ */ jsx("span", { children: item.label })
      ]
    }
  );
}
function SidebarGroup({ label, items, collapsed }) {
  return /* @__PURE__ */ jsxs("div", { className: "mb-[14px]", children: [
    !collapsed && /* @__PURE__ */ jsx("div", { className: "ih-eyebrow px-[10px] mb-[10px]", children: label }),
    /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-[2px]", children: items.map((item) => /* @__PURE__ */ jsx(SidebarNavItem, { item, collapsed }, item.to)) })
  ] });
}
function ThemeToggle({ collapsed }) {
  const { scheme, setColorScheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  const label = scheme === "auto" ? "Auto" : scheme === "dark" ? "Dark" : "Light";
  return /* @__PURE__ */ jsxs("div", { className: "relative", ref, children: [
    /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: () => setOpen(!open),
        className: "w-full flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all",
        title: collapsed ? `Theme: ${label}` : "Color scheme",
        children: [
          scheme === "dark" ? /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" }) }) : scheme === "light" ? /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" }) }) : /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" }) }),
          !collapsed && /* @__PURE__ */ jsx("span", { className: "flex-1 text-left", children: label }),
          !collapsed && /* @__PURE__ */ jsx("svg", { className: `w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M19 9l-7 7-7-7" }) })
        ]
      }
    ),
    open && /* @__PURE__ */ jsx("div", { className: "absolute bottom-full left-0 right-0 mb-1 bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-popover z-50 py-1 overflow-hidden", children: ["auto", "dark", "light"].map((mode) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        onClick: () => {
          setColorScheme(mode);
          setOpen(false);
        },
        className: "w-full flex items-center gap-2 px-3 py-2 text-[12px] text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-colors",
        children: [
          /* @__PURE__ */ jsx("span", { className: "flex-1 text-left capitalize", children: mode }),
          scheme === mode && /* @__PURE__ */ jsx("svg", { className: "w-3.5 h-3.5 text-ih-primary", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M5 13l4 4L19 7" }) })
        ]
      },
      mode
    )) })
  ] });
}
function MobileDrawer({ open, onClose }) {
  var _a, _b, _c, _d, _e;
  const { scheme, setColorScheme } = useTheme();
  const ctx = useSessionContext();
  const siteName = ((_a = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _a.siteName) || "OpenInspection";
  const logoUrl = ((_b = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _b.logoUrl) || "/logo.svg";
  const showSwitchWorkspace = ((_c = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _c.isSharedSaas) && ((_d = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _d.portalBaseUrl);
  if (!open) return null;
  return /* @__PURE__ */ jsxs("div", { className: "fixed inset-0 z-50 lg:hidden", children: [
    /* @__PURE__ */ jsx("div", { className: "absolute inset-0 bg-[rgba(15,23,42,0.55)] backdrop-blur-sm", onClick: onClose }),
    /* @__PURE__ */ jsxs("div", { className: "relative w-80 max-w-[85vw] h-full bg-ih-bg-card shadow-ih-popover flex flex-col", children: [
      /* @__PURE__ */ jsxs("div", { className: "p-4 flex items-center justify-between border-b border-ih-border", children: [
        /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
          /* @__PURE__ */ jsx("img", { src: logoUrl, alt: "", className: "w-7 h-7 shrink-0" }),
          /* @__PURE__ */ jsx("span", { className: "text-sm font-bold text-ih-fg-1 tracking-tight", children: siteName })
        ] }),
        /* @__PURE__ */ jsx("button", { onClick: onClose, className: "p-2 rounded-[6px] text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-fg-2 transition-colors", "aria-label": "Close menu", children: /* @__PURE__ */ jsx("svg", { className: "w-5 h-5", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M6 18L18 6M6 6l12 12" }) }) })
      ] }),
      /* @__PURE__ */ jsxs("nav", { className: "flex-1 p-3 overflow-y-auto space-y-3", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "ih-eyebrow px-3 pt-3 pb-[10px]", children: "Workspace" }),
          /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-[2px]", children: WORKSPACE_ITEMS.map((item) => /* @__PURE__ */ jsxs(NavLink, { to: item.to, onClick: onClose, className: ({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"}`, children: [
            item.icon,
            /* @__PURE__ */ jsx("span", { children: item.label })
          ] }, item.to)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("div", { className: "ih-eyebrow px-3 pt-1 pb-[10px]", children: "Library" }),
          /* @__PURE__ */ jsx("div", { className: "flex flex-col gap-[2px]", children: LIBRARY_ITEMS.map((item) => /* @__PURE__ */ jsxs(NavLink, { to: item.to, onClick: onClose, className: ({ isActive }) => `flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"}`, children: [
            item.icon,
            /* @__PURE__ */ jsx("span", { children: item.label })
          ] }, item.to)) })
        ] }),
        /* @__PURE__ */ jsxs("div", { className: "pt-3 mt-1 border-t border-ih-border", children: [
          /* @__PURE__ */ jsxs(NavLink, { to: "/settings", onClick: onClose, className: "flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all", children: [
            /* @__PURE__ */ jsxs("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [
              /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" }),
              /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })
            ] }),
            /* @__PURE__ */ jsx("span", { children: "Settings" })
          ] }),
          showSwitchWorkspace && ((_e = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _e.portalBaseUrl) && /* @__PURE__ */ jsxs("a", { href: `${ctx.branding.portalBaseUrl}/workspace/switch`, onClick: onClose, className: "flex items-center gap-3 px-3 py-2 rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all", children: [
            /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" }) }),
            /* @__PURE__ */ jsx("span", { children: "Switch workspace" })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "p-3 border-t border-ih-border bg-ih-bg-muted/50 space-y-1", children: [
        /* @__PURE__ */ jsx("div", { className: "flex gap-1", children: ["auto", "light", "dark"].map((mode) => /* @__PURE__ */ jsx("button", { onClick: () => setColorScheme(mode), className: `flex-1 py-1.5 rounded-[6px] text-[11px] font-bold transition-colors ${scheme === mode ? "bg-ih-primary-tint text-ih-primary" : "text-ih-fg-3 hover:bg-ih-bg-muted"}`, children: mode === "auto" ? "Auto" : mode === "dark" ? "Dark" : "Light" }, mode)) }),
        /* @__PURE__ */ jsxs("a", { href: "/logout", className: "w-full flex items-center gap-3 px-3 py-2 rounded-[6px] text-ih-bad-fg hover:bg-ih-bad-bg transition-all font-medium text-[13px]", children: [
          /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" }) }),
          /* @__PURE__ */ jsx("span", { children: "Sign Out" })
        ] })
      ] })
    ] })
  ] });
}
function MobileHeader() {
  var _a, _b;
  const [menuOpen, setMenuOpen] = useState(false);
  const ctx = useSessionContext();
  const siteName = ((_a = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _a.siteName) || "OpenInspection";
  const logoUrl = ((_b = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _b.logoUrl) || "/logo.svg";
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsxs("div", { className: "lg:hidden sticky top-0 z-40 bg-ih-bg-card border-b border-ih-border px-4 py-3 flex items-center justify-between", children: [
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3", children: [
        /* @__PURE__ */ jsx("img", { src: logoUrl, alt: "", className: "w-8 h-8 shrink-0" }),
        /* @__PURE__ */ jsx("span", { className: "text-lg font-extrabold text-ih-fg-1 tracking-tight", children: siteName })
      ] }),
      /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1", children: [
        /* @__PURE__ */ jsx(NavLink, { to: "/notifications", className: "relative flex items-center justify-center w-10 h-10 rounded-[6px] text-ih-fg-3 hover:bg-ih-bg-muted hover:text-ih-primary transition-all", "aria-label": "Notifications", children: /* @__PURE__ */ jsx("svg", { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" }) }) }),
        /* @__PURE__ */ jsx("button", { onClick: () => setMenuOpen(true), className: "p-2 rounded-[6px] text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-colors", "aria-label": "Open menu", children: /* @__PURE__ */ jsx("svg", { className: "w-6 h-6", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M4 6h16M4 12h16M4 18h16" }) }) })
      ] })
    ] }),
    /* @__PURE__ */ jsx(MobileDrawer, { open: menuOpen, onClose: () => setMenuOpen(false) })
  ] });
}
function Sidebar() {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i;
  const [collapsed, setCollapsed] = useState(false);
  const ctx = useSessionContext();
  const siteName = ((_a = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _a.siteName) || "OpenInspection";
  const logoUrl = ((_b = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _b.logoUrl) || "/logo.svg";
  const userName = ((_c = ctx == null ? void 0 : ctx.user) == null ? void 0 : _c.name) || "Inspector";
  const userSubline = ((_d = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _d.tenantSubdomain) || "openinspection.dev";
  const userInitials = ((_e = ctx == null ? void 0 : ctx.user) == null ? void 0 : _e.initials) || "OI";
  const showSwitchWorkspace = ((_f = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _f.isSharedSaas) && ((_g = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _g.portalBaseUrl);
  useEffect(() => {
    setCollapsed(getInitialCollapsed());
  }, []);
  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      if (next) {
        document.documentElement.setAttribute("data-sidebar-collapsed", "1");
      } else {
        document.documentElement.removeAttribute("data-sidebar-collapsed");
      }
    } catch {
    }
  }
  return /* @__PURE__ */ jsxs("aside", { className: "ih-sidebar bg-ih-bg-card border-r border-ih-border hidden lg:flex flex-col sticky top-0 h-screen overflow-hidden", children: [
    /* @__PURE__ */ jsxs("div", { className: `px-2 pt-1 pb-[14px] flex items-center gap-2.5 border-b border-ih-border shrink-0 ${collapsed ? "justify-center" : ""}`, children: [
      /* @__PURE__ */ jsx("img", { src: logoUrl, alt: "", className: "w-7 h-7 shrink-0" }),
      !collapsed && /* @__PURE__ */ jsxs(Fragment, { children: [
        /* @__PURE__ */ jsx("span", { className: "text-[14px] font-bold text-ih-fg-1 tracking-tight leading-tight truncate", children: siteName }),
        /* @__PURE__ */ jsx(NavLink, { to: "/notifications", className: "ml-auto relative flex items-center justify-center w-7 h-7 rounded-[6px] text-ih-fg-4 hover:bg-ih-bg-muted hover:text-ih-primary transition-all", "aria-label": "Notifications", children: /* @__PURE__ */ jsx("svg", { className: "w-4 h-4", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" }) }) })
      ] })
    ] }),
    !collapsed && /* @__PURE__ */ jsx("div", { className: "px-2 pt-2.5 pb-1", children: /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "w-full flex items-center gap-2 px-[10px] py-[7px] rounded-[6px] bg-ih-bg-muted hover:bg-ih-bg-muted/80 text-ih-fg-4 transition-all border border-ih-border text-[12px]",
        "aria-label": "Open command palette",
        children: [
          /* @__PURE__ */ jsx("svg", { className: "w-3.5 h-3.5 shrink-0", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z" }) }),
          /* @__PURE__ */ jsx("span", { className: "font-medium", children: "Search…" }),
          /* @__PURE__ */ jsx("kbd", { className: "ih-kbd ml-auto", children: typeof navigator !== "undefined" && ((_h = navigator.platform) == null ? void 0 : _h.startsWith("Mac")) ? "⌘K" : "Ctrl /" })
        ]
      }
    ) }),
    /* @__PURE__ */ jsxs("nav", { className: "flex-1 px-2 py-1 overflow-y-auto", children: [
      /* @__PURE__ */ jsx(SidebarGroup, { label: "Workspace", items: WORKSPACE_ITEMS, collapsed }),
      /* @__PURE__ */ jsx(SidebarGroup, { label: "Library", items: LIBRARY_ITEMS, collapsed })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "mt-auto px-2 py-2.5 border-t border-ih-border space-y-[2px]", children: [
      /* @__PURE__ */ jsxs(
        NavLink,
        {
          to: "/settings",
          className: ({ isActive }) => `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium transition-all ${isActive ? "bg-ih-primary-tint text-ih-primary font-bold" : "text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary"} ${collapsed ? "justify-center" : ""}`,
          title: collapsed ? "Settings" : void 0,
          children: [
            /* @__PURE__ */ jsxs("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [
              /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.572-1.065z" }),
              /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })
            ] }),
            !collapsed && /* @__PURE__ */ jsx("span", { children: "Settings" })
          ]
        }
      ),
      /* @__PURE__ */ jsx(ThemeToggle, { collapsed }),
      /* @__PURE__ */ jsxs(
        "button",
        {
          onClick: toggleCollapsed,
          className: `flex items-center gap-2 px-[10px] py-[6px] mt-1 rounded-[6px] bg-ih-bg-muted border border-ih-border text-ih-fg-3 hover:text-ih-primary text-[11px] font-bold transition-all w-full ${collapsed ? "justify-center" : ""}`,
          title: collapsed ? "Expand" : "Collapse",
          children: [
            collapsed ? /* @__PURE__ */ jsxs("svg", { className: "w-3.5 h-3.5 shrink-0", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [
              /* @__PURE__ */ jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", strokeWidth: "2" }),
              /* @__PURE__ */ jsx("line", { x1: "15", y1: "3", x2: "15", y2: "21", strokeWidth: "2" }),
              /* @__PURE__ */ jsx("polyline", { points: "7 9 10 12 7 15", strokeWidth: "2" })
            ] }) : /* @__PURE__ */ jsxs("svg", { className: "w-3.5 h-3.5 shrink-0", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: [
              /* @__PURE__ */ jsx("rect", { x: "3", y: "3", width: "18", height: "18", rx: "2", strokeWidth: "2" }),
              /* @__PURE__ */ jsx("line", { x1: "15", y1: "3", x2: "15", y2: "21", strokeWidth: "2" }),
              /* @__PURE__ */ jsx("polyline", { points: "10 9 7 12 10 15", strokeWidth: "2" })
            ] }),
            !collapsed && /* @__PURE__ */ jsx("span", { children: "Collapse" })
          ]
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: `flex items-center gap-2.5 px-2 py-1.5 mt-1 rounded-[6px] hover:bg-ih-bg-muted transition-all cursor-default ${collapsed ? "justify-center" : ""}`, children: [
        /* @__PURE__ */ jsx("div", { className: "w-8 h-8 rounded-full bg-gradient-to-br from-ih-primary to-ih-primary-700 flex items-center justify-center text-ih-fg-inverse text-[12px] font-bold shrink-0", children: userInitials }),
        !collapsed && /* @__PURE__ */ jsxs("div", { className: "flex-1 min-w-0", children: [
          /* @__PURE__ */ jsx("div", { className: "text-[12px] font-bold text-ih-fg-1 truncate", children: userName }),
          /* @__PURE__ */ jsx("div", { className: "text-[10px] text-ih-fg-4 font-[var(--font-ih-mono)] truncate", children: userSubline })
        ] })
      ] }),
      showSwitchWorkspace && ((_i = ctx == null ? void 0 : ctx.branding) == null ? void 0 : _i.portalBaseUrl) && /* @__PURE__ */ jsxs(
        "a",
        {
          href: `${ctx.branding.portalBaseUrl}/workspace/switch`,
          className: `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted hover:text-ih-primary transition-all ${collapsed ? "justify-center" : ""}`,
          title: collapsed ? "Switch workspace" : void 0,
          children: [
            /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" }) }),
            !collapsed && /* @__PURE__ */ jsx("span", { children: "Switch workspace" })
          ]
        }
      ),
      /* @__PURE__ */ jsxs(
        "a",
        {
          href: "/logout",
          className: `flex items-center gap-2.5 px-[10px] py-[7px] rounded-[6px] text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bad-bg hover:text-ih-bad-fg transition-all ${collapsed ? "justify-center" : ""}`,
          title: collapsed ? "Sign out" : void 0,
          children: [
            /* @__PURE__ */ jsx("svg", { className: IC, fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" }) }),
            !collapsed && /* @__PURE__ */ jsx("span", { children: "Sign Out" })
          ]
        }
      )
    ] })
  ] });
}
async function loader$A({
  request
}) {
  const token = await requireToken(request);
  let context = null;
  try {
    const res = await apiFetch("/api/session/context", {
      token
    });
    if (res.ok) {
      const body = await res.json();
      context = body.data;
    }
  } catch {
  }
  return {
    context
  };
}
const authLayout = UNSAFE_withComponentProps(function AuthLayout() {
  var _a, _b;
  const {
    context
  } = useLoaderData();
  return /* @__PURE__ */ jsxs(Fragment, {
    children: [((_a = context == null ? void 0 : context.branding) == null ? void 0 : _a.gaMeasurementId) && /* @__PURE__ */ jsxs(Fragment, {
      children: [/* @__PURE__ */ jsx("script", {
        async: true,
        src: `https://www.googletagmanager.com/gtag/js?id=${context.branding.gaMeasurementId}`
      }), /* @__PURE__ */ jsx("script", {
        dangerouslySetInnerHTML: {
          __html: `
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${context.branding.gaMeasurementId}');
              `
        }
      })]
    }), ((_b = context == null ? void 0 : context.branding) == null ? void 0 : _b.tenantStatus) === "suspended" && /* @__PURE__ */ jsx("div", {
      className: "bg-ih-watch-bg border-b border-ih-watch px-4 py-3 flex items-center justify-center gap-3 z-50",
      children: /* @__PURE__ */ jsx("p", {
        className: "text-sm font-semibold text-ih-watch-fg",
        children: "This workspace is suspended. You can view existing content but cannot create or edit inspections."
      })
    }), /* @__PURE__ */ jsx(MobileHeader, {}), /* @__PURE__ */ jsxs("div", {
      className: "flex min-h-screen",
      children: [/* @__PURE__ */ jsx(Sidebar, {}), /* @__PURE__ */ jsx("main", {
        className: "flex-1 w-full bg-ih-bg-app overflow-y-auto",
        children: /* @__PURE__ */ jsx("div", {
          className: "max-w-[1080px] mx-auto pt-5 pb-[60px] px-9",
          children: /* @__PURE__ */ jsx(Outlet, {})
        })
      })]
    })]
  });
});
const route34 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: authLayout,
  loader: loader$A
}, Symbol.toStringTag, { value: "Module" }));
const STEPS = ["Property", "Services", "Schedule", "Team"];
const PROPERTY_TYPES = [
  { value: "single_family", label: "Single Family" },
  { value: "multi_unit", label: "Multi-Unit" },
  { value: "commercial", label: "Commercial" }
];
const SERVICES = [
  "General Home Inspection",
  "Radon Testing",
  "Mold Inspection",
  "Termite / WDI",
  "Sewer Scope",
  "Pool & Spa",
  "Sprinkler System",
  "Well & Septic"
];
function NewInspectionWizard({ open, onClose }) {
  const fetcher = useFetcher();
  const [step, setStep] = useState(0);
  const [propertyType, setPropertyType] = useState("single_family");
  const [address, setAddress] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [services, setServices] = useState(/* @__PURE__ */ new Set());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("09:00");
  const [soloMode, setSoloMode] = useState(true);
  const [inspectorId, setInspectorId] = useState("");
  if (!open) return null;
  const toggleService = (s) => setServices((prev) => {
    const next = new Set(prev);
    next.has(s) ? next.delete(s) : next.add(s);
    return next;
  });
  const canNext = step === 0 ? address.length > 0 : step === 1 ? services.size > 0 : step === 2 ? date.length > 0 : true;
  function handleSubmit() {
    fetcher.submit(
      { intent: "create", propertyType, address, templateId, services: [...services].join(","), date, time, soloMode: String(soloMode), inspectorId },
      { method: "post", action: "/dashboard" }
    );
    onClose();
  }
  return /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm", onClick: onClose, children: /* @__PURE__ */ jsxs("div", { className: "w-full max-w-lg bg-ih-bg-card rounded-xl shadow-2xl", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between px-6 pt-5 pb-4 border-b border-ih-border", children: [
      /* @__PURE__ */ jsx("h2", { className: "text-[16px] font-bold", children: "New Inspection" }),
      /* @__PURE__ */ jsx("button", { onClick: onClose, className: "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-lg leading-none", children: "×" })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "flex items-center gap-1 px-6 pt-4", children: STEPS.map((s, i) => /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-1 flex-1", children: [
      /* @__PURE__ */ jsx("div", { className: `w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${i <= step ? "bg-ih-primary text-white" : "bg-slate-200 dark:bg-slate-700 text-slate-400"}`, children: i + 1 }),
      /* @__PURE__ */ jsx("span", { className: `text-[11px] font-medium hidden sm:inline ${i <= step ? "text-ih-primary" : "text-slate-400"}`, children: s }),
      i < STEPS.length - 1 && /* @__PURE__ */ jsx("div", { className: `flex-1 h-px mx-1 ${i < step ? "bg-ih-primary" : "bg-slate-200 dark:bg-slate-700"}` })
    ] }, s)) }),
    /* @__PURE__ */ jsxs("div", { className: "px-6 py-5 min-h-[220px]", children: [
      step === 0 && /* @__PURE__ */ jsxs("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Property Type" }),
          /* @__PURE__ */ jsx("div", { className: "flex gap-2", children: PROPERTY_TYPES.map((pt) => /* @__PURE__ */ jsx(
            "button",
            {
              onClick: () => setPropertyType(pt.value),
              className: `flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${propertyType === pt.value ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`,
              children: pt.label
            },
            pt.value
          )) })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Address" }),
          /* @__PURE__ */ jsx("input", { value: address, onChange: (e) => setAddress(e.target.value), placeholder: "123 Main St, City, State", className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Template (optional)" }),
          /* @__PURE__ */ jsx("input", { value: templateId, onChange: (e) => setTemplateId(e.target.value), placeholder: "Template ID or leave blank", className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" })
        ] })
      ] }),
      step === 1 && /* @__PURE__ */ jsxs("div", { className: "space-y-2", children: [
        /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Select Services" }),
        /* @__PURE__ */ jsx("div", { className: "grid grid-cols-2 gap-2", children: SERVICES.map((s) => /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => toggleService(s),
            className: `text-left px-3 py-2 rounded-md text-[12px] font-medium border transition-colors ${services.has(s) ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`,
            children: [
              services.has(s) ? "✓ " : "",
              s
            ]
          },
          s
        )) })
      ] }),
      step === 2 && /* @__PURE__ */ jsxs("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Date" }),
          /* @__PURE__ */ jsx("input", { type: "date", value: date, onChange: (e) => setDate(e.target.value), className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" })
        ] }),
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Time" }),
          /* @__PURE__ */ jsx("input", { type: "time", value: time, onChange: (e) => setTime(e.target.value), className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" })
        ] })
      ] }),
      step === 3 && /* @__PURE__ */ jsxs("div", { className: "space-y-4", children: [
        /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Team Mode" }),
          /* @__PURE__ */ jsxs("div", { className: "flex gap-2", children: [
            /* @__PURE__ */ jsx("button", { onClick: () => setSoloMode(true), className: `flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${soloMode ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`, children: "Solo" }),
            /* @__PURE__ */ jsx("button", { onClick: () => setSoloMode(false), className: `flex-1 py-2 rounded-md text-[12px] font-bold border transition-colors ${!soloMode ? "border-indigo-600 bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "border-ih-border text-ih-fg-3"}`, children: "Team" })
          ] })
        ] }),
        !soloMode && /* @__PURE__ */ jsxs("div", { children: [
          /* @__PURE__ */ jsx("label", { className: "block text-[12px] font-bold text-ih-fg-3 mb-1.5", children: "Inspector" }),
          /* @__PURE__ */ jsx("input", { value: inspectorId, onChange: (e) => setInspectorId(e.target.value), placeholder: "Inspector ID or name", className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:shadow-ih-focus outline-none" })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-t border-ih-border", children: [
      /* @__PURE__ */ jsx("button", { onClick: () => step > 0 ? setStep(step - 1) : onClose(), className: "h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted", children: step > 0 ? "Back" : "Cancel" }),
      step < STEPS.length - 1 ? /* @__PURE__ */ jsx("button", { disabled: !canNext, onClick: () => setStep(step + 1), className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed", children: "Next" }) : /* @__PURE__ */ jsx("button", { onClick: handleSubmit, className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600", children: "Create Inspection" })
    ] })
  ] }) });
}
const PAGES = [
  { id: "p-dashboard", label: "Dashboard", group: "Pages", icon: "page", to: "/dashboard", hint: "G then I" },
  { id: "p-reports", label: "Reports", group: "Pages", icon: "page", to: "/reports", hint: "G then R" },
  { id: "p-templates", label: "Templates", group: "Pages", icon: "page", to: "/templates", hint: "G then T" },
  { id: "p-marketplace", label: "Marketplace", group: "Pages", icon: "page", to: "/marketplace" },
  { id: "p-agreements", label: "Agreements", group: "Pages", icon: "page", to: "/agreements" },
  { id: "p-comments", label: "Comments", group: "Pages", icon: "page", to: "/comments" },
  { id: "p-repair", label: "Repair Items", group: "Pages", icon: "page", to: "/recommendations" },
  { id: "p-contacts", label: "Contacts", group: "Pages", icon: "page", to: "/contacts", hint: "G then C" },
  { id: "p-calendar", label: "Calendar", group: "Pages", icon: "page", to: "/calendar" },
  { id: "p-invoices", label: "Invoices", group: "Pages", icon: "page", to: "/invoices" },
  { id: "p-ratings", label: "Rating Systems", group: "Pages", icon: "page", to: "/library/rating-systems" },
  { id: "p-metrics", label: "Metrics", group: "Pages", icon: "page", to: "/metrics" },
  { id: "p-notifications", label: "Notifications", group: "Pages", icon: "page", to: "/notifications" }
];
const SETTINGS = [
  { id: "s-main", label: "Settings", group: "Settings", icon: "gear", to: "/settings" },
  { id: "s-profile", label: "Settings - Profile", group: "Settings", icon: "gear", to: "/settings/profile" },
  { id: "s-branding", label: "Settings - Branding", group: "Settings", icon: "gear", to: "/settings/workspace/branding" },
  { id: "s-theme", label: "Settings - Report Theme", group: "Settings", icon: "gear", to: "/settings/workspace/theme" },
  { id: "s-services", label: "Settings - Services & Pricing", group: "Settings", icon: "gear", to: "/settings/catalog/services" },
  { id: "s-email", label: "Settings - Email", group: "Settings", icon: "gear", to: "/settings/communication/email" },
  { id: "s-automations", label: "Settings - Automations", group: "Settings", icon: "gear", to: "/settings/communication/automations" },
  { id: "s-integrations", label: "Settings - Integrations", group: "Settings", icon: "gear", to: "/settings/communication/integrations" },
  { id: "s-password", label: "Settings - Change Password", group: "Settings", icon: "gear", to: "/settings/account/password" },
  { id: "s-2fa", label: "Settings - Two-factor (2FA)", group: "Settings", icon: "gear", to: "/settings/account/security" },
  { id: "s-payments", label: "Settings - Payments", group: "Settings", icon: "gear", to: "/settings/advanced/payments" },
  { id: "s-ai", label: "Settings - AI", group: "Settings", icon: "gear", to: "/settings/advanced/ai" },
  { id: "s-data", label: "Settings - Data Import / Export", group: "Settings", icon: "gear", to: "/settings/advanced/data" }
];
const QUICK_ACTIONS = [
  { id: "qa-new-inspection", label: "New Inspection", group: "Quick Actions", icon: "plus", hint: "create" },
  { id: "qa-new-template", label: "New Template", group: "Quick Actions", icon: "plus", hint: "create", to: "/templates?new=1" },
  { id: "qa-new-contact", label: "New Contact", group: "Quick Actions", icon: "plus", hint: "create", to: "/contacts?new=1" },
  { id: "qa-import", label: "Import Spectora", group: "Quick Actions", icon: "plus", to: "/templates?import=1" }
];
function score(label, query) {
  if (!query) return 1;
  const l = label.toLowerCase();
  const q = query.toLowerCase();
  if (l === q) return 1e3;
  if (l.startsWith(q)) return 500 + q.length / l.length * 100;
  const idx = l.indexOf(q);
  if (idx >= 0) return 200 + q.length / l.length * 100 - idx;
  let li = 0, qi = 0, hits = 0;
  while (li < l.length && qi < q.length) {
    if (l[li] === q[qi]) {
      hits++;
      qi++;
    }
    li++;
  }
  return qi === q.length ? hits : -1;
}
function PaletteIcon({ type }) {
  switch (type) {
    case "gear":
      return /* @__PURE__ */ jsxs("svg", { fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", className: "w-4 h-4 opacity-50", children: [
        /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" }),
        /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M15 12a3 3 0 11-6 0 3 3 0 016 0z" })
      ] });
    case "plus":
      return /* @__PURE__ */ jsx("svg", { fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", className: "w-4 h-4 opacity-50", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M12 4v16m8-8H4" }) });
    case "person":
      return /* @__PURE__ */ jsx("svg", { fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", className: "w-4 h-4 opacity-50", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" }) });
    case "clip":
      return /* @__PURE__ */ jsx("svg", { fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", className: "w-4 h-4 opacity-50", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" }) });
    default:
      return /* @__PURE__ */ jsx("svg", { fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", className: "w-4 h-4 opacity-50", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 2, d: "M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" }) });
  }
}
function CommandPalette({ onNewInspection }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [recentInspections, setRecentInspections] = useState([]);
  const [loadedRecents, setLoadedRecents] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const sessionCtx = useSessionContext();
  const bookingActions = useMemo(() => {
    var _a, _b, _c;
    const actions = [];
    const slug = (_a = sessionCtx == null ? void 0 : sessionCtx.branding) == null ? void 0 : _a.currentUserSlug;
    const host = (_b = sessionCtx == null ? void 0 : sessionCtx.branding) == null ? void 0 : _b.bookingHost;
    const tenant = (_c = sessionCtx == null ? void 0 : sessionCtx.branding) == null ? void 0 : _c.tenantSubdomain;
    if (slug && host && tenant) {
      const bookingUrl = `https://${host}/book/${tenant}/${slug}`;
      actions.push({
        id: "qa-copy-booking-link",
        label: "Copy my booking link",
        group: "Quick Actions",
        icon: "clip",
        hint: bookingUrl,
        onSelect: () => {
          navigator.clipboard.writeText(bookingUrl).catch(() => {
          });
        }
      });
    }
    return actions;
  }, [sessionCtx]);
  useEffect(() => {
    function handleKeyDown2(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery("");
        setActiveIdx(0);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", handleKeyDown2);
    return () => window.removeEventListener("keydown", handleKeyDown2);
  }, []);
  useEffect(() => {
    var _a;
    if (open) {
      (_a = inputRef.current) == null ? void 0 : _a.focus();
      if (!loadedRecents) {
        fetch("/api/inspections?pageSize=10", { credentials: "include" }).then((r) => r.ok ? r.json() : null).then((j) => {
          if (!j) return;
          const list = (j == null ? void 0 : j.data) || [];
          setRecentInspections(
            list.slice(0, 10).map((insp, i) => {
              const addr = [insp.address1, insp.city, insp.state].filter(Boolean).join(", ") || `Inspection #${String(insp.id || "").slice(0, 6)}`;
              return {
                id: `ri-${i}`,
                label: addr,
                group: "Recent Inspections",
                icon: "clip",
                hint: insp.status || "",
                to: `/inspections/${insp.id}/edit`
              };
            })
          );
          setLoadedRecents(true);
        }).catch(() => {
        });
      }
    }
  }, [open, loadedRecents]);
  const allItems = useMemo(() => {
    const isActions = query.startsWith(">");
    const isPeople = query.startsWith("@");
    const q = query.replace(/^[>@]\s*/, "");
    const dynamicQuickActions = [...QUICK_ACTIONS, ...bookingActions];
    let sources;
    if (isActions) {
      sources = dynamicQuickActions;
    } else if (isPeople) {
      sources = [];
    } else {
      sources = [...PAGES, ...recentInspections, ...SETTINGS, ...dynamicQuickActions];
    }
    if (!q) return sources;
    return sources.map((item) => ({ item, score: score(item.label, q) })).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).map((x) => x.item);
  }, [query, recentInspections]);
  const groups = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const a of allItems) {
      const list = map.get(a.group) || [];
      if (list.length < 8) list.push(a);
      map.set(a.group, list);
    }
    return map;
  }, [allItems]);
  const flatFiltered = useMemo(() => {
    const out = [];
    for (const items of groups.values()) out.push(...items);
    return out;
  }, [groups]);
  const safeIdx = Math.min(activeIdx, Math.max(0, flatFiltered.length - 1));
  const executeAction = useCallback((action2) => {
    setOpen(false);
    if (action2.id === "qa-new-inspection" && onNewInspection) {
      onNewInspection();
    } else if (action2.to) {
      navigate(action2.to);
    } else if (action2.onSelect) {
      action2.onSelect();
    }
  }, [navigate, onNewInspection]);
  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatFiltered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && flatFiltered[safeIdx]) {
      e.preventDefault();
      executeAction(flatFiltered[safeIdx]);
    }
  }
  if (!open) return null;
  return /* @__PURE__ */ jsx("div", { className: "fixed inset-0 z-[60] flex items-start justify-center pt-[15vh] bg-black/30 backdrop-blur-sm", onClick: () => setOpen(false), children: /* @__PURE__ */ jsxs("div", { className: "w-full max-w-md bg-ih-bg-card rounded-xl shadow-2xl border border-ih-border overflow-hidden", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-3 px-4 py-3 border-b border-ih-border", children: [
      /* @__PURE__ */ jsx(SearchIcon, {}),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: inputRef,
          value: query,
          onChange: (e) => {
            setQuery(e.target.value);
            setActiveIdx(0);
          },
          onKeyDown: handleKeyDown,
          placeholder: "Type a command or search...",
          className: "flex-1 bg-transparent text-[14px] text-ih-fg-1 outline-none placeholder:text-slate-400"
        }
      ),
      /* @__PURE__ */ jsx("kbd", { className: "hidden sm:inline px-1.5 py-0.5 rounded bg-ih-bg-muted text-[10px] font-bold text-slate-400", children: "ESC" })
    ] }),
    !query && /* @__PURE__ */ jsxs("div", { className: "flex gap-3 px-4 py-1.5 border-b border-slate-100 dark:border-slate-700 text-[10px] text-slate-400", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("kbd", { className: "font-bold", children: ">" }),
        " actions"
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("kbd", { className: "font-bold", children: "@" }),
        " people"
      ] })
    ] }),
    /* @__PURE__ */ jsx("div", { className: "max-h-[300px] overflow-y-auto py-2", children: flatFiltered.length === 0 ? /* @__PURE__ */ jsx("p", { className: "px-4 py-6 text-center text-[13px] text-slate-400", children: "No results found" }) : [...groups.entries()].map(([group, actions]) => /* @__PURE__ */ jsxs("div", { children: [
      /* @__PURE__ */ jsx("p", { className: "px-4 py-1 text-[10px] font-extrabold uppercase tracking-[0.15em] text-slate-400", children: group }),
      actions.map((action2) => {
        const idx = flatFiltered.indexOf(action2);
        return /* @__PURE__ */ jsxs(
          "button",
          {
            onClick: () => executeAction(action2),
            onMouseEnter: () => setActiveIdx(idx),
            className: `w-full flex items-center gap-3 px-4 py-2 text-[13px] transition-colors ${idx === safeIdx ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-900/20 dark:text-indigo-400" : "text-ih-fg-3"}`,
            children: [
              /* @__PURE__ */ jsx(PaletteIcon, { type: action2.icon }),
              /* @__PURE__ */ jsx("span", { className: "font-medium flex-1 text-left truncate", children: action2.label }),
              action2.hint && /* @__PURE__ */ jsx("span", { className: "text-[10px] text-slate-400 shrink-0", children: action2.hint })
            ]
          },
          action2.id
        );
      })
    ] }, group)) }),
    /* @__PURE__ */ jsxs("div", { className: "flex items-center gap-4 px-4 py-2 border-t border-ih-border text-[10px] text-slate-400", children: [
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("kbd", { className: "font-bold", children: "↑↓" }),
        " navigate"
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("kbd", { className: "font-bold", children: "Enter" }),
        " select"
      ] }),
      /* @__PURE__ */ jsxs("span", { children: [
        /* @__PURE__ */ jsx("kbd", { className: "font-bold", children: "Esc" }),
        " close"
      ] })
    ] })
  ] }) });
}
function SearchIcon() {
  return /* @__PURE__ */ jsx("svg", { className: "w-4 h-4 text-slate-400", fill: "none", stroke: "currentColor", viewBox: "0 0 24 24", children: /* @__PURE__ */ jsx("path", { strokeLinecap: "round", strokeLinejoin: "round", strokeWidth: 1.5, d: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" }) });
}
function SeatBanner({
  usage,
  billingUrl
}) {
  const atLimit = usage.used >= usage.limit;
  const nearLimit = usage.used >= usage.limit - 1;
  if (!nearLimit) return null;
  return /* @__PURE__ */ jsxs(
    "div",
    {
      className: `px-4 py-3 rounded-lg mb-4 flex items-center flex-wrap gap-2 ${atLimit ? "bg-ih-bad-bg border border-ih-bad" : "bg-ih-watch-bg border border-ih-watch"}`,
      children: [
        /* @__PURE__ */ jsx(
          "p",
          {
            className: `text-sm font-semibold ${atLimit ? "text-ih-bad-fg" : "text-ih-watch-fg"}`,
            children: atLimit ? `You've reached your seat limit (${usage.used}/${usage.limit}). Upgrade to add more team members.` : `${usage.used} of ${usage.limit} seats used. 1 seat remaining.`
          }
        ),
        billingUrl && /* @__PURE__ */ jsx(
          "a",
          {
            href: billingUrl,
            className: "text-sm font-bold text-ih-primary hover:underline ml-2",
            children: "Upgrade"
          }
        )
      ]
    }
  );
}
const variantClasses = {
  primary: "bg-ih-primary text-ih-fg-inverse hover:bg-ih-primary-600 shadow-[var(--shadow-ih-focus)] shadow-transparent hover:shadow-ih-card",
  secondary: "bg-ih-bg-card border border-ih-border text-ih-fg-2 hover:bg-ih-bg-muted",
  ghost: "text-ih-fg-2 hover:bg-ih-bg-muted",
  danger: "bg-ih-bad text-ih-fg-inverse hover:opacity-90"
};
const sizeClasses = {
  sm: "h-7 px-2.5 text-xs gap-1.5",
  md: "h-9 px-4 text-[13px] gap-2",
  lg: "h-11 px-5 text-sm gap-2"
};
function Button({ variant = "secondary", size = "md", icon, children, className = "", ...props }) {
  return /* @__PURE__ */ jsxs(
    "button",
    {
      className: `inline-flex items-center justify-center font-bold rounded-md transition-all focus:outline-none focus:shadow-ih-focus disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${sizeClasses[size]} ${className}`,
      ...props,
      children: [
        icon,
        children
      ]
    }
  );
}
const toneClasses = {
  sat: "bg-ih-ok-bg text-ih-ok-fg",
  monitor: "bg-ih-watch-bg text-ih-watch-fg",
  defect: "bg-ih-bad-bg text-ih-bad-fg",
  ni: "bg-ih-bg-muted text-ih-fg-3",
  np: "bg-ih-bg-muted text-ih-fg-4",
  info: "bg-sky-50 text-sky-700 dark:bg-sky-900/20 dark:text-sky-400",
  gen: "bg-ih-bg-muted text-ih-fg-3"
};
function Pill({ tone = "gen", dot = false, children, className = "" }) {
  return /* @__PURE__ */ jsxs("span", { className: `ih-pill ${toneClasses[tone]} ${className}`, children: [
    dot && /* @__PURE__ */ jsx("span", { className: "w-1.5 h-1.5 rounded-full bg-current opacity-60" }),
    children
  ] });
}
const ICON_PATHS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  contacts: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  check: '<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  store: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
  arrowR: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  chevR: '<path d="m9 18 6-6-6-6"/>',
  chevL: '<path d="m15 18-6-6 6-6"/>',
  chevD: '<path d="M19 9l-7 7-7-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="M6 18L18 6M6 6l12 12"/>',
  edit: '<path d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.59 13.51 6.83 3.98M15.41 6.51l-6.82 3.98"/>',
  mail: '<path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
  camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  mic: '<rect x="9" y="2" width="6" height="11" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v3M8 21h8"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/>',
  back: '<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  filter: '<path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  zap: '<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  panelRC: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="10 9 7 12 10 15"/>',
  panelRO: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="15" y1="3" x2="15" y2="21"/><polyline points="7 9 10 12 7 15"/>'
};
function Icon({ name, size = 16, strokeWidth = 2, className = "" }) {
  const path = ICON_PATHS[name];
  if (!path) return null;
  return /* @__PURE__ */ jsx(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      className,
      dangerouslySetInnerHTML: { __html: path }
    }
  );
}
const colorClasses = {
  slate: "bg-ih-bg-muted text-ih-fg-3",
  indigo: "bg-ih-primary-tint text-ih-primary",
  emerald: "bg-ih-ok-bg text-ih-ok-fg",
  amber: "bg-ih-watch-bg text-ih-watch-fg",
  rose: "bg-ih-bad-bg text-ih-bad-fg"
};
function Eyebrow({ color = "slate", children }) {
  return /* @__PURE__ */ jsxs("span", { className: `inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ih-eyebrow ${colorClasses[color]}`, children: [
    /* @__PURE__ */ jsx("span", { className: "w-1 h-1 rounded-full bg-current opacity-60" }),
    children
  ] });
}
function PageHeader({ eyebrow, eyebrowColor = "slate", title, meta: meta2, actions }) {
  return /* @__PURE__ */ jsxs("div", { className: "flex items-start justify-between gap-4", children: [
    /* @__PURE__ */ jsxs("div", { children: [
      eyebrow && /* @__PURE__ */ jsx(Eyebrow, { color: eyebrowColor, children: eyebrow }),
      /* @__PURE__ */ jsx("h1", { className: "text-[26px] font-bold tracking-tight text-ih-fg-1 mt-1", children: title }),
      meta2 && /* @__PURE__ */ jsx("p", { className: "text-[13px] text-ih-fg-3 mt-1", children: meta2 })
    ] }),
    actions && /* @__PURE__ */ jsx("div", { className: "flex items-center gap-2 flex-shrink-0", children: actions })
  ] });
}
function TabStrip({ tabs, activeId, onChange }) {
  return /* @__PURE__ */ jsx("div", { className: "flex flex-wrap items-center border-b border-ih-border", children: tabs.map((tab) => /* @__PURE__ */ jsxs(
    "button",
    {
      onClick: () => onChange(tab.id),
      className: `inline-flex items-center gap-1.5 px-3.5 py-2.5 border-b-2 text-[13px] font-bold transition-all ${activeId === tab.id ? "border-ih-primary text-ih-primary" : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"}`,
      children: [
        tab.label,
        tab.count !== void 0 && /* @__PURE__ */ jsx("span", { className: `inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold tabular-nums ${activeId === tab.id ? "bg-ih-primary-tint text-ih-primary" : "bg-ih-bg-muted text-ih-fg-4"}`, children: tab.count })
      ]
    },
    tab.id
  )) });
}
const Input = React.forwardRef(
  ({ label, error, hint, className = "", ...props }, ref) => /* @__PURE__ */ jsxs("div", { children: [
    label && /* @__PURE__ */ jsx("label", { className: "block text-xs font-bold text-ih-fg-2 mb-1", children: label }),
    /* @__PURE__ */ jsx(
      "input",
      {
        ref,
        className: `ih-input w-full text-ih-fg-1 placeholder:text-ih-fg-4 ${error ? "border-ih-bad" : ""} ${className}`,
        ...props
      }
    ),
    error && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-ih-bad-fg mt-1", children: error }),
    !error && hint && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-ih-fg-4 mt-1", children: hint })
  ] })
);
Input.displayName = "Input";
function EmptyState({ icon, title, description, action: action2 }) {
  return /* @__PURE__ */ jsxs("div", { className: "flex flex-col items-center gap-3 py-12 px-6 text-center", children: [
    icon && /* @__PURE__ */ jsx("div", { className: "w-12 h-12 text-ih-fg-5", children: icon }),
    /* @__PURE__ */ jsx("h3", { className: "text-[14px] font-bold text-ih-fg-2", children: title }),
    description && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-ih-fg-3 max-w-[32ch]", children: description }),
    action2
  ] });
}
function Card({ children, className = "" }) {
  return /* @__PURE__ */ jsx("div", { className: `bg-ih-bg-card border border-ih-border rounded-lg shadow-ih-card ${className}`, children });
}
function meta$u() {
  return [{
    title: "Dashboard - OpenInspection"
  }];
}
const COLUMN_REGISTRY = [{
  id: "propertyAddress",
  label: "Property Address",
  defaultOn: true,
  alwaysOn: true
}, {
  id: "clientName",
  label: "Client Name",
  defaultOn: true
}, {
  id: "date",
  label: "Inspection Date",
  defaultOn: true
}, {
  id: "inspector",
  label: "Inspector",
  defaultOn: false
}, {
  id: "statusIcons",
  label: "Status Icons",
  defaultOn: true
}, {
  id: "defectChips",
  label: "Defect Counts",
  defaultOn: true
}, {
  id: "agent",
  label: "Agent",
  defaultOn: true
}, {
  id: "price",
  label: "Price",
  defaultOn: true
}, {
  id: "closingDate",
  label: "Closing Date",
  defaultOn: true
}, {
  id: "orderId",
  label: "Order ID",
  defaultOn: false
}, {
  id: "referralSource",
  label: "Referral Source",
  defaultOn: false
}, {
  id: "propertyFacts",
  label: "Property Facts",
  defaultOn: false
}];
const DEFAULT_COLUMNS = COLUMN_REGISTRY.filter((c) => c.defaultOn).map((c) => c.id);
const ALWAYS_ON = new Set(COLUMN_REGISTRY.filter((c) => c.alwaysOn).map((c) => c.id));
const INSPECTION_FILTERS = [{
  id: "all",
  label: "All"
}, {
  id: "past",
  label: "Past"
}, {
  id: "yesterday",
  label: "Yesterday"
}, {
  id: "today",
  label: "Today"
}, {
  id: "tomorrow",
  label: "Tomorrow"
}, {
  id: "this_week",
  label: "This Week"
}, {
  id: "future",
  label: "Future"
}, {
  id: "unconfirmed",
  label: "Unconfirmed"
}, {
  id: "in_progress",
  label: "In Progress"
}];
function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays$1(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function startOfWeek$1(d) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function matchesFilter(insp, filter, now) {
  if (filter === "all") return true;
  const status = (insp.status || "").toLowerCase();
  if (filter === "unconfirmed") return status === "scheduled" || status === "draft";
  if (filter === "in_progress") return status === "in_progress";
  if (!insp.date) return false;
  const date = new Date(insp.date);
  if (isNaN(date.getTime())) return false;
  const today = startOfDay(now);
  const yesterday = addDays$1(today, -1);
  const tomorrow = addDays$1(today, 1);
  const wkStart = startOfWeek$1(today);
  const wkEnd = addDays$1(wkStart, 7);
  const dayStart = startOfDay(date);
  switch (filter) {
    case "past":
      return dayStart.getTime() < today.getTime();
    case "yesterday":
      return dayStart.getTime() === yesterday.getTime();
    case "today":
      return dayStart.getTime() === today.getTime();
    case "tomorrow":
      return dayStart.getTime() === tomorrow.getTime();
    case "this_week":
      return dayStart.getTime() >= wkStart.getTime() && dayStart.getTime() < wkEnd.getTime();
    case "future":
      return dayStart.getTime() >= wkEnd.getTime();
  }
  return false;
}
const TABS$7 = [{
  key: "all",
  label: "All"
}, {
  key: "active",
  label: "Active"
}, {
  key: "drafts",
  label: "Drafts"
}, {
  key: "awaiting_payment",
  label: "Awaiting payment"
}, {
  key: "published",
  label: "Published"
}, {
  key: "cancelled",
  label: "Cancelled"
}];
function matchesWorkflow(i, tab) {
  if (tab === "all") return true;
  switch (tab) {
    case "active":
      return i.status === "scheduled" || i.status === "in_progress" || i.status === "draft" || i.status === "confirmed";
    case "drafts":
      return i.status === "draft";
    case "awaiting_payment":
      return (i.status === "delivered" || i.status === "published") && i.paymentStatus !== "paid";
    case "published":
      return i.status === "delivered" || i.status === "published";
    case "cancelled":
      return i.status === "cancelled";
    default:
      return true;
  }
}
async function loader$z({
  request
}) {
  const token = await requireToken(request);
  try {
    const [dashRes, tagsRes] = await Promise.all([apiFetch("/api/inspections/dashboard", {
      token
    }), apiFetch("/api/tags", {
      token
    }).catch(() => null)]);
    const json = dashRes.ok ? await dashRes.json() : {};
    const d = json.data ?? {};
    let tags2 = [];
    if (tagsRes && tagsRes.ok) {
      const tj = await tagsRes.json();
      tags2 = tj.data ?? [];
    }
    return {
      buckets: {
        needsAttention: (d == null ? void 0 : d.needsAttention) ?? [],
        today: (d == null ? void 0 : d.today) ?? [],
        thisWeek: (d == null ? void 0 : d.thisWeek) ?? [],
        later: (d == null ? void 0 : d.later) ?? [],
        recentReports: (d == null ? void 0 : d.recentReports) ?? [],
        cancelled: (d == null ? void 0 : d.cancelled) ?? []
      },
      conciergePending: (d == null ? void 0 : d.conciergePending) ?? 0,
      greeting: "Good morning",
      tags: tags2
    };
  } catch {
    return {
      buckets: {
        needsAttention: [],
        today: [],
        thisWeek: [],
        later: [],
        recentReports: [],
        cancelled: []
      },
      conciergePending: 0,
      greeting: "Good morning",
      tags: []
    };
  }
}
function getGreeting() {
  if (typeof window === "undefined") return "Good morning";
  const h = (/* @__PURE__ */ new Date()).getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}
async function action$e({
  request
}) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "delete") {
    const id = formData.get("id");
    const res = await apiFetch(`/api/inspections/${id}`, {
      token,
      method: "DELETE"
    });
    return {
      ok: res.ok,
      intent: "delete"
    };
  }
  if (intent === "archive") {
    const ids = formData.get("ids").split(",");
    const results = await Promise.all(ids.map((id) => apiFetch(`/api/inspections/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({
        status: "cancelled"
      })
    })));
    return {
      ok: results.every((r) => r.ok),
      intent: "archive"
    };
  }
  if (intent === "status") {
    const id = formData.get("id");
    const status = formData.get("status");
    const res = await apiFetch(`/api/inspections/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({
        status
      })
    });
    return {
      ok: res.ok,
      intent: "status"
    };
  }
  return {
    ok: false
  };
}
const BUCKET_META = {
  needsAttention: {
    label: "Needs Attention",
    hint: "Inspections requiring action"
  },
  today: {
    label: "Today",
    hint: "Scheduled for today"
  },
  thisWeek: {
    label: "This Week",
    hint: "Upcoming this week"
  },
  later: {
    label: "Later",
    hint: "Future inspections"
  },
  recentReports: {
    label: "Recent Reports",
    hint: "Recently completed"
  },
  cancelled: {
    label: "Cancelled",
    hint: "Cancelled inspections"
  }
};
const PAGE_SIZE = 25;
const dashboard$1 = UNSAFE_withComponentProps(function DashboardPage() {
  var _a;
  const {
    buckets,
    conciergePending,
    greeting: _ssrGreeting,
    tags: tags2
  } = useLoaderData();
  const sessionCtx = useSessionContext();
  const [greeting, setGreeting] = useState(_ssrGreeting);
  useEffect(() => {
    setGreeting(getGreeting());
  }, []);
  const [searchParams] = useSearchParams();
  useNavigate();
  const fetcher = useFetcher();
  const [activeTab, setActiveTab] = useState(searchParams.get("workflow") || "all");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeTagFilter, setActiveTagFilter] = useState("");
  const [collapsedBuckets, setCollapsedBuckets] = useState(/* @__PURE__ */ new Set());
  const [wizardOpen, setWizardOpen] = useState(searchParams.get("newInspection") === "1" || searchParams.get("new") === "1");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState(/* @__PURE__ */ new Set());
  const [visiblePage, setVisiblePage] = useState(1);
  const sentinelRef = useRef(null);
  const [visibleColumns, setVisibleColumns] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_COLUMNS;
    try {
      const raw = localStorage.getItem("oi.dashboard.columns");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {
    }
    return DEFAULT_COLUMNS;
  });
  const isColumnVisible = useCallback((id) => visibleColumns.includes(id), [visibleColumns]);
  const toggleColumn = useCallback((id) => {
    if (ALWAYS_ON.has(id)) return;
    setVisibleColumns((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      try {
        localStorage.setItem("oi.dashboard.columns", JSON.stringify(next));
      } catch {
      }
      return next;
    });
  }, []);
  const resetColumns = useCallback(() => {
    const def = DEFAULT_COLUMNS;
    setVisibleColumns(def);
    try {
      localStorage.setItem("oi.dashboard.columns", JSON.stringify(def));
    } catch {
    }
  }, []);
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [filterAgentId, setFilterAgentId] = useState("");
  const allInspections = useMemo(() => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const items of Object.values(buckets)) {
      for (const i of items) {
        if (!seen.has(i.id)) {
          seen.add(i.id);
          out.push(i);
        }
      }
    }
    return out;
  }, [buckets]);
  const filteredInspections = useMemo(() => {
    const now = /* @__PURE__ */ new Date();
    return allInspections.filter((insp) => {
      if (!matchesWorkflow(insp, activeTab)) return false;
      if (activeFilter !== "all" && !matchesFilter(insp, activeFilter, now)) return false;
      if (filterDateFrom && (!insp.date || insp.date < filterDateFrom)) return false;
      if (filterDateTo && (!insp.date || insp.date > filterDateTo)) return false;
      if (filterAgentId && insp.agentId !== filterAgentId) return false;
      if (activeTagFilter) {
        const ids = Array.isArray(insp.tagIds) ? insp.tagIds : [];
        if (!ids.includes(activeTagFilter)) return false;
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const haystack = [insp.address, insp.propertyAddress, insp.clientName, insp.clientEmail, insp.id].filter(Boolean).join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return da - db;
    });
  }, [allInspections, activeTab, activeFilter, activeTagFilter, filterDateFrom, filterDateTo, filterAgentId, searchQuery]);
  const filteredBuckets = useMemo(() => {
    const useFlat = activeFilter !== "all" || searchQuery || activeTagFilter || filterDateFrom || filterDateTo || filterAgentId;
    if (useFlat) return null;
    const result = {};
    for (const [key, items] of Object.entries(buckets)) {
      const f = items.filter((i) => matchesWorkflow(i, activeTab));
      if (f.length > 0) result[key] = f;
    }
    return result;
  }, [buckets, activeTab, activeFilter, searchQuery, activeTagFilter, filterDateFrom, filterDateTo, filterAgentId]);
  const paginatedList = useMemo(() => {
    return filteredInspections.slice(0, visiblePage * PAGE_SIZE);
  }, [filteredInspections, visiblePage]);
  const hasMore = paginatedList.length < filteredInspections.length;
  useEffect(() => {
    if (!sentinelRef.current || !hasMore) return;
    const obs = new IntersectionObserver((entries) => {
      var _a2;
      if ((_a2 = entries[0]) == null ? void 0 : _a2.isIntersecting) setVisiblePage((p) => p + 1);
    }, {
      rootMargin: "200px"
    });
    obs.observe(sentinelRef.current);
    return () => obs.disconnect();
  }, [hasMore]);
  useEffect(() => {
    setVisiblePage(1);
  }, [activeTab, activeFilter, activeTagFilter, searchQuery, filterDateFrom, filterDateTo, filterAgentId]);
  const counts = useMemo(() => ({
    upcoming: new Set([...buckets.today, ...buckets.thisWeek, ...buckets.later].map((i) => i.id)).size,
    inProgress: allInspections.filter((i) => i.status === "in_progress").length,
    needsAttention: buckets.needsAttention.length,
    recent: buckets.recentReports.length
  }), [buckets, allInspections]);
  const filterCounts = useMemo(() => {
    const now = /* @__PURE__ */ new Date();
    const out = {
      all: allInspections.length
    };
    for (const f of INSPECTION_FILTERS) {
      if (f.id === "all") continue;
      out[f.id] = allInspections.filter((i) => matchesFilter(i, f.id, now)).length;
    }
    return out;
  }, [allInspections]);
  const tabCounts = useMemo(() => {
    const out = {};
    for (const t of TABS$7) {
      out[t.key] = allInspections.filter((i) => matchesWorkflow(i, t.key)).length;
    }
    return out;
  }, [allInspections]);
  const toggleBucket = (key) => setCollapsedBuckets((prev) => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });
  const toggleSelect = (id) => setSelectedIds((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });
  const selectAll = () => {
    const ids = filteredInspections.map((i) => i.id);
    setSelectedIds(new Set(ids));
  };
  const clearSelection = () => setSelectedIds(/* @__PURE__ */ new Set());
  const batchArchive = () => {
    if (selectedIds.size === 0) return;
    fetcher.submit({
      intent: "archive",
      ids: [...selectedIds].join(",")
    }, {
      method: "post"
    });
    clearSelection();
  };
  const batchDelete = () => {
    if (selectedIds.size === 0) return;
    for (const id of selectedIds) {
      fetcher.submit({
        intent: "delete",
        id
      }, {
        method: "post"
      });
    }
    clearSelection();
  };
  const exportCsv = useCallback(() => {
    const rows = filteredInspections;
    if (rows.length === 0) return;
    const header = ["ID", "Address", "Client", "Date", "Status", "Payment", "Agent", "Price"];
    const csvRows = [header.join(","), ...rows.map((i) => [i.id, `"${(i.address || i.propertyAddress || "").replace(/"/g, '""')}"`, `"${(i.clientName || "").replace(/"/g, '""')}"`, i.date || "", i.status, i.paymentStatus || "", `"${(i.agentName || "").replace(/"/g, '""')}"`, i.price != null ? String(i.price) : ""].join(","))];
    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv"
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inspections-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredInspections]);
  const transitionStatus = (id, status) => {
    fetcher.submit({
      intent: "status",
      id,
      status
    }, {
      method: "post"
    });
  };
  const totalFiltered = filteredBuckets ? Object.values(filteredBuckets).flat().length : filteredInspections.length;
  const statusTone = {
    draft: "ni",
    scheduled: "info",
    confirmed: "info",
    in_progress: "monitor",
    delivered: "sat",
    published: "sat",
    cancelled: "gen"
  };
  function InspectionRow({
    insp
  }) {
    const isSelected = selectedIds.has(insp.id);
    return /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 px-4 py-3 hover:bg-ih-bg-muted transition-colors group",
      children: [/* @__PURE__ */ jsx("input", {
        type: "checkbox",
        checked: isSelected,
        onChange: () => toggleSelect(insp.id),
        className: "accent-ih-primary shrink-0"
      }), /* @__PURE__ */ jsxs(Link, {
        to: `/inspections/${insp.id}/edit`,
        className: "flex items-center justify-between flex-1 min-w-0",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "min-w-0",
          children: [isColumnVisible("propertyAddress") && /* @__PURE__ */ jsx("p", {
            className: "text-[13px] font-medium text-ih-fg-1 truncate",
            children: insp.address || insp.propertyAddress || "No address"
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 mt-0.5 flex-wrap",
            children: [isColumnVisible("clientName") && /* @__PURE__ */ jsx("span", {
              className: "text-[11px] text-ih-fg-3",
              children: insp.clientName || "No client"
            }), isColumnVisible("date") && insp.date && /* @__PURE__ */ jsxs("span", {
              className: "text-[11px] text-ih-fg-3",
              children: ["· ", insp.date]
            }), isColumnVisible("agent") && insp.agentName && /* @__PURE__ */ jsxs("span", {
              className: "text-[11px] text-ih-fg-3",
              children: ["· ", insp.agentName]
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-2 shrink-0 ml-4",
          children: [isColumnVisible("statusIcons") && /* @__PURE__ */ jsx(Pill, {
            tone: statusTone[insp.status] ?? "gen",
            children: insp.status.replace(/_/g, " ")
          }), isColumnVisible("defectChips") && insp.defectStats && /* @__PURE__ */ jsxs("div", {
            className: "flex gap-1",
            children: [insp.defectStats.safety > 0 && /* @__PURE__ */ jsxs(Pill, {
              tone: "defect",
              children: [insp.defectStats.safety, "S"]
            }), insp.defectStats.recommendation > 0 && /* @__PURE__ */ jsxs(Pill, {
              tone: "monitor",
              children: [insp.defectStats.recommendation, "R"]
            }), insp.defectStats.maintenance > 0 && /* @__PURE__ */ jsxs(Pill, {
              tone: "info",
              children: [insp.defectStats.maintenance, "M"]
            })]
          }), isColumnVisible("price") && insp.price != null && /* @__PURE__ */ jsxs("span", {
            className: "text-[11px] font-medium text-ih-fg-3",
            children: ["$", insp.price]
          })]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
        children: /* @__PURE__ */ jsxs("select", {
          value: insp.status,
          onChange: (e) => transitionStatus(insp.id, e.target.value),
          onClick: (e) => e.stopPropagation(),
          className: "h-6 px-1 rounded text-[10px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none cursor-pointer",
          children: [/* @__PURE__ */ jsx("option", {
            value: "draft",
            children: "Draft"
          }), /* @__PURE__ */ jsx("option", {
            value: "scheduled",
            children: "Scheduled"
          }), /* @__PURE__ */ jsx("option", {
            value: "confirmed",
            children: "Confirmed"
          }), /* @__PURE__ */ jsx("option", {
            value: "in_progress",
            children: "In Progress"
          }), /* @__PURE__ */ jsx("option", {
            value: "delivered",
            children: "Delivered"
          }), /* @__PURE__ */ jsx("option", {
            value: "published",
            children: "Published"
          }), /* @__PURE__ */ jsx("option", {
            value: "cancelled",
            children: "Cancelled"
          })]
        })
      })]
    });
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-[1080px] mx-auto pt-5 pb-[60px] px-9 space-y-[18px]",
    children: [(sessionCtx == null ? void 0 : sessionCtx.seatUsage) && /* @__PURE__ */ jsx(SeatBanner, {
      usage: sessionCtx.seatUsage,
      billingUrl: ((_a = sessionCtx.branding) == null ? void 0 : _a.portalBaseUrl) ? `${sessionCtx.branding.portalBaseUrl}/billing` : void 0
    }), /* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "DASHBOARD",
      eyebrowColor: "indigo",
      title: greeting,
      meta: /* @__PURE__ */ jsxs(Fragment, {
        children: [counts.upcoming, " upcoming", " ", counts.upcoming === 1 ? "inspection" : "inspections", counts.needsAttention > 0 && /* @__PURE__ */ jsxs("span", {
          children: [" ", "· ", counts.needsAttention, " ", counts.needsAttention === 1 ? "report needs" : "reports need", " attention"]
        }), conciergePending > 0 && /* @__PURE__ */ jsxs("span", {
          children: [" ", "· ", conciergePending, " pending", " ", conciergePending === 1 ? "booking" : "bookings"]
        })]
      }),
      actions: /* @__PURE__ */ jsxs(Fragment, {
        children: [/* @__PURE__ */ jsxs("div", {
          className: "relative",
          children: [/* @__PURE__ */ jsx("input", {
            type: "text",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            placeholder: "Search...",
            className: "h-8 w-40 pl-8 pr-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-2 focus:ring-2 focus:ring-ih-primary/30 focus:border-ih-primary outline-none placeholder:text-ih-fg-4"
          }), /* @__PURE__ */ jsx(Icon, {
            name: "search",
            size: 14,
            className: "absolute left-2.5 top-1/2 -translate-y-1/2 text-ih-fg-4"
          })]
        }), /* @__PURE__ */ jsx(Button, {
          variant: "secondary",
          size: "sm",
          icon: /* @__PURE__ */ jsx(Icon, {
            name: "filter",
            size: 14
          }),
          onClick: () => setFiltersOpen(true),
          children: "Filters"
        }), /* @__PURE__ */ jsx(Button, {
          variant: "secondary",
          size: "sm",
          icon: /* @__PURE__ */ jsx(Icon, {
            name: "panel",
            size: 14
          }),
          onClick: () => setColumnsOpen(true),
          children: "Columns"
        }), /* @__PURE__ */ jsx(Button, {
          variant: "secondary",
          size: "sm",
          onClick: exportCsv,
          children: "Export"
        }), /* @__PURE__ */ jsx(Button, {
          variant: "primary",
          size: "sm",
          icon: /* @__PURE__ */ jsx(Icon, {
            name: "plus",
            size: 14
          }),
          onClick: () => setWizardOpen(true),
          children: "New Inspection"
        })]
      })
    }), /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-2 lg:grid-cols-4 gap-3",
      children: [{
        label: "Upcoming",
        value: counts.upcoming,
        icon: "calendar",
        color: "text-ih-primary bg-ih-primary-tint"
      }, {
        label: "In Progress",
        value: counts.inProgress,
        icon: "edit",
        color: "text-sky-600 bg-sky-50 dark:text-sky-400 dark:bg-sky-900/20"
      }, {
        label: "Needs Attention",
        value: counts.needsAttention,
        icon: "zap",
        color: "text-ih-watch-fg bg-ih-watch-bg"
      }, {
        label: "Recent Reports",
        value: counts.recent,
        icon: "check",
        color: "text-ih-ok-fg bg-ih-ok-bg"
      }].map((stat) => /* @__PURE__ */ jsxs(Card, {
        className: "p-[14px] cursor-pointer hover:shadow-md transition-all",
        children: [/* @__PURE__ */ jsx("div", {
          className: `w-10 h-10 rounded-md flex items-center justify-center mb-3 ${stat.color}`,
          children: /* @__PURE__ */ jsx(Icon, {
            name: stat.icon,
            size: 20
          })
        }), /* @__PURE__ */ jsx("div", {
          className: "text-xl font-bold text-ih-fg-1 tabular-nums",
          children: stat.value
        }), /* @__PURE__ */ jsx("div", {
          className: "text-[12px] font-bold text-ih-fg-3 uppercase tracking-[0.15em]",
          children: stat.label
        })]
      }, stat.label))
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$7.map((t) => ({
        id: t.key,
        label: t.label,
        count: tabCounts[t.key] ?? 0
      })),
      activeId: activeTab,
      onChange: (id) => setActiveTab(id)
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-0 flex-wrap border-b border-ih-border",
      children: [INSPECTION_FILTERS.map((f) => /* @__PURE__ */ jsxs("button", {
        onClick: () => setActiveFilter(f.id),
        className: `px-3 py-2 border-b-2 text-[11px] font-bold transition-colors ${activeFilter === f.id ? "border-ih-primary text-ih-primary" : "border-transparent text-ih-fg-3 hover:text-ih-fg-1"}`,
        children: [f.label, /* @__PURE__ */ jsx("span", {
          className: "ml-1 opacity-70",
          children: filterCounts[f.id] ?? 0
        })]
      }, f.id)), tags2.length > 0 && /* @__PURE__ */ jsxs("select", {
        value: activeTagFilter,
        onChange: (e) => setActiveTagFilter(e.target.value),
        className: "h-7 px-2 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-3 border-0 outline-none ml-2",
        children: [/* @__PURE__ */ jsx("option", {
          value: "",
          children: "All tags"
        }), tags2.map((t) => /* @__PURE__ */ jsx("option", {
          value: t.id,
          children: t.name
        }, t.id))]
      })]
    }), selectedIds.size > 0 && /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-3 px-4 py-2.5 bg-ih-primary-tint rounded-lg border border-ih-border",
      children: [/* @__PURE__ */ jsxs("span", {
        className: "text-[13px] font-bold text-ih-primary",
        children: [selectedIds.size, " selected"]
      }), /* @__PURE__ */ jsx(Button, {
        variant: "ghost",
        size: "sm",
        onClick: batchArchive,
        children: "Archive"
      }), /* @__PURE__ */ jsx(Button, {
        variant: "danger",
        size: "sm",
        onClick: batchDelete,
        children: "Delete"
      }), /* @__PURE__ */ jsx(Button, {
        variant: "ghost",
        size: "sm",
        className: "ml-auto",
        onClick: selectAll,
        children: "Select all"
      }), /* @__PURE__ */ jsx(Button, {
        variant: "ghost",
        size: "sm",
        onClick: clearSelection,
        children: "Clear"
      })]
    }), totalFiltered === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        icon: /* @__PURE__ */ jsx(Icon, {
          name: "check",
          size: 32
        }),
        title: "No inspections yet",
        description: "Create one above to get started."
      })
    }) : filteredBuckets ? (
      /* Grouped bucket view */
      /* @__PURE__ */ jsx("div", {
        className: "space-y-3",
        children: Object.entries(filteredBuckets).map(([key, items]) => {
          if (items.length === 0) return null;
          const meta2 = BUCKET_META[key] ?? {
            label: key,
            hint: ""
          };
          const collapsed = collapsedBuckets.has(key);
          return /* @__PURE__ */ jsxs(Card, {
            className: "overflow-hidden",
            children: [/* @__PURE__ */ jsxs("button", {
              onClick: () => toggleBucket(key),
              className: "w-full flex items-center justify-between px-4 py-3 hover:bg-ih-bg-muted transition-colors",
              children: [/* @__PURE__ */ jsxs("div", {
                className: "flex items-center gap-3",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "text-[10px] font-extrabold uppercase tracking-[0.15em] text-ih-fg-4",
                  children: meta2.label
                }), /* @__PURE__ */ jsx("span", {
                  className: "text-[11px] text-ih-fg-4",
                  children: meta2.hint
                }), /* @__PURE__ */ jsx(Pill, {
                  tone: "gen",
                  children: items.length
                })]
              }), /* @__PURE__ */ jsx(Icon, {
                name: "chevD",
                size: 16,
                className: `text-ih-fg-4 transition-transform ${collapsed ? "" : "rotate-180"}`
              })]
            }), !collapsed && /* @__PURE__ */ jsx("div", {
              className: "divide-y divide-ih-border",
              children: items.map((insp) => /* @__PURE__ */ jsx(InspectionRow, {
                insp
              }, insp.id))
            })]
          }, key);
        })
      })
    ) : (
      /* Flat filtered view */
      /* @__PURE__ */ jsxs(Card, {
        className: "overflow-hidden",
        children: [/* @__PURE__ */ jsx("div", {
          className: "px-4 py-2 border-b border-ih-border",
          children: /* @__PURE__ */ jsxs("span", {
            className: "text-[11px] font-bold text-ih-fg-4",
            children: [filteredInspections.length, " result", filteredInspections.length !== 1 ? "s" : ""]
          })
        }), /* @__PURE__ */ jsx("div", {
          className: "divide-y divide-ih-border",
          children: paginatedList.map((insp) => /* @__PURE__ */ jsx(InspectionRow, {
            insp
          }, insp.id))
        }), hasMore && /* @__PURE__ */ jsx("div", {
          ref: sentinelRef,
          className: "h-8"
        })]
      })
    ), /* @__PURE__ */ jsx(NewInspectionWizard, {
      open: wizardOpen,
      onClose: () => setWizardOpen(false)
    }), /* @__PURE__ */ jsx(CommandPalette, {
      onNewInspection: () => setWizardOpen(true)
    }), filtersOpen && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setFiltersOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: "Filters"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setFiltersOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-4",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
              children: "Date from"
            }), /* @__PURE__ */ jsx("input", {
              type: "date",
              value: filterDateFrom,
              onChange: (e) => setFilterDateFrom(e.target.value),
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
              children: "Date to"
            }), /* @__PURE__ */ jsx("input", {
              type: "date",
              value: filterDateTo,
              onChange: (e) => setFilterDateTo(e.target.value),
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
              children: "Agent ID"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              value: filterAgentId,
              onChange: (e) => setFilterAgentId(e.target.value),
              placeholder: "Agent ID",
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mt-6",
          children: [/* @__PURE__ */ jsx(Button, {
            variant: "ghost",
            size: "sm",
            onClick: () => {
              setFilterDateFrom("");
              setFilterDateTo("");
              setFilterAgentId("");
            },
            children: "Reset"
          }), /* @__PURE__ */ jsx(Button, {
            variant: "primary",
            size: "sm",
            onClick: () => setFiltersOpen(false),
            children: "Apply"
          })]
        })]
      })
    }), columnsOpen && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setColumnsOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: "Customize Columns"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setColumnsOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "space-y-2",
          children: COLUMN_REGISTRY.map((col) => /* @__PURE__ */ jsxs("label", {
            className: "flex items-center gap-3 py-1.5 cursor-pointer",
            children: [/* @__PURE__ */ jsx("input", {
              type: "checkbox",
              checked: isColumnVisible(col.id),
              disabled: ALWAYS_ON.has(col.id),
              onChange: () => toggleColumn(col.id),
              className: "accent-ih-primary"
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[13px] text-ih-fg-2",
              children: [col.label, ALWAYS_ON.has(col.id) && /* @__PURE__ */ jsx("span", {
                className: "ml-1 text-[10px] text-ih-fg-4",
                children: "(required)"
              })]
            })]
          }, col.id))
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mt-6",
          children: [/* @__PURE__ */ jsx(Button, {
            variant: "ghost",
            size: "sm",
            onClick: resetColumns,
            children: "Reset to defaults"
          }), /* @__PURE__ */ jsx(Button, {
            variant: "primary",
            size: "sm",
            onClick: () => setColumnsOpen(false),
            children: "Done"
          })]
        })]
      })
    })]
  });
});
const route35 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$e,
  default: dashboard$1,
  loader: loader$z,
  meta: meta$u
}, Symbol.toStringTag, { value: "Module" }));
function meta$t() {
  return [{
    title: "Calendar - OpenInspection"
  }];
}
function startOfWeek(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - x.getDay());
  x.setHours(0, 0, 0, 0);
  return x;
}
function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function formatTime(d) {
  return d.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}
const STATUS_COLORS = {
  draft: "bg-ih-bg-muted",
  scheduled: "bg-blue-500",
  confirmed: "bg-ih-primary",
  in_progress: "bg-amber-500",
  delivered: "bg-emerald-500",
  published: "bg-emerald-600",
  cancelled: "bg-red-400",
  google: "bg-violet-400"
};
function eventColor(ev) {
  var _a;
  if (ev.source === "google" || ((_a = ev.extendedProps) == null ? void 0 : _a.source) === "google") return STATUS_COLORS.google;
  return STATUS_COLORS[ev.status || ""] || ev.backgroundColor || "bg-ih-primary";
}
async function loader$y({
  request
}) {
  const token = await requireToken(request);
  const now = /* @__PURE__ */ new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();
  try {
    const res = await apiFetch(`/api/calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`, {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    const events = body.data ?? [];
    return {
      events
    };
  } catch {
    return {
      events: []
    };
  }
}
async function action$d({
  request
}) {
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "reschedule") {
    const id = formData.get("id");
    const date = formData.get("date");
    const res = await apiFetch(`/api/inspections/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({
        date
      })
    });
    return {
      ok: res.ok
    };
  }
  return {
    ok: false
  };
}
const calendar = UNSAFE_withComponentProps(function CalendarPage() {
  const {
    events
  } = useLoaderData();
  const navigate = useNavigate();
  const fetcher = useFetcher();
  const [currentDate, setCurrentDate] = useState(/* @__PURE__ */ new Date());
  const [viewMode, setViewMode] = useState("month");
  const [eventModalOpen, setEventModalOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [createDate, setCreateDate] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const prev = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month - 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, -7));
    else setCurrentDate(addDays(currentDate, -1));
  };
  const next = () => {
    if (viewMode === "month") setCurrentDate(new Date(year, month + 1, 1));
    else if (viewMode === "week") setCurrentDate(addDays(currentDate, 7));
    else setCurrentDate(addDays(currentDate, 1));
  };
  const goToday = () => setCurrentDate(/* @__PURE__ */ new Date());
  const headerTitle = useMemo(() => {
    if (viewMode === "month") return currentDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric"
    });
    if (viewMode === "week") {
      const ws = startOfWeek(currentDate);
      const we = addDays(ws, 6);
      return `${ws.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric"
      })} - ${we.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric"
      })}`;
    }
    return currentDate.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  }, [currentDate, viewMode]);
  const eventsByDate = useMemo(() => {
    const map = /* @__PURE__ */ new Map();
    for (const ev of events) {
      const d = ev.start ? new Date(ev.start) : null;
      if (!d || isNaN(d.getTime())) continue;
      const key = d.toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return map;
  }, [events]);
  function getEventsForDate(d) {
    return eventsByDate.get(d.toISOString().slice(0, 10)) || [];
  }
  const now = /* @__PURE__ */ new Date();
  const weekEnd = addDays(now, 7);
  const thisWeekEvents = events.filter((e) => {
    const d = new Date(e.start);
    return d >= now && d < weekEnd;
  });
  const drafts = thisWeekEvents.filter((e) => e.status === "draft" || e.isDraft);
  const confirmed = thisWeekEvents.length - drafts.length;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();
  const today = /* @__PURE__ */ new Date();
  const isToday = (day) => today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
  const weekStart = startOfWeek(viewMode === "week" ? currentDate : today);
  const weekDays = Array.from({
    length: 7
  }, (_, i) => addDays(weekStart, i));
  const hours = Array.from({
    length: 14
  }, (_, i) => i + 7);
  const handleEventClick = (ev) => {
    var _a;
    if (ev.source === "google" || ((_a = ev.extendedProps) == null ? void 0 : _a.source) === "google") return;
    setSelectedEvent(ev);
    setEventModalOpen(true);
  };
  const handleDayClick = (dateStr) => {
    navigate(`/dashboard?newInspection=1&date=${encodeURIComponent(dateStr)}`);
  };
  const handleDrop = (eventId, newDate) => {
    fetcher.submit({
      intent: "reschedule",
      id: eventId,
      date: newDate
    }, {
      method: "post"
    });
  };
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx("div", {
      className: "flex items-start justify-between gap-4",
      children: /* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsxs("span", {
          className: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-ih-primary-tint text-ih-primary",
          children: [/* @__PURE__ */ jsx("span", {
            className: "w-1 h-1 rounded-full bg-current opacity-60"
          }), "Calendar"]
        }), /* @__PURE__ */ jsx("h1", {
          className: "text-[26px] font-bold tracking-tight mt-1",
          children: "Calendar"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: thisWeekEvents.length === 0 ? "No inspections scheduled this week" : drafts.length > 0 ? `${confirmed} confirmed · ${drafts.length} draft${drafts.length === 1 ? "" : "s"}` : `${thisWeekEvents.length} this week`
        })]
      })
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2",
        children: [/* @__PURE__ */ jsx("button", {
          onClick: prev,
          className: "h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted text-lg",
          children: "‹"
        }), /* @__PURE__ */ jsx("button", {
          onClick: next,
          className: "h-9 w-9 rounded-md border border-ih-border flex items-center justify-center text-ih-fg-3 hover:bg-ih-bg-muted text-lg",
          children: "›"
        }), /* @__PURE__ */ jsx("button", {
          onClick: goToday,
          className: "h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3 hover:bg-ih-bg-muted",
          children: "Today"
        })]
      }), /* @__PURE__ */ jsx("h2", {
        className: "text-xl font-bold text-ih-fg-1",
        children: headerTitle
      }), /* @__PURE__ */ jsx("div", {
        className: "flex items-center gap-1",
        children: ["month", "week", "day"].map((v) => /* @__PURE__ */ jsx("button", {
          onClick: () => setViewMode(v),
          className: `h-9 px-3 rounded-md text-[13px] font-bold capitalize border transition-colors ${viewMode === v ? "border-ih-primary text-ih-primary bg-ih-primary-tint" : "border-ih-border text-ih-fg-3 hover:bg-ih-bg-muted"}`,
          children: v
        }, v))
      })]
    }), viewMode === "month" && /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-7",
        children: [["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => /* @__PURE__ */ jsx("div", {
          className: "py-2 px-3 text-center text-[11px] font-bold uppercase tracking-wide text-ih-fg-4 border-b border-ih-border",
          children: d
        }, d)), Array.from({
          length: firstDay
        }).map((_, i) => /* @__PURE__ */ jsx("div", {
          className: "min-h-[90px] border-b border-r border-ih-border bg-ih-bg-muted"
        }, `empty-${i}`)), Array.from({
          length: daysInMonth
        }).map((_, i) => {
          const day = i + 1;
          const dateObj = new Date(year, month, day);
          const dateStr = dateObj.toISOString().slice(0, 10);
          const dayEvents = getEventsForDate(dateObj);
          return /* @__PURE__ */ jsxs("div", {
            className: `min-h-[90px] p-1.5 border-b border-r border-ih-border cursor-pointer hover:bg-ih-primary-tint transition-colors ${isToday(day) ? "bg-ih-primary-tint" : ""}`,
            onClick: () => handleDayClick(`${dateStr}T09:00`),
            onDragOver: (e) => {
              e.preventDefault();
              setDragTarget(dateStr);
            },
            onDragLeave: () => setDragTarget(null),
            onDrop: (e) => {
              e.preventDefault();
              const evId = e.dataTransfer.getData("text/plain");
              if (evId) handleDrop(evId, `${dateStr}T09:00:00.000Z`);
              setDragTarget(null);
            },
            children: [/* @__PURE__ */ jsx("span", {
              className: `inline-flex items-center justify-center w-6 h-6 rounded-full text-[12px] font-medium ${isToday(day) ? "bg-ih-primary text-white" : "text-ih-fg-2"}`,
              children: day
            }), /* @__PURE__ */ jsxs("div", {
              className: "mt-0.5 space-y-0.5",
              children: [dayEvents.slice(0, 3).map((ev) => {
                var _a;
                return /* @__PURE__ */ jsx("button", {
                  onClick: (e) => {
                    e.stopPropagation();
                    handleEventClick(ev);
                  },
                  draggable: ev.source !== "google" && ((_a = ev.extendedProps) == null ? void 0 : _a.source) !== "google",
                  onDragStart: (e) => e.dataTransfer.setData("text/plain", ev.id),
                  className: `w-full text-left px-1 py-0.5 rounded text-[10px] font-medium text-white truncate ${eventColor(ev)} ${ev.isDraft ? "border border-dashed border-white/40 opacity-80" : ""}`,
                  children: ev.title
                }, ev.id);
              }), dayEvents.length > 3 && /* @__PURE__ */ jsxs("span", {
                className: "text-[10px] text-ih-fg-4 font-bold",
                children: ["+", dayEvents.length - 3, " more"]
              })]
            })]
          }, day);
        })]
      })
    }), viewMode === "week" && /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border",
        children: [/* @__PURE__ */ jsx("div", {
          className: "py-2 px-1"
        }), weekDays.map((d) => /* @__PURE__ */ jsxs("div", {
          className: `py-2 px-2 text-center border-l border-ih-border ${isSameDay(d, today) ? "bg-ih-primary-tint" : ""}`,
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-[10px] font-bold uppercase text-ih-fg-4 block",
            children: d.toLocaleDateString("en-US", {
              weekday: "short"
            })
          }), /* @__PURE__ */ jsx("span", {
            className: `text-[14px] font-bold ${isSameDay(d, today) ? "text-ih-primary" : "text-ih-fg-2"}`,
            children: d.getDate()
          })]
        }, d.toISOString()))]
      }), /* @__PURE__ */ jsx("div", {
        className: "max-h-[500px] overflow-y-auto",
        children: hours.map((h) => /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-[60px_repeat(7,1fr)] border-b border-ih-border min-h-[48px]",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "text-[10px] font-bold text-ih-fg-4 text-right pr-2 pt-1",
            children: [h > 12 ? h - 12 : h, h >= 12 ? "pm" : "am"]
          }), weekDays.map((d) => {
            const dayEvents = getEventsForDate(d).filter((ev) => {
              const evDate = new Date(ev.start);
              return evDate.getHours() === h;
            });
            const dateStr = d.toISOString().slice(0, 10);
            return /* @__PURE__ */ jsx("div", {
              className: "border-l border-ih-border p-0.5 cursor-pointer hover:bg-ih-primary-tint",
              onClick: () => handleDayClick(`${dateStr}T${String(h).padStart(2, "0")}:00`),
              onDragOver: (e) => e.preventDefault(),
              onDrop: (e) => {
                e.preventDefault();
                const evId = e.dataTransfer.getData("text/plain");
                if (evId) handleDrop(evId, `${dateStr}T${String(h).padStart(2, "0")}:00:00.000Z`);
              },
              children: dayEvents.map((ev) => /* @__PURE__ */ jsx("button", {
                onClick: (e) => {
                  e.stopPropagation();
                  handleEventClick(ev);
                },
                draggable: true,
                onDragStart: (e) => e.dataTransfer.setData("text/plain", ev.id),
                className: `w-full text-left px-1 py-0.5 rounded text-[10px] font-medium text-white truncate mb-0.5 ${eventColor(ev)}`,
                children: ev.title
              }, ev.id))
            }, d.toISOString() + h);
          })]
        }, h))
      })]
    }), viewMode === "day" && /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: /* @__PURE__ */ jsx("div", {
        className: "max-h-[600px] overflow-y-auto",
        children: hours.map((h) => {
          const dayEvents = getEventsForDate(currentDate).filter((ev) => {
            const evDate = new Date(ev.start);
            return evDate.getHours() === h;
          });
          const dateStr = currentDate.toISOString().slice(0, 10);
          return /* @__PURE__ */ jsxs("div", {
            className: "flex border-b border-ih-border min-h-[56px]",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "w-16 text-[11px] font-bold text-ih-fg-4 text-right pr-3 pt-2 shrink-0",
              children: [h > 12 ? h - 12 : h, ":00 ", h >= 12 ? "PM" : "AM"]
            }), /* @__PURE__ */ jsx("div", {
              className: "flex-1 p-1 cursor-pointer hover:bg-ih-primary-tint border-l border-ih-border",
              onClick: () => handleDayClick(`${dateStr}T${String(h).padStart(2, "0")}:00`),
              onDragOver: (e) => e.preventDefault(),
              onDrop: (e) => {
                e.preventDefault();
                const evId = e.dataTransfer.getData("text/plain");
                if (evId) handleDrop(evId, `${dateStr}T${String(h).padStart(2, "0")}:00:00.000Z`);
              },
              children: dayEvents.map((ev) => /* @__PURE__ */ jsxs("button", {
                onClick: (e) => {
                  e.stopPropagation();
                  handleEventClick(ev);
                },
                draggable: true,
                onDragStart: (e) => e.dataTransfer.setData("text/plain", ev.id),
                className: `w-full text-left px-3 py-2 rounded-lg text-[12px] font-bold text-white mb-1 ${eventColor(ev)}`,
                children: [ev.title, ev.start && /* @__PURE__ */ jsx("span", {
                  className: "ml-2 opacity-80 text-[10px]",
                  children: formatTime(new Date(ev.start))
                })]
              }, ev.id))
            })]
          }, h);
        })
      })
    }), eventModalOpen && selectedEvent && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setEventModalOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-3",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: selectedEvent.title
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setEventModalOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2 text-[13px] text-ih-fg-3",
          children: [/* @__PURE__ */ jsxs("p", {
            children: [/* @__PURE__ */ jsx("span", {
              className: "font-bold text-ih-fg-3 text-[11px] uppercase",
              children: "Date:"
            }), " ", selectedEvent.start ? new Date(selectedEvent.start).toLocaleString() : "N/A"]
          }), selectedEvent.status && /* @__PURE__ */ jsxs("p", {
            children: [/* @__PURE__ */ jsx("span", {
              className: "font-bold text-ih-fg-3 text-[11px] uppercase",
              children: "Status:"
            }), " ", selectedEvent.status.replace(/_/g, " ")]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2 mt-5",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setEventModalOpen(false),
            className: "h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3",
            children: "Close"
          }), selectedEvent.url && /* @__PURE__ */ jsx("button", {
            onClick: () => {
              navigate(selectedEvent.url || `/inspections/${selectedEvent.id}/edit`);
              setEventModalOpen(false);
            },
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600",
            children: "Open Inspection"
          }), !selectedEvent.url && /* @__PURE__ */ jsx("button", {
            onClick: () => {
              navigate(`/inspections/${selectedEvent.id}/edit`);
              setEventModalOpen(false);
            },
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600",
            children: "Open Inspection"
          })]
        })]
      })
    })]
  });
});
const route36 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$d,
  default: calendar,
  loader: loader$y,
  meta: meta$t
}, Symbol.toStringTag, { value: "Module" }));
function meta$s() {
  return [{
    title: "Contacts - OpenInspection"
  }];
}
async function loader$x({
  request
}) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const filterType = url.searchParams.get("type") || "";
  try {
    const [contactsRes, agentsRes] = await Promise.all([apiFetch(`/api/contacts${filterType ? `?type=${filterType}` : ""}`, {
      token
    }), apiFetch("/api/agents", {
      token
    })]);
    const contactsBody = contactsRes.ok ? await contactsRes.json() : {
      data: []
    };
    const agentsBody = agentsRes.ok ? await agentsRes.json() : {
      data: []
    };
    return {
      contacts: contactsBody.data ?? [],
      agents: agentsBody.data ?? [],
      filterType
    };
  } catch {
    return {
      contacts: [],
      agents: [],
      filterType: ""
    };
  }
}
async function action$c({
  request
}) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "create" || intent === "update") {
    const id = form.get("id");
    const body = {
      name: form.get("name"),
      email: form.get("email"),
      phone: form.get("phone"),
      agency: form.get("agency"),
      type: form.get("type")
    };
    const res = id ? await apiFetch(`/api/contacts/${id}`, {
      token,
      method: "PUT",
      body: JSON.stringify(body)
    }) : await apiFetch("/api/contacts", {
      token,
      method: "POST",
      body: JSON.stringify(body)
    });
    return {
      ok: res.ok
    };
  }
  if (intent === "delete") {
    const id = form.get("id");
    const res = await apiFetch(`/api/contacts/${id}`, {
      token,
      method: "DELETE"
    });
    return {
      ok: res.ok
    };
  }
  if (intent === "csv-import") {
    const csvText = form.get("csvText");
    const res = await apiFetch("/api/contacts/import", {
      token,
      method: "POST",
      body: JSON.stringify({
        csv: csvText
      })
    });
    const data = res.ok ? await res.json() : {};
    return {
      ok: res.ok,
      result: data
    };
  }
  if (intent === "csv-preview") {
    const csvText = form.get("csvText");
    const res = await apiFetch("/api/contacts/import/preview", {
      token,
      method: "POST",
      body: JSON.stringify({
        csv: csvText
      })
    });
    const data = res.ok ? await res.json() : {};
    return {
      ok: res.ok,
      preview: data
    };
  }
  return {
    ok: false
  };
}
function ContactModal({
  open,
  onClose,
  contact
}) {
  const fetcher = useFetcher();
  if (!open) return null;
  const isEdit = !!contact;
  return /* @__PURE__ */ jsx("div", {
    className: "fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4",
    onClick: (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    children: /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card rounded-md shadow-2xl max-w-lg w-full",
      children: [/* @__PURE__ */ jsxs("header", {
        className: "px-4 py-3 border-b border-ih-border flex items-center justify-between",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-lg font-bold text-ih-fg-1",
          children: isEdit ? "Edit Contact" : "Add Contact"
        }), /* @__PURE__ */ jsx("button", {
          onClick: onClose,
          className: "w-8 h-8 rounded-xl bg-ih-bg-muted hover:opacity-80 flex items-center justify-center text-ih-fg-3",
          children: /* @__PURE__ */ jsx("svg", {
            className: "w-4 h-4",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2.5,
              d: "M6 18L18 6M6 6l12 12"
            })
          })
        })]
      }), /* @__PURE__ */ jsxs(fetcher.Form, {
        method: "post",
        className: "p-4 space-y-4",
        onSubmit: () => setTimeout(onClose, 200),
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: isEdit ? "update" : "create"
        }), isEdit && /* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "id",
          value: contact.id
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5",
            children: "Type"
          }), /* @__PURE__ */ jsxs("select", {
            name: "type",
            defaultValue: (contact == null ? void 0 : contact.type) || "client",
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm",
            children: [/* @__PURE__ */ jsx("option", {
              value: "client",
              children: "Client"
            }), /* @__PURE__ */ jsx("option", {
              value: "agent",
              children: "Agent"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5",
            children: "Full Name *"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            name: "name",
            defaultValue: (contact == null ? void 0 : contact.name) || "",
            placeholder: "Jane Smith",
            required: true,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5",
              children: "Email"
            }), /* @__PURE__ */ jsx("input", {
              type: "email",
              name: "email",
              defaultValue: (contact == null ? void 0 : contact.email) || "",
              placeholder: "jane@realty.com",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5",
              children: "Phone"
            }), /* @__PURE__ */ jsx("input", {
              type: "tel",
              name: "phone",
              defaultValue: (contact == null ? void 0 : contact.phone) || "",
              placeholder: "(555) 123-4567",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1.5",
            children: "Agency"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            name: "agency",
            defaultValue: (contact == null ? void 0 : contact.agency) || "",
            placeholder: "Sunrise Realty",
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-sm"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2 pt-2",
          children: [/* @__PURE__ */ jsx(Button, {
            variant: "secondary",
            type: "button",
            onClick: onClose,
            children: "Cancel"
          }), /* @__PURE__ */ jsx(Button, {
            variant: "primary",
            type: "submit",
            children: "Save"
          })]
        })]
      })]
    })
  });
}
function CsvImportModal({
  open,
  onClose
}) {
  var _a, _b, _c;
  const fetcher = useFetcher();
  const [step, setStep] = useState("upload");
  const [csvText, setCsvText] = useState("");
  const [fileName, setFileName] = useState("");
  const fileRef = useRef(null);
  const preview = (_a = fetcher.data) == null ? void 0 : _a.preview;
  const importResult = (_b = fetcher.data) == null ? void 0 : _b.result;
  const onFileChange = useCallback((e) => {
    var _a2;
    const file = (_a2 = e.target.files) == null ? void 0 : _a2[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      var _a3;
      return setCsvText((_a3 = ev.target) == null ? void 0 : _a3.result);
    };
    reader.readAsText(file);
  }, []);
  if (!open) return null;
  return /* @__PURE__ */ jsx("div", {
    className: "fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4",
    onClick: (e) => {
      if (e.target === e.currentTarget) onClose();
    },
    children: /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card rounded-md shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col",
      children: [/* @__PURE__ */ jsxs("header", {
        className: "px-4 py-3 border-b border-ih-border flex items-center justify-between",
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-lg font-bold text-ih-fg-1",
          children: "Import contacts from CSV"
        }), /* @__PURE__ */ jsx("button", {
          onClick: onClose,
          className: "text-ih-fg-4 hover:text-ih-fg-1 text-xl",
          children: "×"
        })]
      }), step === "upload" && /* @__PURE__ */ jsxs("div", {
        className: "p-6 space-y-4",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-sm text-ih-fg-3",
          children: "Upload a CSV with your contacts. Spectora and ITB exports work out of the box."
        }), /* @__PURE__ */ jsx("input", {
          type: "file",
          ref: fileRef,
          accept: ".csv,text/csv",
          onChange: onFileChange,
          className: "text-sm"
        }), fileName && /* @__PURE__ */ jsxs("p", {
          className: "text-xs text-ih-fg-3",
          children: ["Selected: ", fileName]
        }), /* @__PURE__ */ jsx("textarea", {
          value: csvText,
          onChange: (e) => setCsvText(e.target.value),
          rows: 6,
          placeholder: "...or paste CSV content here",
          className: "w-full px-3 py-2 rounded-lg border border-ih-border bg-ih-bg-card text-xs font-mono"
        }), /* @__PURE__ */ jsx(Button, {
          variant: "primary",
          onClick: () => {
            fetcher.submit({
              intent: "csv-preview",
              csvText
            }, {
              method: "post"
            });
            setStep("preview");
          },
          disabled: !csvText.trim(),
          children: "Preview"
        })]
      }), step === "preview" && /* @__PURE__ */ jsxs("div", {
        className: "p-6 space-y-4",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-3 gap-4 text-center",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "p-4 bg-ih-ok-bg rounded-lg",
            children: [/* @__PURE__ */ jsx("div", {
              className: "text-xl font-bold text-ih-ok-fg",
              children: (preview == null ? void 0 : preview.imported) || 0
            }), /* @__PURE__ */ jsx("div", {
              className: "text-xs text-ih-ok-fg mt-1",
              children: "New contacts"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "p-4 bg-ih-watch-bg rounded-lg",
            children: [/* @__PURE__ */ jsx("div", {
              className: "text-xl font-bold text-ih-watch-fg",
              children: (preview == null ? void 0 : preview.skipped) || 0
            }), /* @__PURE__ */ jsx("div", {
              className: "text-xs text-ih-watch-fg mt-1",
              children: "Duplicates"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "p-4 bg-ih-bad-bg rounded-lg",
            children: [/* @__PURE__ */ jsx("div", {
              className: "text-xl font-bold text-ih-bad-fg",
              children: ((_c = preview == null ? void 0 : preview.errors) == null ? void 0 : _c.length) || 0
            }), /* @__PURE__ */ jsx("div", {
              className: "text-xs text-ih-bad-fg mt-1",
              children: "Errors"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex gap-3 justify-end",
          children: [/* @__PURE__ */ jsx(Button, {
            variant: "secondary",
            onClick: () => setStep("upload"),
            children: "Back"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => {
              fetcher.submit({
                intent: "csv-import",
                csvText
              }, {
                method: "post"
              });
              setStep("done");
            },
            className: "px-5 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-emerald-700",
            children: "Confirm Import"
          })]
        })]
      }), step === "done" && /* @__PURE__ */ jsxs("div", {
        className: "p-6 text-center",
        children: [/* @__PURE__ */ jsx("div", {
          className: "text-3xl mb-3",
          children: "✓"
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-lg font-bold text-ih-ok-fg",
          children: ["Imported ", (importResult == null ? void 0 : importResult.imported) || 0, " contacts"]
        }), /* @__PURE__ */ jsx("button", {
          onClick: onClose,
          className: "mt-4 px-5 py-2 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-xs font-bold uppercase tracking-widest",
          children: "Done"
        })]
      })]
    })
  });
}
const TABS$6 = [{
  id: "contacts",
  label: "Contacts"
}, {
  id: "agents",
  label: "Agents"
}];
const contacts = UNSAFE_withComponentProps(function ContactsPage() {
  const {
    contacts: contacts2,
    agents,
    filterType
  } = useLoaderData();
  const contactList = contacts2;
  const agentList = agents;
  const [activeTab, setActiveTab] = useState("contacts");
  const [modalOpen, setModalOpen] = useState(false);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [typeFilter, setTypeFilter] = useState(filterType || "");
  const deleteFetcher = useFetcher();
  const filtered = typeFilter ? contactList.filter((c) => c.type === typeFilter) : contactList;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Contacts",
      eyebrowColor: "indigo",
      title: "Contacts",
      meta: `${filtered.length} contacts`,
      actions: /* @__PURE__ */ jsxs(Fragment, {
        children: [/* @__PURE__ */ jsxs("select", {
          value: typeFilter,
          onChange: (e) => setTypeFilter(e.target.value),
          className: "h-8 px-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none text-[13px] font-medium",
          children: [/* @__PURE__ */ jsx("option", {
            value: "",
            children: "All Types"
          }), /* @__PURE__ */ jsx("option", {
            value: "agent",
            children: "Agents"
          }), /* @__PURE__ */ jsx("option", {
            value: "client",
            children: "Clients"
          })]
        }), /* @__PURE__ */ jsx(Button, {
          variant: "secondary",
          size: "sm",
          onClick: () => setCsvModalOpen(true),
          children: "Import CSV"
        }), /* @__PURE__ */ jsx(Button, {
          variant: "primary",
          onClick: () => {
            setEditContact(null);
            setModalOpen(true);
          },
          icon: /* @__PURE__ */ jsx(PlusIcon$1, {}),
          children: "Add Contact"
        })]
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$6,
      activeId: activeTab,
      onChange: setActiveTab
    }), activeTab === "contacts" && /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Type"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Email"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Phone"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Agency"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Inspections"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-right",
              children: /* @__PURE__ */ jsx("span", {
                className: "sr-only",
                children: "Actions"
              })
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: filtered.length === 0 ? /* @__PURE__ */ jsx("tr", {
            children: /* @__PURE__ */ jsx("td", {
              colSpan: 7,
              children: /* @__PURE__ */ jsx(EmptyState, {
                title: "No contacts yet",
                description: "Add one above to get started."
              })
            })
          }) : filtered.map((c) => /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border hover:bg-ih-bg-muted/50",
            children: [/* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] font-medium text-ih-fg-1",
              children: c.name
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px]",
              children: /* @__PURE__ */ jsx(Pill, {
                tone: c.type === "agent" ? "info" : "info",
                children: c.type
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: c.email || "—"
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: c.phone || "—"
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: c.agency || "—"
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: c.inspectionCount ?? 0
            }), /* @__PURE__ */ jsxs("td", {
              className: "py-3 px-4 text-right",
              children: [/* @__PURE__ */ jsx("button", {
                onClick: () => {
                  setEditContact(c);
                  setModalOpen(true);
                },
                className: "text-ih-primary text-[12px] font-bold hover:underline mr-3",
                children: "Edit"
              }), /* @__PURE__ */ jsxs(deleteFetcher.Form, {
                method: "post",
                className: "inline",
                children: [/* @__PURE__ */ jsx("input", {
                  type: "hidden",
                  name: "intent",
                  value: "delete"
                }), /* @__PURE__ */ jsx("input", {
                  type: "hidden",
                  name: "id",
                  value: c.id
                }), /* @__PURE__ */ jsx("button", {
                  type: "submit",
                  className: "text-red-500 dark:text-red-400 text-[12px] font-bold hover:underline",
                  children: "Delete"
                })]
              })]
            })]
          }, c.id))
        })]
      })
    }), activeTab === "agents" && /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Agent"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Status"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Linked"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-right",
              children: /* @__PURE__ */ jsx("span", {
                className: "sr-only",
                children: "Actions"
              })
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: agentList.length === 0 ? /* @__PURE__ */ jsx("tr", {
            children: /* @__PURE__ */ jsx("td", {
              colSpan: 4,
              children: /* @__PURE__ */ jsx(EmptyState, {
                title: "No agent partners yet"
              })
            })
          }) : agentList.map((a) => /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border hover:bg-ih-bg-muted/50",
            children: [/* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] font-medium text-ih-fg-1",
              children: a.name
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4",
              children: /* @__PURE__ */ jsx(Pill, {
                tone: a.status === "active" ? "sat" : "monitor",
                children: a.status
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: a.linkedAt || "—"
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-right",
              children: /* @__PURE__ */ jsx("button", {
                className: "text-red-500 text-[12px] font-bold hover:underline",
                children: "Revoke"
              })
            })]
          }, a.id))
        })]
      })
    }), /* @__PURE__ */ jsx(ContactModal, {
      open: modalOpen,
      onClose: () => setModalOpen(false),
      contact: editContact
    }), /* @__PURE__ */ jsx(CsvImportModal, {
      open: csvModalOpen,
      onClose: () => setCsvModalOpen(false)
    })]
  });
});
function PlusIcon$1() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M12 4v16m8-8H4"
    })
  });
}
const route37 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$c,
  default: contacts,
  loader: loader$x,
  meta: meta$s
}, Symbol.toStringTag, { value: "Module" }));
function meta$r() {
  return [{
    title: "Invoices - OpenInspection"
  }];
}
async function loader$w({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/invoices", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      invoices: body.data ?? [],
      stats: {}
    };
  } catch {
    return {
      invoices: [],
      stats: {}
    };
  }
}
const invoices = UNSAFE_withComponentProps(function InvoicesPage() {
  const {
    invoices: invoices2,
    stats
  } = useLoaderData();
  const invoiceList = invoices2;
  const statData = stats;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Invoices",
      eyebrowColor: "emerald",
      title: "Invoices",
      meta: `${invoiceList.length} invoices`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ New Invoice"
      })
    }), /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-2 sm:grid-cols-4 gap-3",
      children: [{
        label: "TOTAL",
        value: statData.total || 0,
        isCurrency: false
      }, {
        label: "UNPAID",
        value: statData.unpaid || 0,
        isCurrency: false
      }, {
        label: "PAID",
        value: statData.paid || 0,
        isCurrency: false
      }, {
        label: "REVENUE",
        value: statData.revenue || 0,
        isCurrency: true
      }].map((s) => /* @__PURE__ */ jsxs(Card, {
        className: "p-[14px]",
        children: [/* @__PURE__ */ jsx("div", {
          className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-3",
          children: s.label
        }), /* @__PURE__ */ jsx("div", {
          className: "text-xl font-bold mt-1 text-ih-fg-1",
          children: s.isCurrency ? `$${(s.value / 100).toLocaleString("en-US", {
            minimumFractionDigits: 0
          })}` : s.value
        })]
      }, s.label))
    }), /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Client"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Amount"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Due Date"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Status"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: invoiceList.length === 0 ? /* @__PURE__ */ jsx("tr", {
            children: /* @__PURE__ */ jsx("td", {
              colSpan: 4,
              children: /* @__PURE__ */ jsx(EmptyState, {
                title: "No invoices yet"
              })
            })
          }) : invoiceList.map((inv) => {
            const invoice2 = inv;
            return /* @__PURE__ */ jsxs("tr", {
              className: "border-b border-ih-border hover:bg-ih-bg-muted/50",
              children: [/* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] font-medium text-ih-fg-1",
                children: invoice2.clientName
              }), /* @__PURE__ */ jsxs("td", {
                className: "py-3 px-4 text-[13px] font-mono text-ih-fg-1",
                children: ["$", ((invoice2.amount || 0) / 100).toFixed(2)]
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3",
                children: invoice2.dueDate || "—"
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3",
                children: invoice2.status
              })]
            }, invoice2.id);
          })
        })]
      })
    })]
  });
});
const route38 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: invoices,
  loader: loader$w,
  meta: meta$r
}, Symbol.toStringTag, { value: "Module" }));
function meta$q() {
  return [{
    title: "Notifications - OpenInspection"
  }];
}
async function loader$v({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/notifications", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      notifications: body.data ?? []
    };
  } catch {
    return {
      notifications: []
    };
  }
}
const notifications = UNSAFE_withComponentProps(function NotificationsPage() {
  const {
    notifications: notifications2
  } = useLoaderData();
  const notificationList = notifications2;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Notifications",
      title: "Notifications",
      meta: `${notificationList.length} notifications`
    }), notificationList.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No notifications",
        description: "You're all caught up."
      })
    }) : /* @__PURE__ */ jsx("div", {
      className: "space-y-2",
      children: notificationList.map((n) => {
        const notification = n;
        return /* @__PURE__ */ jsxs(Card, {
          className: "p-3",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[13px] text-ih-fg-1",
            children: notification.message
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-4 mt-1",
            children: notification.createdAt
          })]
        }, notification.id);
      })
    })]
  });
});
const route39 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: notifications,
  loader: loader$v,
  meta: meta$q
}, Symbol.toStringTag, { value: "Module" }));
function meta$p() {
  return [{
    title: "Templates - OpenInspection"
  }];
}
async function loader$u({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections/templates", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    const templates2 = body.data ?? [];
    return {
      templates: templates2,
      token
    };
  } catch {
    return {
      templates: [],
      token: ""
    };
  }
}
async function action$b({
  request
}) {
  var _a, _b, _c, _d, _e, _f, _g, _h;
  const token = await requireToken(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  if (intent === "create") {
    const name = (_a = formData.get("name")) == null ? void 0 : _a.trim();
    if (!name) return {
      error: "Name is required"
    };
    const res = await apiFetch("/api/inspections/templates", {
      token,
      method: "POST",
      body: JSON.stringify({
        name,
        schema: {
          schemaVersion: 2,
          sections: []
        }
      })
    });
    if (res.ok) {
      const result = await res.json();
      const newId = (result == null ? void 0 : result.data) ? ((_b = result.data) == null ? void 0 : _b.template) ? (_c = result.data.template) == null ? void 0 : _c.id : null : null;
      return {
        ok: true,
        newId
      };
    }
    const err = await res.json().catch(() => ({}));
    return {
      error: (err == null ? void 0 : err.message) || "Failed to create"
    };
  }
  if (intent === "delete") {
    const id = formData.get("id");
    const res = await apiFetch(`/api/inspections/templates/${id}`, {
      token,
      method: "DELETE"
    });
    return {
      ok: res.ok,
      intent: "delete"
    };
  }
  if (intent === "duplicate") {
    formData.get("id");
    const name = formData.get("name");
    const schema = formData.get("schema");
    const res = await apiFetch("/api/inspections/templates", {
      token,
      method: "POST",
      body: JSON.stringify({
        name: name + " (Copy)",
        schema: schema ? JSON.parse(schema) : {
          schemaVersion: 2,
          sections: []
        }
      })
    });
    if (res.ok) {
      const result = await res.json();
      const newId = (result == null ? void 0 : result.data) ? ((_d = result.data) == null ? void 0 : _d.template) ? (_e = result.data.template) == null ? void 0 : _e.id : null : null;
      return {
        ok: true,
        newId,
        intent: "duplicate"
      };
    }
    return {
      error: "Duplication failed",
      intent: "duplicate"
    };
  }
  if (intent === "import-spectora") {
    const name = (_f = formData.get("name")) == null ? void 0 : _f.trim();
    const payload = (_g = formData.get("payload")) == null ? void 0 : _g.trim();
    if (!name || !payload) return {
      error: "Name and JSON are required"
    };
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch (e) {
      return {
        error: "Invalid JSON"
      };
    }
    const res = await apiFetch("/api/inspections/templates/import-spectora", {
      token,
      method: "POST",
      body: JSON.stringify({
        name,
        spectora: parsed
      })
    });
    if (res.ok) {
      const result = await res.json();
      const d = result == null ? void 0 : result.data;
      const newId = (d == null ? void 0 : d.template) ? (_h = d.template) == null ? void 0 : _h.id : null;
      const stats = d == null ? void 0 : d.stats;
      return {
        ok: true,
        newId,
        stats,
        intent: "import-spectora"
      };
    }
    const err = await res.json().catch(() => ({}));
    return {
      error: (err == null ? void 0 : err.message) || "Import failed"
    };
  }
  return {
    ok: false
  };
}
function countItems(t) {
  var _a;
  if (t.itemCount != null) return t.itemCount;
  const sections = (_a = t.schema) == null ? void 0 : _a.sections;
  if (!Array.isArray(sections)) return 0;
  return sections.reduce((acc, s) => acc + (Array.isArray(s.items) ? s.items.length : 0), 0);
}
const templates = UNSAFE_withComponentProps(function TemplatesPage() {
  const {
    templates: templates2
  } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const [view, setView] = useState("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [newName, setNewName] = useState("");
  const [importName, setImportName] = useState("");
  const [importPayload, setImportPayload] = useState("");
  const fetcherData = fetcher.data;
  if ((fetcherData == null ? void 0 : fetcherData.ok) && (fetcherData == null ? void 0 : fetcherData.newId) && typeof fetcherData.newId === "string") {
    navigate(`/templates/${fetcherData.newId}/edit`);
  }
  const filtered = useMemo(() => {
    let list = [...templates2];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter((t) => t.name.toLowerCase().includes(q) || (t.description || "").toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      switch (sortBy) {
        case "name":
          return a.name.localeCompare(b.name);
        case "date":
          return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
        case "usage":
          return (b.usageCount || 0) - (a.usageCount || 0);
        default:
          return 0;
      }
    });
    return list;
  }, [templates2, searchQuery, sortBy]);
  const imported = templates2.filter((t) => t.marketplaceTemplateId).length;
  const withUpdates = templates2.filter((t) => t.upstreamUpdateAvailable).length;
  const handleCreate = () => {
    if (!newName.trim()) return;
    fetcher.submit({
      intent: "create",
      name: newName.trim()
    }, {
      method: "post"
    });
    setCreateOpen(false);
    setNewName("");
  };
  const handleDuplicate = (t) => {
    fetcher.submit({
      intent: "duplicate",
      id: t.id,
      name: t.name,
      schema: JSON.stringify(t.schema || {
        schemaVersion: 2,
        sections: []
      })
    }, {
      method: "post"
    });
  };
  const handleDelete = () => {
    if (!deleteConfirm) return;
    fetcher.submit({
      intent: "delete",
      id: deleteConfirm
    }, {
      method: "post"
    });
    setDeleteConfirm(null);
  };
  const handleImport = () => {
    if (!importName.trim() || !importPayload.trim()) return;
    fetcher.submit({
      intent: "import-spectora",
      name: importName.trim(),
      payload: importPayload.trim()
    }, {
      method: "post"
    });
    setImportOpen(false);
    setImportName("");
    setImportPayload("");
  };
  const metaParts = [`${templates2.length} template${templates2.length === 1 ? "" : "s"}`];
  if (imported > 0) metaParts.push(`${imported} imported from Marketplace`);
  if (withUpdates > 0) metaParts.push(`${withUpdates} with updates available`);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-start justify-between gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsxs("span", {
          className: "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-[0.2em] bg-ih-bg-muted text-ih-fg-3",
          children: [/* @__PURE__ */ jsx("span", {
            className: "w-1 h-1 rounded-full bg-current opacity-60"
          }), "Library · Templates"]
        }), /* @__PURE__ */ jsx("h1", {
          className: "text-[26px] font-bold tracking-tight mt-1",
          children: "Inspection Templates"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: metaParts.join(" · ")
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-2",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "relative",
          children: [/* @__PURE__ */ jsx("input", {
            type: "text",
            value: searchQuery,
            onChange: (e) => setSearchQuery(e.target.value),
            placeholder: "Search templates...",
            className: "h-9 w-44 pl-8 pr-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-2 focus:border-ih-primary focus:shadow-ih-focus outline-none placeholder:text-slate-400"
          }), /* @__PURE__ */ jsx("svg", {
            className: "w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-ih-fg-4",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 1.5,
              d: "M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
            })
          })]
        }), /* @__PURE__ */ jsxs("select", {
          value: sortBy,
          onChange: (e) => setSortBy(e.target.value),
          className: "h-9 px-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-3 outline-none",
          children: [/* @__PURE__ */ jsx("option", {
            value: "name",
            children: "Name"
          }), /* @__PURE__ */ jsx("option", {
            value: "date",
            children: "Last modified"
          }), /* @__PURE__ */ jsx("option", {
            value: "usage",
            children: "Most used"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex bg-ih-bg-muted rounded-md p-0.5",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setView("card"),
            className: `px-3 py-1.5 rounded text-[12px] font-bold ${view === "card" ? "bg-ih-bg-card text-ih-primary shadow-sm" : "text-ih-fg-3"}`,
            children: "Cards"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setView("list"),
            className: `px-3 py-1.5 rounded text-[12px] font-bold ${view === "list" ? "bg-ih-bg-card text-ih-primary shadow-sm" : "text-ih-fg-3"}`,
            children: "List"
          })]
        }), /* @__PURE__ */ jsx("button", {
          onClick: () => setImportOpen(true),
          className: "h-9 px-3 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-3 hover:bg-ih-bg-muted inline-flex items-center gap-2",
          children: "↓ Import Spectora"
        }), /* @__PURE__ */ jsx("button", {
          onClick: () => setCreateOpen(true),
          className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 inline-flex items-center gap-2",
          children: "+ New Template"
        })]
      })]
    }), view === "list" && /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Version"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Items"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right",
              children: "Actions"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: filtered.length === 0 ? /* @__PURE__ */ jsx("tr", {
            children: /* @__PURE__ */ jsx("td", {
              colSpan: 4,
              className: "py-12 text-center text-[13px] text-ih-fg-3",
              children: searchQuery ? "No templates match your search." : "No templates yet. Create one or import from Spectora."
            })
          }) : filtered.map((t) => {
            const items = countItems(t);
            return /* @__PURE__ */ jsxs("tr", {
              className: "border-b border-ih-border hover:bg-ih-bg-muted group",
              children: [/* @__PURE__ */ jsx("td", {
                className: "py-3 px-4",
                children: /* @__PURE__ */ jsxs("div", {
                  className: "flex items-center gap-3",
                  children: [/* @__PURE__ */ jsx("div", {
                    className: "w-9 h-9 bg-ih-primary-tint rounded-lg flex items-center justify-center text-ih-primary group-hover:bg-ih-primary group-hover:text-white transition-all shrink-0",
                    children: /* @__PURE__ */ jsx(TemplateIcon, {})
                  }), /* @__PURE__ */ jsxs("div", {
                    children: [/* @__PURE__ */ jsx(Link, {
                      to: `/templates/${t.id}/edit`,
                      className: "text-[13px] font-bold text-ih-fg-1 hover:text-ih-primary transition-colors",
                      children: t.name
                    }), t.source === "marketplace" && /* @__PURE__ */ jsx("span", {
                      className: "ml-2 text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-100 px-1.5 py-0.5 rounded",
                      children: "Marketplace"
                    }), t.description && /* @__PURE__ */ jsx("p", {
                      className: "text-[11px] text-ih-fg-4 mt-0.5 line-clamp-1",
                      children: t.description
                    })]
                  })]
                })
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4",
                children: /* @__PURE__ */ jsxs("span", {
                  className: "inline-flex items-center rounded border border-ih-primary/20 px-1.5 py-0.5 text-[10px] font-bold bg-ih-primary-tint text-ih-primary",
                  children: ["v", t.version || 1, ".0"]
                })
              }), /* @__PURE__ */ jsxs("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3 font-bold",
                children: [items, " items"]
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-right",
                children: /* @__PURE__ */ jsxs("div", {
                  className: "inline-flex items-center gap-3",
                  children: [/* @__PURE__ */ jsx(Link, {
                    to: `/templates/${t.id}/edit`,
                    className: "text-[11px] font-bold text-ih-primary hover:text-ih-primary",
                    children: "Edit"
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => handleDuplicate(t),
                    className: "text-[11px] font-bold text-ih-fg-3 hover:text-ih-primary transition-colors",
                    children: "Duplicate"
                  }), /* @__PURE__ */ jsx("button", {
                    onClick: () => setDeleteConfirm(t.id),
                    className: "text-[11px] font-bold text-ih-fg-4 hover:text-ih-bad-fg transition-colors",
                    children: "Delete"
                  })]
                })
              })]
            }, t.id);
          })
        })]
      })
    }), view === "card" && /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3",
      children: filtered.length === 0 ? /* @__PURE__ */ jsxs("div", {
        className: "col-span-full text-center py-16 bg-ih-bg-card rounded-lg border border-ih-border",
        children: [/* @__PURE__ */ jsx("p", {
          className: "font-semibold text-ih-fg-2",
          children: searchQuery ? "No matching templates" : "No templates yet"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: "Create one or import from Spectora."
        })]
      }) : filtered.map((t) => {
        const items = countItems(t);
        return /* @__PURE__ */ jsxs("div", {
          className: "bg-ih-bg-card border border-ih-border rounded-lg p-3 flex flex-col gap-2 hover:border-ih-primary transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx(Link, {
              to: `/templates/${t.id}/edit`,
              className: "text-[14px] font-bold text-ih-fg-1 hover:text-ih-primary transition-colors",
              children: t.name
            }), t.description && /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3 line-clamp-2 mt-1",
              children: t.description
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 text-[10px] font-mono text-ih-fg-4",
            children: [/* @__PURE__ */ jsxs("span", {
              className: "inline-flex items-center rounded border border-ih-primary/20 px-1.5 py-0.5 bg-ih-primary-tint text-ih-primary",
              children: ["v", t.version || 1, ".0"]
            }), /* @__PURE__ */ jsxs("span", {
              children: [items, " items"]
            }), /* @__PURE__ */ jsxs("span", {
              children: ["used ", t.usageCount || 0, "×"]
            }), t.source === "marketplace" && /* @__PURE__ */ jsx("span", {
              className: "text-[9px] font-bold uppercase tracking-widest text-violet-700 bg-violet-100 px-1 py-0.5 rounded",
              children: "MP"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-3 pt-1 border-t border-ih-border mt-auto",
            children: [/* @__PURE__ */ jsx(Link, {
              to: `/templates/${t.id}/edit`,
              className: "text-[11px] font-bold text-ih-primary hover:text-ih-primary transition-colors",
              children: "Edit"
            }), /* @__PURE__ */ jsx("button", {
              onClick: () => handleDuplicate(t),
              className: "text-[11px] font-bold text-ih-fg-3 hover:text-ih-primary transition-colors",
              children: "Duplicate"
            }), /* @__PURE__ */ jsx("button", {
              onClick: () => setDeleteConfirm(t.id),
              className: "text-[11px] font-bold text-ih-fg-4 hover:text-ih-bad-fg transition-colors ml-auto",
              children: "Delete"
            })]
          })]
        }, t.id);
      })
    }), createOpen && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setCreateOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-sm bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: "New Template"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setCreateOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
            children: "Template name"
          }), /* @__PURE__ */ jsx("input", {
            value: newName,
            onChange: (e) => setNewName(e.target.value),
            onKeyDown: (e) => e.key === "Enter" && handleCreate(),
            placeholder: "e.g. Residential Full",
            autoFocus: true,
            className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end mt-5",
          children: /* @__PURE__ */ jsx("button", {
            onClick: handleCreate,
            disabled: !newName.trim(),
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed",
            children: "Create Template"
          })
        }), typeof (fetcherData == null ? void 0 : fetcherData.error) === "string" && /* @__PURE__ */ jsx("p", {
          className: "mt-3 text-[12px] text-ih-bad-fg font-medium",
          children: fetcherData.error
        })]
      })
    }), importOpen && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setImportOpen(false),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-lg bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mb-4",
          children: [/* @__PURE__ */ jsx("h2", {
            className: "text-[16px] font-bold text-ih-fg-1",
            children: "Import from Spectora"
          }), /* @__PURE__ */ jsx("button", {
            onClick: () => setImportOpen(false),
            className: "text-ih-fg-4 hover:text-ih-fg-2 text-lg",
            children: "×"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-4",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
              children: "Template name"
            }), /* @__PURE__ */ jsx("input", {
              value: importName,
              onChange: (e) => setImportName(e.target.value),
              placeholder: "e.g. Spectora Residential",
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] outline-none focus:shadow-ih-focus"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[12px] font-bold text-ih-fg-3 mb-1",
              children: "Spectora export JSON"
            }), /* @__PURE__ */ jsx("textarea", {
              value: importPayload,
              onChange: (e) => setImportPayload(e.target.value),
              rows: 8,
              placeholder: "Paste your Spectora export JSON here...",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-mono outline-none focus:shadow-ih-focus"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end mt-5 gap-2",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setImportOpen(false),
            className: "h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3",
            children: "Cancel"
          }), /* @__PURE__ */ jsx("button", {
            onClick: handleImport,
            disabled: !importName.trim() || !importPayload.trim(),
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 disabled:opacity-40 disabled:cursor-not-allowed",
            children: "Import"
          })]
        })]
      })
    }), deleteConfirm && /* @__PURE__ */ jsx("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm",
      onClick: () => setDeleteConfirm(null),
      children: /* @__PURE__ */ jsxs("div", {
        className: "w-full max-w-xs bg-ih-bg-card rounded-xl shadow-2xl p-6",
        onClick: (e) => e.stopPropagation(),
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-[16px] font-bold text-ih-fg-1 mb-2",
          children: "Delete Template"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mb-5",
          children: "Are you sure you want to delete this template? This cannot be undone."
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setDeleteConfirm(null),
            className: "h-8 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-3",
            children: "Cancel"
          }), /* @__PURE__ */ jsx("button", {
            onClick: handleDelete,
            className: "h-8 px-4 rounded-md bg-ih-bad-fg text-white font-bold text-[13px] hover:bg-ih-bad-fg",
            children: "Delete"
          })]
        })]
      })
    })]
  });
});
function TemplateIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2,
      d: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
    })
  });
}
const route40 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$b,
  default: templates,
  loader: loader$u,
  meta: meta$p
}, Symbol.toStringTag, { value: "Module" }));
function meta$o() {
  return [{
    title: "Team - OpenInspection"
  }];
}
async function loader$t({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/team", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      members: body.data ?? [],
      settings: {}
    };
  } catch {
    return {
      members: [],
      settings: {}
    };
  }
}
const ROLE_COLORS = {
  owner: "bg-ih-primary-tint text-ih-primary",
  admin: "bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400",
  inspector: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  lead: "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  specialist: "bg-ih-ok-bg text-ih-ok-fg",
  apprentice: "bg-ih-watch-bg text-ih-watch-fg",
  office: "bg-ih-bg-muted text-ih-fg-3"
};
const TABS$5 = [{
  id: "active",
  label: "Active"
}, {
  id: "pending",
  label: "Pending Invites"
}, {
  id: "apprentices",
  label: "Apprentices"
}, {
  id: "guests",
  label: "Guests"
}];
const team = UNSAFE_withComponentProps(function TeamPage() {
  var _a;
  const {
    members
  } = useLoaderData();
  const sessionCtx = useSessionContext();
  const [activeTab, setActiveTab] = useState("active");
  const filtered = members.filter((m) => {
    if (activeTab === "active") return m.status !== "pending" && m.role !== "apprentice";
    if (activeTab === "pending") return m.status === "pending";
    if (activeTab === "apprentices") return m.role === "apprentice";
    if (activeTab === "guests") return m.role === "guest";
    return true;
  });
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [(sessionCtx == null ? void 0 : sessionCtx.seatUsage) && /* @__PURE__ */ jsx(SeatBanner, {
      usage: sessionCtx.seatUsage,
      billingUrl: ((_a = sessionCtx.branding) == null ? void 0 : _a.portalBaseUrl) ? `${sessionCtx.branding.portalBaseUrl}/billing` : void 0
    }), /* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "SETTINGS · TEAM",
      eyebrowColor: "slate",
      title: "Workspace Team",
      meta: `${members.length} ${members.length === 1 ? "member" : "members"}`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        icon: /* @__PURE__ */ jsx(PlusIcon, {}),
        children: "Invite Member"
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$5,
      activeId: activeTab,
      onChange: setActiveTab
    }), filtered.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: activeTab === "pending" ? "No pending invites" : "No members found",
        description: "Invite team members above to get started."
      })
    }) : /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Role"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Status"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Last Active"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: filtered.map((m) => /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border hover:bg-ih-bg-muted/50",
            children: [/* @__PURE__ */ jsxs("td", {
              className: "py-3 px-4",
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-medium text-ih-fg-1",
                children: m.name || "Unnamed"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3",
                children: m.email
              })]
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4",
              children: /* @__PURE__ */ jsx("span", {
                className: `inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] ${ROLE_COLORS[m.role] || ROLE_COLORS.office}`,
                children: m.role
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4",
              children: /* @__PURE__ */ jsxs("span", {
                className: `inline-flex items-center gap-1.5 text-[12px] font-medium ${m.status === "active" ? "text-ih-ok-fg" : "text-ih-watch-fg"}`,
                children: [/* @__PURE__ */ jsx("span", {
                  className: `w-1.5 h-1.5 rounded-full ${m.status === "active" ? "bg-emerald-500" : "bg-amber-500"}`
                }), m.status === "active" ? "Active" : "Pending"]
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: m.lastActiveAt || "—"
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-right",
              children: /* @__PURE__ */ jsx("button", {
                className: "text-[12px] font-medium text-ih-fg-3 hover:text-ih-fg-1",
                children: "Edit"
              })
            })]
          }, m.id))
        })]
      })
    }), /* @__PURE__ */ jsxs(Card, {
      className: "p-6",
      children: [/* @__PURE__ */ jsx("h2", {
        className: "text-sm font-bold text-ih-fg-1 mb-3",
        children: "Roles"
      }), /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-1 sm:grid-cols-2 gap-3",
        children: [{
          role: "Lead inspector",
          desc: "Full edit, can publish, approves apprentice ratings."
        }, {
          role: "Specialist",
          desc: "Full edit within their assigned sections."
        }, {
          role: "Apprentice",
          desc: "Edits route through the lead's review queue before publish."
        }, {
          role: "Office staff",
          desc: "Read-only access to inspections and scheduling."
        }].map((r) => /* @__PURE__ */ jsxs("div", {
          className: "p-3 border border-ih-border rounded-md",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[13px] font-bold text-ih-fg-1",
            children: r.role
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3 mt-0.5",
            children: r.desc
          })]
        }, r.role))
      })]
    })]
  });
});
function PlusIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 2.5,
      d: "M12 4v16m8-8H4"
    })
  });
}
const route41 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: team,
  loader: loader$t,
  meta: meta$o
}, Symbol.toStringTag, { value: "Module" }));
function meta$n() {
  return [{
    title: "Metrics - OpenInspection"
  }];
}
async function loader$s({
  request
}) {
  const token = await requireToken(request);
  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "6m";
  try {
    const res = await apiFetch(`/api/metrics?period=${encodeURIComponent(period)}`, {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      data: Object.keys(d).length > 0 ? d : null,
      period
    };
  } catch {
    return {
      data: null,
      period
    };
  }
}
const PERIODS = ["3m", "6m", "12m"];
function fmt(n) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0
  }).format(n);
}
const metrics = UNSAFE_withComponentProps(function MetricsPage() {
  var _a, _b, _c, _d;
  const {
    data,
    period: initialPeriod
  } = useLoaderData();
  const navigate = useNavigate();
  const [period, setPeriod] = useState(initialPeriod || "6m");
  const changePeriod = (p) => {
    setPeriod(p);
    navigate(`/metrics?period=${p}`, {
      replace: true
    });
  };
  const kpis = [{
    label: "Total Revenue",
    value: data ? fmt(data.totalRevenue) : "—"
  }, {
    label: "Total Inspections",
    value: data ? String(data.totalInspections) : "—"
  }, {
    label: "Avg Order Value",
    value: data ? fmt(data.avgOrderValue) : "—"
  }];
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "METRICS",
      eyebrowColor: "slate",
      title: "Metrics",
      meta: data ? `${data.totalInspections} inspections` : "Loading...",
      actions: /* @__PURE__ */ jsx("div", {
        className: "flex gap-1 bg-ih-bg-muted rounded-md p-1",
        children: PERIODS.map((p) => /* @__PURE__ */ jsx("button", {
          onClick: () => changePeriod(p),
          className: `h-6 px-3 rounded text-[12px] font-bold transition-all ${period === p ? "bg-ih-bg-card shadow-sm text-ih-fg-1" : "text-ih-fg-4"}`,
          children: p
        }, p))
      })
    }), /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 sm:grid-cols-3 gap-4",
      children: kpis.map((kpi) => /* @__PURE__ */ jsxs(Card, {
        className: "p-5",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[10px] font-bold text-ih-fg-4 uppercase tracking-widest mb-1",
          children: kpi.label
        }), /* @__PURE__ */ jsx("p", {
          className: "text-xl font-bold text-ih-fg-1",
          children: kpi.value
        })]
      }, kpi.label))
    }), /* @__PURE__ */ jsxs(Card, {
      className: "p-5",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-sm font-bold text-ih-fg-1 mb-4",
        children: "Inspections per Month"
      }), data && ((_a = data.months) == null ? void 0 : _a.length) > 0 ? /* @__PURE__ */ jsx("div", {
        className: "flex items-end gap-2 h-40",
        children: data.months.map((m) => {
          const max = Math.max(...data.months.map((x) => x.count), 1);
          const pct = m.count / max * 100;
          return /* @__PURE__ */ jsxs("div", {
            className: "flex-1 flex flex-col items-center gap-1",
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-[10px] font-bold text-ih-fg-3",
              children: m.count
            }), /* @__PURE__ */ jsx("div", {
              className: "w-full bg-ih-primary rounded-t",
              style: {
                height: `${Math.max(pct, 4)}%`
              }
            }), /* @__PURE__ */ jsx("span", {
              className: "text-[10px] text-ih-fg-4",
              children: m.ym.slice(5)
            })]
          }, m.ym);
        })
      }) : /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 text-center py-8",
        children: "No data available for this period."
      })]
    }), /* @__PURE__ */ jsxs(Card, {
      className: "p-5",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-sm font-bold text-ih-fg-1 mb-4",
        children: "Revenue per Month"
      }), data && ((_b = data.months) == null ? void 0 : _b.length) > 0 ? /* @__PURE__ */ jsx("div", {
        className: "flex items-end gap-2 h-40",
        children: data.months.map((m) => {
          const maxRev = Math.max(...data.months.map((x) => x.revenue), 1);
          const pct = m.revenue / maxRev * 100;
          return /* @__PURE__ */ jsxs("div", {
            className: "flex-1 flex flex-col items-center gap-1",
            children: [/* @__PURE__ */ jsx("span", {
              className: "text-[10px] font-bold text-ih-fg-3",
              children: fmt(m.revenue)
            }), /* @__PURE__ */ jsx("div", {
              className: "w-full bg-emerald-500 dark:bg-emerald-400 rounded-t",
              style: {
                height: `${Math.max(pct, 4)}%`
              }
            }), /* @__PURE__ */ jsx("span", {
              className: "text-[10px] text-ih-fg-4",
              children: m.ym.slice(5)
            })]
          }, m.ym + "-rev");
        })
      }) : /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 text-center py-8",
        children: "No revenue data available for this period."
      })]
    }), /* @__PURE__ */ jsxs(Card, {
      className: "p-5",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-sm font-bold text-ih-fg-1 mb-4",
        children: "Findings Heatmap"
      }), data && ((_c = data.heatmap) == null ? void 0 : _c.length) > 0 ? /* @__PURE__ */ jsx("div", {
        className: "overflow-x-auto",
        children: /* @__PURE__ */ jsxs("table", {
          className: "w-full text-left",
          children: [/* @__PURE__ */ jsx("thead", {
            children: /* @__PURE__ */ jsxs("tr", {
              children: [/* @__PURE__ */ jsx("th", {
                className: "py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Section"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-ih-ok-fg text-center",
                children: "Satisfactory"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-ih-watch-fg text-center",
                children: "Monitor"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-2 px-3 text-[10px] font-bold uppercase tracking-widest text-ih-bad-fg text-center",
                children: "Defect"
              })]
            })
          }), /* @__PURE__ */ jsx("tbody", {
            children: data.heatmap.map((row) => /* @__PURE__ */ jsxs("tr", {
              className: "border-t border-ih-border",
              children: [/* @__PURE__ */ jsx("td", {
                className: "py-2 px-3 text-[13px] font-medium text-ih-fg-1",
                children: row.section
              }), /* @__PURE__ */ jsx("td", {
                className: "py-2 px-3 text-[13px] text-center text-ih-ok-fg",
                children: row.satisfactory
              }), /* @__PURE__ */ jsx("td", {
                className: "py-2 px-3 text-[13px] text-center text-ih-watch-fg",
                children: row.monitor
              }), /* @__PURE__ */ jsx("td", {
                className: "py-2 px-3 text-[13px] text-center text-ih-bad-fg",
                children: row.defect
              })]
            }, row.section))
          })]
        })
      }) : /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 text-center py-8",
        children: "No findings data yet."
      })]
    }), /* @__PURE__ */ jsxs(Card, {
      className: "p-5",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-sm font-bold text-ih-fg-1 mb-3",
        children: "Top Referring Agents"
      }), data && ((_d = data.topAgents) == null ? void 0 : _d.length) > 0 ? /* @__PURE__ */ jsx("div", {
        className: "space-y-2",
        children: data.topAgents.slice(0, 5).map((agent, i) => /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between text-[13px]",
          children: [/* @__PURE__ */ jsx("span", {
            className: "font-medium text-ih-fg-1",
            children: agent.agentName
          }), /* @__PURE__ */ jsxs("div", {
            className: "text-right",
            children: [/* @__PURE__ */ jsxs("span", {
              className: "font-bold text-ih-fg-1",
              children: [agent.count, " insp"]
            }), /* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-4 ml-2 text-[12px]",
              children: fmt(agent.revenue)
            })]
          })]
        }, i))
      }) : /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3",
        children: "No agent data yet."
      })]
    })]
  });
});
const route42 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: metrics,
  loader: loader$s,
  meta: meta$n
}, Symbol.toStringTag, { value: "Module" }));
function meta$m() {
  return [{
    title: "Apprentice Review - OpenInspection"
  }];
}
async function loader$r({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/team/apprentice-reviews", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      items: body.data ?? []
    };
  } catch {
    return {
      items: []
    };
  }
}
function initials$1(name) {
  var _a, _b, _c;
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (((_a = parts[0]) == null ? void 0 : _a[0]) ?? "?").toUpperCase();
  return ((((_b = parts[0]) == null ? void 0 : _b[0]) ?? "") + (((_c = parts[parts.length - 1]) == null ? void 0 : _c[0]) ?? "")).toUpperCase();
}
function shortAddress(addr) {
  if (!addr) return "No address";
  return addr.length > 30 ? addr.slice(0, 30) + "..." : addr;
}
const apprenticeReview = UNSAFE_withComponentProps(function ApprenticeReviewPage() {
  var _a;
  const {
    items
  } = useLoaderData();
  const [activeId, setActiveId] = useState(((_a = items[0]) == null ? void 0 : _a.id) ?? null);
  const pendingCount = items.filter((i) => !i.decision).length;
  const active = items.find((i) => i.id === activeId) ?? null;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "TEAM · APPRENTICE REVIEW",
      eyebrowColor: "slate",
      title: "Apprentice Review",
      meta: `${pendingCount} pending ${pendingCount === 1 ? "review" : "reviews"}`
    }), /* @__PURE__ */ jsxs("div", {
      className: `flex items-center gap-3 px-4 py-3 rounded-md border ${pendingCount === 0 ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800" : "bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800"}`,
      children: [/* @__PURE__ */ jsx("span", {
        className: `inline-flex items-center justify-center w-7 h-7 rounded-full text-white shrink-0 ${pendingCount === 0 ? "bg-emerald-500" : "bg-indigo-500"}`,
        children: pendingCount === 0 ? /* @__PURE__ */ jsx(CheckIcon, {}) : /* @__PURE__ */ jsx(InfoIcon, {})
      }), /* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-sm font-bold text-slate-900 dark:text-slate-100",
          children: pendingCount === 0 ? "All caught up" : `${pendingCount} apprentice ${pendingCount === 1 ? "rating" : "ratings"} awaiting review`
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-slate-500 dark:text-slate-400",
          children: "Items flow through here before they appear in the published report."
        })]
      })]
    }), items.length === 0 ? /* @__PURE__ */ jsxs("div", {
      className: "text-center py-16 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700",
      children: [/* @__PURE__ */ jsx("p", {
        className: "font-semibold text-slate-700 dark:text-slate-200",
        children: "Nothing to review"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-slate-500 mt-1",
        children: "Apprentice ratings appear here when they are submitted."
      })]
    }) : /* @__PURE__ */ jsxs("div", {
      className: "grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4 min-h-[480px]",
      children: [/* @__PURE__ */ jsxs("aside", {
        className: "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "px-4 py-3 flex items-center justify-between border-b border-slate-100 dark:border-slate-700",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500",
            children: "Queue"
          }), /* @__PURE__ */ jsxs("span", {
            className: "text-[10px] font-mono text-slate-400 dark:text-slate-500",
            children: [items.filter((i) => i.decision).length, " / ", items.length]
          })]
        }), /* @__PURE__ */ jsx("ul", {
          className: "flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700",
          children: items.map((q) => /* @__PURE__ */ jsx("li", {
            children: /* @__PURE__ */ jsxs("button", {
              onClick: () => setActiveId(q.id),
              className: `w-full text-left px-4 py-3 flex items-start gap-3 transition-colors ${q.id === activeId ? "bg-indigo-50 dark:bg-indigo-900/30 border-l-[2px] border-indigo-500" : "border-l-[2px] border-transparent hover:bg-slate-50 dark:hover:bg-slate-700/50"}`,
              children: [/* @__PURE__ */ jsx("span", {
                className: "inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold shrink-0",
                children: initials$1(q.apprenticeName)
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex-1 min-w-0",
                children: [/* @__PURE__ */ jsx("p", {
                  className: "text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500",
                  children: q.field === "rating" ? "Rating" : q.field === "notes" ? "Notes" : "Value"
                }), /* @__PURE__ */ jsx("p", {
                  className: `text-[13px] mt-0.5 leading-tight ${q.id === activeId ? "text-indigo-700 dark:text-indigo-300 font-bold" : "text-slate-900 dark:text-slate-100 font-semibold"}`,
                  children: q.itemId
                }), /* @__PURE__ */ jsx("p", {
                  className: "text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate",
                  children: shortAddress(q.inspectionAddress)
                }), q.decision && /* @__PURE__ */ jsxs("span", {
                  className: `mt-1 inline-flex items-center gap-1 text-[10px] font-bold ${q.decision === "approved" ? "text-emerald-600 dark:text-emerald-400" : q.decision === "rejected" ? "text-rose-600 dark:text-rose-400" : "text-indigo-600 dark:text-indigo-400"}`,
                  children: [/* @__PURE__ */ jsx(CheckSmallIcon, {}), " ", q.decision === "approved" ? "Approved" : q.decision === "rejected" ? "Rejected" : "Edited"]
                })]
              })]
            })
          }, q.id))
        })]
      }), active ? /* @__PURE__ */ jsxs("section", {
        className: "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md overflow-hidden flex flex-col",
        children: [/* @__PURE__ */ jsxs("header", {
          className: "px-6 py-4 border-b border-slate-100 dark:border-slate-700",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 text-[12px] text-slate-600 dark:text-slate-300 mb-2",
            children: [/* @__PURE__ */ jsx("span", {
              className: "inline-flex items-center justify-center w-6 h-6 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[10px] font-bold",
              children: initials$1(active.apprenticeName)
            }), /* @__PURE__ */ jsx("span", {
              className: "font-semibold",
              children: active.apprenticeName
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-slate-400",
              children: ["submitted ", active.submittedAt]
            })]
          }), /* @__PURE__ */ jsx("h2", {
            className: "text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100",
            children: active.itemId
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[12px] text-slate-500 dark:text-slate-400 mt-1",
            children: ["Field: ", active.field]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex-1 overflow-y-auto p-6 space-y-4",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 rounded-md p-4",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400 dark:text-slate-500 mb-2",
              children: "Apprentice proposed"
            }), /* @__PURE__ */ jsx("pre", {
              className: "whitespace-pre-wrap text-sm text-slate-800 dark:text-slate-200 leading-relaxed",
              children: active.proposedValue || "—"
            })]
          }), active.decision && /* @__PURE__ */ jsxs("div", {
            className: `px-4 py-3 rounded-md text-sm border ${active.decision === "approved" ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300" : "bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300"}`,
            children: ["Decision recorded: ", /* @__PURE__ */ jsx("span", {
              className: "font-bold",
              children: active.decision
            })]
          })]
        }), !active.decision && /* @__PURE__ */ jsxs("div", {
          className: "border-t border-slate-100 dark:border-slate-700 px-6 py-4 flex items-center gap-3",
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-slate-500 dark:text-slate-400 flex-1 max-w-[300px]",
            children: "Approve to publish as-is. Reject sends back to the apprentice."
          }), /* @__PURE__ */ jsx("button", {
            className: "px-3 py-2 rounded-md text-[12px] font-bold border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors",
            children: "Reject"
          }), /* @__PURE__ */ jsxs("button", {
            className: "px-4 py-2 rounded-md text-[12px] font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors inline-flex items-center gap-1.5",
            children: [/* @__PURE__ */ jsx(CheckSmallIcon, {}), " Approve"]
          })]
        })]
      }) : /* @__PURE__ */ jsx("div", {
        className: "flex items-center justify-center bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md",
        children: /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-slate-500",
          children: "Select an item from the queue."
        })
      })]
    })]
  });
});
function CheckIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M4.5 12.75l6 6 9-13.5"
    })
  });
}
function InfoIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-4 h-4",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.5,
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M21 12a9 9 0 11-18 0 9 9 0 0118 0zM12 9v3.75M11.996 16.125h.007v.008h-.007v-.008z"
    })
  });
}
function CheckSmallIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-3 h-3",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 3,
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      d: "M4.5 12.75l6 6 9-13.5"
    })
  });
}
const route43 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: apprenticeReview,
  loader: loader$r,
  meta: meta$m
}, Symbol.toStringTag, { value: "Module" }));
function meta$l() {
  return [{
    title: "Reports - OpenInspection"
  }];
}
async function loader$q({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/inspections?status=completed,delivered", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      reports: body.data ?? []
    };
  } catch {
    return {
      reports: []
    };
  }
}
const TABS$4 = [{
  id: "all",
  label: "All"
}, {
  id: "ready",
  label: "Ready for Review"
}, {
  id: "delivered",
  label: "Delivered"
}, {
  id: "signed",
  label: "Signed"
}];
const STATUS_TONE = {
  completed: "monitor",
  delivered: "sat",
  signed: "info"
};
function statusLabel$1(s) {
  if (s === "completed") return "Ready";
  if (s === "delivered") return "Delivered";
  if (s === "signed") return "Signed";
  return s;
}
const reports = UNSAFE_withComponentProps(function ReportsPage() {
  const {
    reports: reports2
  } = useLoaderData();
  const [activeTab, setActiveTab] = useState("all");
  const [search, setSearch] = useState("");
  const filtered = reports2.filter((r) => {
    var _a, _b;
    if (activeTab === "ready" && r.status !== "completed") return false;
    if (activeTab === "delivered" && r.status !== "delivered") return false;
    if (activeTab === "signed" && r.status !== "signed") return false;
    if (search) {
      const q = search.toLowerCase();
      return ((_a = r.address) == null ? void 0 : _a.toLowerCase().includes(q)) || ((_b = r.clientName) == null ? void 0 : _b.toLowerCase().includes(q));
    }
    return true;
  });
  const tabsWithCount = TABS$4.map((t) => ({
    ...t,
    count: t.id === "all" ? reports2.length : t.id === "ready" ? reports2.filter((r) => r.status === "completed").length : t.id === "delivered" ? reports2.filter((r) => r.status === "delivered").length : reports2.filter((r) => r.status === "signed").length
  }));
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "REPORTS",
      eyebrowColor: "emerald",
      title: "Reports",
      meta: `${reports2.length} ${reports2.length === 1 ? "report" : "reports"}`,
      actions: /* @__PURE__ */ jsx("input", {
        type: "search",
        placeholder: "Search address, client...",
        value: search,
        onChange: (e) => setSearch(e.target.value),
        className: "h-8 w-64 px-3 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-1 focus:border-ih-primary focus:ring-1 focus:ring-ih-primary outline-none transition-all text-[13px] font-medium placeholder:text-ih-fg-4"
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: tabsWithCount,
      activeId: activeTab,
      onChange: setActiveTab
    }), filtered.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No reports found",
        description: search ? "Try a different search term." : "Published inspection reports will appear here."
      })
    }) : /* @__PURE__ */ jsxs(Card, {
      className: "overflow-hidden",
      children: [/* @__PURE__ */ jsx("div", {
        className: "hidden md:block",
        children: /* @__PURE__ */ jsxs("table", {
          className: "w-full text-left",
          children: [/* @__PURE__ */ jsx("thead", {
            children: /* @__PURE__ */ jsxs("tr", {
              className: "border-b border-ih-border",
              children: [/* @__PURE__ */ jsx("th", {
                className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Property"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Client"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Date"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Status"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
                children: "Payment"
              }), /* @__PURE__ */ jsx("th", {
                className: "py-3 px-4"
              })]
            })
          }), /* @__PURE__ */ jsx("tbody", {
            children: filtered.map((r) => /* @__PURE__ */ jsxs("tr", {
              className: "border-b border-ih-border hover:bg-ih-bg-muted/50",
              children: [/* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] font-medium text-ih-fg-1 max-w-[240px] truncate",
                children: r.address || "No address"
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3",
                children: r.clientName || "No client"
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3",
                children: r.date || "—"
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4",
                children: /* @__PURE__ */ jsx(Pill, {
                  tone: STATUS_TONE[r.status] || "gen",
                  children: statusLabel$1(r.status)
                })
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-[13px] text-ih-fg-3",
                children: r.paymentStatus || "—"
              }), /* @__PURE__ */ jsx("td", {
                className: "py-3 px-4 text-right",
                children: /* @__PURE__ */ jsx(Link, {
                  to: `/inspections/${r.id}/edit`,
                  className: "text-[12px] font-semibold text-ih-primary hover:opacity-80",
                  children: "View"
                })
              })]
            }, r.id))
          })]
        })
      }), /* @__PURE__ */ jsx("div", {
        className: "md:hidden divide-y divide-ih-border",
        children: filtered.map((r) => /* @__PURE__ */ jsxs(Link, {
          to: `/inspections/${r.id}/edit`,
          className: "block px-4 py-3 hover:bg-ih-bg-muted/50 transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center justify-between",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-medium text-ih-fg-1 truncate",
              children: r.address || "No address"
            }), /* @__PURE__ */ jsx(Pill, {
              tone: STATUS_TONE[r.status] || "gen",
              className: "ml-2 shrink-0",
              children: statusLabel$1(r.status)
            })]
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-ih-fg-3 mt-0.5",
            children: [r.clientName || "No client", " ", r.date && /* @__PURE__ */ jsxs(Fragment, {
              children: ["· ", r.date]
            })]
          })]
        }, r.id))
      })]
    })]
  });
});
const route44 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: reports,
  loader: loader$q,
  meta: meta$l
}, Symbol.toStringTag, { value: "Module" }));
const settingsLayout = UNSAFE_withComponentProps(function SettingsLayout() {
  return /* @__PURE__ */ jsxs("div", {
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "SETTINGS",
      eyebrowColor: "slate",
      title: "Settings"
    }), /* @__PURE__ */ jsx("div", {
      className: "mt-[18px]",
      children: /* @__PURE__ */ jsx(Outlet, {})
    })]
  });
});
const route45 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsLayout
}, Symbol.toStringTag, { value: "Module" }));
const GROUPS = [{
  to: "/settings/profile",
  title: "Profile",
  desc: "Inspector identity. Shown on reports.",
  icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
}, {
  to: "/settings/workspace",
  title: "Workspace",
  desc: "Branding, report theme, analytics.",
  icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
}, {
  to: "/settings/services",
  title: "Services & catalog",
  desc: "Inspection types, fees, add-ons.",
  icon: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
}, {
  to: "/settings/communication",
  title: "Communication",
  desc: "Email delivery, calendar sync.",
  icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
}, {
  to: "/settings/automations",
  title: "Automations",
  desc: "Email triggers and rules.",
  icon: "M13 10V3L4 14h7v7l9-11h-7z"
}, {
  to: "/settings/data",
  title: "Data",
  desc: "Import, export, GDPR.",
  icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"
}, {
  to: "/settings/widget",
  title: "Embed widget",
  desc: "Booking widget for your site.",
  icon: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
}, {
  to: "/settings/account",
  title: "Account",
  desc: "Password, two-factor, security.",
  icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
}, {
  to: "/settings/advanced",
  title: "Advanced",
  desc: "Payments, AI, integrations.",
  icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z"
}];
const settingsHub = UNSAFE_withComponentProps(function SettingsHub() {
  return /* @__PURE__ */ jsx("div", {
    className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3",
    children: GROUPS.map((g) => /* @__PURE__ */ jsx(Link, {
      to: g.to,
      className: "group p-4 bg-ih-bg-card border border-ih-border rounded-lg hover:shadow-md hover:border-ih-border transition-all",
      children: /* @__PURE__ */ jsxs("div", {
        className: "flex items-start gap-3",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-10 h-10 rounded-lg bg-ih-primary-tint text-ih-primary flex items-center justify-center flex-shrink-0",
          children: /* @__PURE__ */ jsx("svg", {
            className: "w-5 h-5",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: g.icon
            })
          })
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("h3", {
            className: "font-bold text-[14px] text-ih-fg-1 group-hover:text-ih-primary",
            children: g.title
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3 mt-0.5",
            children: g.desc
          })]
        })]
      })
    }, g.to))
  });
});
const route46 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsHub
}, Symbol.toStringTag, { value: "Module" }));
async function loader$p({
  request
}) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/profile", {
    token
  });
  const body = res.ok ? await res.json() : {};
  return {
    profile: body.data ?? {}
  };
}
async function action$a({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body = {};
  for (const key of ["name", "phone", "licenseNumber", "slug", "bio"]) {
    const v = fd.get(key);
    if (v !== null) body[key] = v;
  }
  const res = await apiFetch("/api/profile", {
    token,
    method: "PATCH",
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      error: (err == null ? void 0 : err.message) || "Save failed"
    };
  }
  return {
    success: true,
    error: null
  };
}
const settingsProfile$1 = UNSAFE_withComponentProps(function SettingsProfilePage() {
  const {
    profile
  } = useLoaderData();
  const actionData = useActionData();
  const [bioLen, setBioLen] = useState((profile.bio ?? "").length);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Profile"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Profile"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Inspector identity that appears on every report you generate."
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "Profile saved."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs(Form, {
      method: "post",
      className: "space-y-6",
      children: [/* @__PURE__ */ jsx("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6",
        children: /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 md:grid-cols-3 gap-5",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "profileName",
              className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
              children: "Full Name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              id: "profileName",
              name: "name",
              defaultValue: profile.name ?? "",
              placeholder: "John Smith",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3",
              children: "Displayed on inspection reports."
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "profilePhone",
              className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
              children: "Phone"
            }), /* @__PURE__ */ jsx("input", {
              type: "tel",
              id: "profilePhone",
              name: "phone",
              defaultValue: profile.phone ?? "",
              placeholder: "(555) 123-4567",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "profileLicense",
              className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
              children: "License #"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              id: "profileLicense",
              name: "licenseNumber",
              defaultValue: profile.licenseNumber ?? "",
              placeholder: "HI-12345",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3",
              children: "State inspector license number."
            })]
          })]
        })
      }), /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
        children: [/* @__PURE__ */ jsxs("header", {
          className: "space-y-1",
          children: [/* @__PURE__ */ jsx("h3", {
            className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Booking link"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3",
            children: "Customers visit this URL to book inspections directly with you."
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "profileSlug",
            className: "block text-[13px] font-semibold text-ih-fg-1",
            children: "Slug"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            id: "profileSlug",
            name: "slug",
            defaultValue: profile.slug ?? "",
            placeholder: "your-public-username",
            autoComplete: "off",
            className: "block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-3",
            children: "Lowercase letters, numbers, and hyphens (3-32 chars)."
          })]
        })]
      }), /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
        children: [/* @__PURE__ */ jsxs("header", {
          className: "space-y-1",
          children: [/* @__PURE__ */ jsx("h3", {
            className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Public profile"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3",
            children: "Photo, bio, and service areas shown on your public inspector page."
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[13px] font-semibold text-ih-fg-1",
            children: "Profile photo"
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-4",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-24 h-24 rounded-full bg-ih-bg-muted border border-ih-border overflow-hidden flex items-center justify-center text-ih-fg-4 text-[11px]",
              children: profile.photoUrl ? /* @__PURE__ */ jsx("img", {
                src: profile.photoUrl,
                alt: "Profile",
                className: "w-full h-full object-cover"
              }) : /* @__PURE__ */ jsx("span", {
                children: "No photo"
              })
            }), /* @__PURE__ */ jsxs("div", {
              className: "space-y-2",
              children: [/* @__PURE__ */ jsx("input", {
                type: "file",
                accept: "image/jpeg,image/png,image/webp",
                className: "block text-[11px] text-ih-fg-3"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3",
                children: "JPG, PNG, or WebP. Max 2 MB. Square crop renders best."
              })]
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "profileBio",
            className: "block text-[13px] font-semibold text-ih-fg-1",
            children: "Bio"
          }), /* @__PURE__ */ jsx("textarea", {
            id: "profileBio",
            name: "bio",
            rows: 4,
            maxLength: 600,
            defaultValue: profile.bio ?? "",
            onChange: (e) => setBioLen(e.target.value.length),
            placeholder: "Tell customers a bit about your background, certifications, and inspection style.",
            className: "block w-full rounded-md border border-ih-border bg-ih-bg-card px-3 py-2 text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-colors text-ih-fg-1 placeholder:text-slate-300 dark:placeholder:text-slate-500"
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-ih-fg-3",
            children: [bioLen, " / 600"]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[13px] font-semibold text-ih-fg-1",
            children: "Signature"
          }), /* @__PURE__ */ jsx("div", {
            className: "h-20 rounded-md border border-dashed border-ih-border bg-ih-bg-muted flex items-center justify-center text-[11px] text-ih-fg-4",
            children: "Signature pad - coming soon"
          })]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "flex justify-end",
        children: /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
          children: "Save Profile"
        })
      })]
    })]
  });
});
const route47 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$a,
  default: settingsProfile$1,
  loader: loader$p
}, Symbol.toStringTag, { value: "Module" }));
const THEMES = ["modern", "classic", "minimal"];
async function loader$o({
  request
}) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/admin/branding", {
    token
  });
  const body = res.ok ? await res.json() : {};
  return {
    branding: body.data ?? {}
  };
}
async function action$9({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const body = {};
  for (const key of ["siteName", "primaryColor", "reportTheme", "gaMeasurementId"]) {
    const v = fd.get(key);
    if (v !== null) body[key] = v;
  }
  const rawSources = fd.get("customReferralSources");
  if (typeof rawSources === "string") {
    body.customReferralSources = rawSources.split("\n").map((s) => s.trim()).filter(Boolean);
  }
  const res = await apiFetch("/api/admin/branding", {
    token,
    method: "POST",
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    return {
      success: false,
      error: (err == null ? void 0 : err.message) || "Save failed"
    };
  }
  return {
    success: true,
    error: null
  };
}
const settingsWorkspace = UNSAFE_withComponentProps(function SettingsWorkspacePage() {
  const {
    branding
  } = useLoaderData();
  const actionData = useActionData();
  const [color, setColor] = useState(branding.primaryColor ?? "#6366f1");
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Workspace"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Workspace"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Branding, report theme, analytics, and referral sources."
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "Workspace settings saved."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs(Form, {
      method: "post",
      className: "space-y-6",
      children: [/* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-6",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "Branding"
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 md:grid-cols-2 gap-5",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "siteName",
              className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
              children: "Workspace Name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              id: "siteName",
              name: "siteName",
              defaultValue: branding.siteName ?? "OpenInspection",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] text-ih-fg-1"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "space-y-2",
            children: [/* @__PURE__ */ jsx("label", {
              htmlFor: "primaryColor",
              className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
              children: "Primary Color"
            }), /* @__PURE__ */ jsxs("div", {
              className: "flex gap-3",
              children: [/* @__PURE__ */ jsx("input", {
                type: "color",
                id: "primaryColor",
                name: "primaryColor",
                value: color,
                onChange: (e) => setColor(e.target.value),
                className: "h-10 w-16 rounded-md border border-ih-border p-1 cursor-pointer bg-ih-bg-card"
              }), /* @__PURE__ */ jsx("input", {
                type: "text",
                readOnly: true,
                value: color,
                className: "flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-muted text-ih-fg-3 font-mono text-[13px] cursor-default"
              })]
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-3",
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Company Logo"
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex flex-col sm:flex-row items-center gap-5 p-5 bg-ih-bg-muted rounded-md border border-dashed border-ih-border hover:border-ih-primary transition-colors",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-28 h-28 bg-ih-bg-card rounded-md border border-ih-border flex items-center justify-center overflow-hidden",
              children: branding.logoUrl ? /* @__PURE__ */ jsx("img", {
                src: branding.logoUrl,
                className: "w-full h-full object-contain p-3",
                alt: "Logo"
              }) : /* @__PURE__ */ jsx("div", {
                className: "text-ih-fg-4",
                children: /* @__PURE__ */ jsx("svg", {
                  className: "w-10 h-10",
                  fill: "none",
                  stroke: "currentColor",
                  viewBox: "0 0 24 24",
                  children: /* @__PURE__ */ jsx("path", {
                    strokeLinecap: "round",
                    strokeLinejoin: "round",
                    strokeWidth: 2,
                    d: "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                  })
                })
              })
            }), /* @__PURE__ */ jsxs("div", {
              className: "space-y-2 flex-1 text-center sm:text-left",
              children: [/* @__PURE__ */ jsx("input", {
                type: "file",
                accept: "image/*",
                className: "block text-[11px] text-ih-fg-3"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3 font-bold uppercase tracking-widest",
                children: "PNG / SVG recommended"
              })]
            })]
          })]
        })]
      }), /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "Report Theme"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3",
          children: "Default visual style for client-facing reports."
        }), /* @__PURE__ */ jsx("div", {
          className: "grid grid-cols-3 gap-3",
          children: THEMES.map((t) => /* @__PURE__ */ jsxs("label", {
            className: "cursor-pointer",
            children: [/* @__PURE__ */ jsx("input", {
              type: "radio",
              name: "reportTheme",
              value: t,
              defaultChecked: (branding.reportTheme ?? "modern") === t,
              className: "sr-only peer"
            }), /* @__PURE__ */ jsx("div", {
              className: "p-4 rounded-md border-2 text-[13px] font-bold uppercase tracking-[0.2em] capitalize transition-all text-center peer-checked:border-ih-primary peer-checked:bg-ih-primary-tint peer-checked:text-ih-primary border-ih-border bg-ih-bg-card text-ih-fg-2 hover:border-ih-border",
              children: t
            })]
          }, t))
        })]
      }), /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "Telemetry"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3",
          children: "Optional Google Analytics 4 tracking on client-facing pages. Leave blank to disable."
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2 max-w-md",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "gaMeasurementId",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "GA Measurement ID"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            id: "gaMeasurementId",
            name: "gaMeasurementId",
            defaultValue: branding.gaMeasurementId ?? "",
            placeholder: "G-XXXXXXXXXX",
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[11px] text-ih-fg-3",
            children: ["Format: ", /* @__PURE__ */ jsx("code", {
              className: "font-mono",
              children: "G-XXXXXXXXXX"
            }), "."]
          })]
        })]
      }), /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "Referral Sources"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-3",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-[11px] font-bold uppercase tracking-[0.2em] text-ih-fg-2",
            children: "Built-in sources"
          }), /* @__PURE__ */ jsx("div", {
            className: "flex flex-wrap gap-2",
            children: ["Realtor", "Past Client", "Google Search", "Facebook", "Yelp", "Walk-in", "Other"].map((s) => /* @__PURE__ */ jsx("span", {
              className: "px-2.5 py-1 rounded-md text-[11px] font-bold bg-ih-bg-muted text-ih-fg-2",
              children: s
            }, s))
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "customReferralSources",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Custom labels"
          }), /* @__PURE__ */ jsx("textarea", {
            id: "customReferralSources",
            name: "customReferralSources",
            rows: 6,
            defaultValue: (branding.customReferralSources ?? []).join("\n"),
            placeholder: "Magazine ad\nTrade show\nReferral partner",
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-medium text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-3",
            children: "One label per line. Maximum 32 entries; duplicates are ignored."
          })]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "flex justify-end",
        children: /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
          children: "Save Workspace"
        })
      })]
    })]
  });
});
const route48 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$9,
  default: settingsWorkspace,
  loader: loader$o
}, Symbol.toStringTag, { value: "Module" }));
function meta$k() {
  return [{
    title: "Services & Catalog - Settings - OpenInspection"
  }];
}
async function loader$n({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/services", {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      services: Array.isArray(d == null ? void 0 : d.services) ? d.services : [],
      discounts: Array.isArray(d == null ? void 0 : d.discounts) ? d.discounts : []
    };
  } catch {
    return {
      services: [],
      discounts: []
    };
  }
}
async function action$8({
  request
}) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "create-service") {
    await apiFetch("/api/admin/services", {
      token,
      method: "POST",
      body: JSON.stringify({
        name: form.get("name"),
        description: form.get("description") || null,
        price: Number(form.get("price")) * 100 || 0
      })
    });
  } else if (intent === "toggle-service") {
    const id = form.get("id");
    const active = form.get("active") === "true";
    await apiFetch(`/api/admin/services/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({
        active: !active
      })
    });
  }
  return {
    ok: true
  };
}
const settingsServices = UNSAFE_withComponentProps(function SettingsServices() {
  const {
    services,
    discounts
  } = useLoaderData();
  const [showForm, setShowForm] = useState(false);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Services & catalog"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-[19px] font-bold text-ih-fg-1",
          children: "Services & catalog"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-0.5",
          children: "Define the services you offer and their prices, plus discount codes."
        })]
      }), /* @__PURE__ */ jsx("button", {
        onClick: () => setShowForm(!showForm),
        className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
        children: "+ Add service"
      })]
    }), showForm && /* @__PURE__ */ jsxs(Form, {
      method: "post",
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-4 space-y-3",
      children: [/* @__PURE__ */ jsx("input", {
        type: "hidden",
        name: "intent",
        value: "create-service"
      }), /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-1 md:grid-cols-3 gap-3",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1",
            children: "Name"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            name: "name",
            required: true,
            placeholder: "e.g., Standard Inspection",
            className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1",
            children: "Description"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            name: "description",
            placeholder: "Optional details",
            className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1",
            children: "Price ($)"
          }), /* @__PURE__ */ jsx("input", {
            type: "number",
            name: "price",
            min: "0",
            step: "0.01",
            placeholder: "450.00",
            className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex justify-end gap-2",
        children: [/* @__PURE__ */ jsx("button", {
          type: "button",
          onClick: () => setShowForm(false),
          className: "h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
          children: "Cancel"
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
          children: "Save"
        })]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Duration"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Price"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Status"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right",
              children: "Actions"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: services.length === 0 ? /* @__PURE__ */ jsx("tr", {
            children: /* @__PURE__ */ jsx("td", {
              colSpan: 5,
              className: "py-10 text-center text-[13px] text-ih-fg-3",
              children: 'No services yet. Click "Add service" to create your first.'
            })
          }) : services.map((svc) => /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border last:border-b-0 hover:bg-ih-bg-muted transition-colors",
            children: [/* @__PURE__ */ jsxs("td", {
              className: "py-3 px-4",
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-medium text-ih-fg-1",
                children: svc.name
              }), svc.description && /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3 mt-0.5 line-clamp-1",
                children: svc.description
              })]
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-[13px] text-ih-fg-3",
              children: "—"
            }), /* @__PURE__ */ jsxs("td", {
              className: "py-3 px-4 text-[13px] font-bold text-ih-ok-fg",
              children: ["$", ((svc.price || 0) / 100).toFixed(2)]
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4",
              children: /* @__PURE__ */ jsx("span", {
                className: `text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${svc.active ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
                children: svc.active ? "Active" : "Inactive"
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "py-3 px-4 text-right",
              children: /* @__PURE__ */ jsxs(Form, {
                method: "post",
                className: "inline",
                children: [/* @__PURE__ */ jsx("input", {
                  type: "hidden",
                  name: "intent",
                  value: "toggle-service"
                }), /* @__PURE__ */ jsx("input", {
                  type: "hidden",
                  name: "id",
                  value: svc.id
                }), /* @__PURE__ */ jsx("input", {
                  type: "hidden",
                  name: "active",
                  value: String(svc.active)
                }), /* @__PURE__ */ jsx("button", {
                  type: "submit",
                  className: "text-[12px] font-semibold text-ih-primary hover:underline",
                  children: svc.active ? "Deactivate" : "Activate"
                })]
              })
            })]
          }, svc.id))
        })]
      })
    }), /* @__PURE__ */ jsxs("div", {
      className: "pt-2",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[15px] font-bold text-ih-fg-1 mb-2",
        children: "Discount codes"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mb-3",
        children: "Promo codes clients can apply at booking."
      }), /* @__PURE__ */ jsx("div", {
        className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
        children: discounts.length === 0 ? /* @__PURE__ */ jsx("div", {
          className: "py-8 text-center text-[13px] text-ih-fg-3",
          children: "No discount codes yet."
        }) : /* @__PURE__ */ jsx("div", {
          className: "divide-y divide-ih-border",
          children: discounts.map((d) => /* @__PURE__ */ jsxs("div", {
            className: "flex items-center justify-between px-4 py-3",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex items-center gap-4",
              children: [/* @__PURE__ */ jsx("code", {
                className: "font-mono text-[13px] font-bold text-ih-fg-1",
                children: d.code
              }), /* @__PURE__ */ jsx("span", {
                className: "text-[12px] text-ih-fg-3",
                children: d.type === "percent" ? `${d.value}% off` : `$${(d.value / 100).toFixed(2)} off`
              }), /* @__PURE__ */ jsx("span", {
                className: `text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${d.active ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
                children: d.active ? "Active" : "Disabled"
              })]
            }), /* @__PURE__ */ jsx("button", {
              className: "text-[12px] font-semibold text-ih-primary hover:underline",
              children: "Edit"
            })]
          }, d.id))
        })
      })]
    })]
  });
});
const route49 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$8,
  default: settingsServices,
  loader: loader$n,
  meta: meta$k
}, Symbol.toStringTag, { value: "Module" }));
function SecretField({
  name,
  label,
  value,
  hint,
  type = "password"
}) {
  const isSet = value.length > 0;
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const inputRef = useRef(null);
  const handleFocus = useCallback(() => {
    if (!editing) {
      setEditing(true);
      setInputValue("");
    }
  }, [editing]);
  const handleBlur = useCallback(() => {
    if (inputValue.trim() === "") {
      setEditing(false);
      setInputValue("");
    }
  }, [inputValue]);
  const submitValue = editing && inputValue.trim() !== "" ? inputValue : "";
  return /* @__PURE__ */ jsxs("div", { className: "space-y-1", children: [
    /* @__PURE__ */ jsx(
      "label",
      {
        htmlFor: `secret-${name}`,
        className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3",
        children: label
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "relative", children: [
      /* @__PURE__ */ jsx("input", { type: "hidden", name, value: submitValue }),
      /* @__PURE__ */ jsx(
        "input",
        {
          ref: inputRef,
          id: `secret-${name}`,
          type: editing ? type === "password" ? "text" : "text" : "text",
          value: editing ? inputValue : isSet ? value : "",
          placeholder: isSet ? "" : "Not configured",
          onFocus: handleFocus,
          onBlur: handleBlur,
          onChange: (e) => setInputValue(e.target.value),
          autoComplete: "off",
          autoCorrect: "off",
          autoCapitalize: "off",
          spellCheck: false,
          className: `w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all ${isSet && !editing ? "font-mono text-ih-fg-3" : "text-ih-fg-1"}`
        }
      ),
      !editing && /* @__PURE__ */ jsx(
        "span",
        {
          className: `absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-widest ${isSet ? "text-ih-ok-fg" : "text-ih-fg-4"}`,
          children: isSet ? "Set" : ""
        }
      )
    ] }),
    hint && /* @__PURE__ */ jsx("p", { className: "text-[11px] text-ih-fg-4", children: hint })
  ] });
}
function meta$j() {
  return [{
    title: "Communication - Settings - OpenInspection"
  }];
}
async function loader$m({
  request
}) {
  const token = await requireToken(request);
  const [commRes, secretsRes] = await Promise.all([apiFetch("/api/admin/communication", {
    token
  }).catch(() => null), apiFetch("/api/admin/secrets", {
    token
  }).catch(() => null)]);
  const commBody = (commRes == null ? void 0 : commRes.ok) ? await commRes.json() : {};
  const d = commBody.data ?? {};
  const secretsBody = (secretsRes == null ? void 0 : secretsRes.ok) ? await secretsRes.json() : {};
  const secrets = secretsBody.data ?? {};
  return {
    config: {
      senderEmail: (d == null ? void 0 : d.senderEmail) || null,
      replyTo: (d == null ? void 0 : d.replyTo) || null,
      resendConfigured: Boolean(d == null ? void 0 : d.resendConfigured)
    },
    templates: Array.isArray(d == null ? void 0 : d.templates) ? d.templates : [],
    icsUrl: (d == null ? void 0 : d.icsUrl) || null,
    googleCalendarConnected: Boolean(d == null ? void 0 : d.googleCalendarConnected),
    secrets: {
      RESEND_API_KEY: secrets.RESEND_API_KEY || "",
      SENDER_EMAIL: secrets.SENDER_EMAIL || "",
      GOOGLE_CLIENT_ID: secrets.GOOGLE_CLIENT_ID || "",
      GOOGLE_CLIENT_SECRET: secrets.GOOGLE_CLIENT_SECRET || ""
    }
  };
}
async function action$7({
  request
}) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "save-email") {
    await apiFetch("/api/admin/communication", {
      token,
      method: "PATCH",
      body: JSON.stringify({
        senderEmail: form.get("senderEmail") || null,
        replyTo: form.get("replyTo") || null
      })
    });
  }
  if (intent === "save-email-secrets") {
    const body = {};
    const resendKey = form.get("RESEND_API_KEY");
    const senderEmail = form.get("SENDER_EMAIL");
    if (resendKey && typeof resendKey === "string" && resendKey.trim()) body.RESEND_API_KEY = resendKey;
    if (senderEmail && typeof senderEmail === "string" && senderEmail.trim()) body.SENDER_EMAIL = senderEmail;
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return {
          ok: false,
          error: "Failed to save email secrets."
        };
      }
    }
    return {
      ok: true
    };
  }
  if (intent === "save-calendar-secrets") {
    const body = {};
    const clientId = form.get("GOOGLE_CLIENT_ID");
    const clientSecret = form.get("GOOGLE_CLIENT_SECRET");
    if (clientId && typeof clientId === "string" && clientId.trim()) body.GOOGLE_CLIENT_ID = clientId;
    if (clientSecret && typeof clientSecret === "string" && clientSecret.trim()) body.GOOGLE_CLIENT_SECRET = clientSecret;
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return {
          ok: false,
          error: "Failed to save calendar secrets."
        };
      }
    }
    return {
      ok: true
    };
  }
  return {
    ok: true
  };
}
const settingsCommunication = UNSAFE_withComponentProps(function SettingsCommunication() {
  const {
    config,
    templates: templates2,
    icsUrl,
    googleCalendarConnected,
    secrets
  } = useLoaderData();
  const actionData = useActionData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Communication"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Communication"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Configure email delivery, templates, and calendar sync."
    }), actionData && !actionData.ok && actionData.error && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Email delivery"
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-email"
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 md:grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1",
              children: "Sender email"
            }), /* @__PURE__ */ jsx("input", {
              type: "email",
              name: "senderEmail",
              defaultValue: config.senderEmail || "",
              placeholder: "reports@yourdomain.com",
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-4 mt-1",
              children: 'Used as the "From" address. Domain must be verified in Resend.'
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3 mb-1",
              children: "Reply-to"
            }), /* @__PURE__ */ jsx("input", {
              type: "email",
              name: "replyTo",
              defaultValue: config.replyTo || "",
              placeholder: "hello@yourdomain.com",
              className: "w-full h-9 px-3 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-4 mt-1",
              children: "Replies go to this address."
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between pt-3 border-t border-ih-border",
          children: [/* @__PURE__ */ jsx("span", {
            className: `text-[11px] font-bold ${config.resendConfigured ? "text-ih-ok-fg" : "text-ih-watch-fg"}`,
            children: config.resendConfigured ? "Resend API key configured" : "Resend API key not set"
          }), /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
            children: "Save"
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Email API keys"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Without email configured, password resets and booking confirmations will not be sent. Get a key at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://resend.com",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "resend.com"
        }), "."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-email-secrets"
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 md:grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsx(SecretField, {
            name: "RESEND_API_KEY",
            label: "Resend API key",
            value: secrets.RESEND_API_KEY,
            hint: "Email delivery for reports, confirmations, and password resets. Get your key at resend.com → API Keys"
          }), /* @__PURE__ */ jsx(SecretField, {
            name: "SENDER_EMAIL",
            label: "Sender email (secret)",
            value: secrets.SENDER_EMAIL,
            type: "text",
            hint: "Verified sender address (e.g. reports@yourdomain.com). Must be verified in your Resend account"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-3 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
            children: "Save API keys"
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: [/* @__PURE__ */ jsx("div", {
        className: "px-5 py-4 border-b border-ih-border",
        children: /* @__PURE__ */ jsx("h3", {
          className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
          children: "Email templates"
        })
      }), templates2.length === 0 ? /* @__PURE__ */ jsx("div", {
        className: "py-8 text-center text-[13px] text-ih-fg-3",
        children: "No email templates configured. Default system emails are used."
      }) : /* @__PURE__ */ jsx("div", {
        className: "divide-y divide-ih-border",
        children: templates2.map((tpl) => /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-medium text-ih-fg-1",
              children: tpl.name
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-[11px] text-ih-fg-3 mt-0.5",
              children: ["Trigger: ", tpl.trigger]
            })]
          }), /* @__PURE__ */ jsx("span", {
            className: `text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${tpl.active ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
            children: tpl.active ? "Active" : "Disabled"
          })]
        }, tpl.id))
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Google OAuth credentials"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Required for Google Calendar two-way sync. Create credentials at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://console.cloud.google.com/apis/credentials",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "Google Cloud Console"
        }), "."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-calendar-secrets"
        }), /* @__PURE__ */ jsxs("div", {
          className: "grid grid-cols-1 md:grid-cols-2 gap-4",
          children: [/* @__PURE__ */ jsx(SecretField, {
            name: "GOOGLE_CLIENT_ID",
            label: "Google Client ID",
            value: secrets.GOOGLE_CLIENT_ID,
            hint: "Enables Google Calendar sync. Create at console.cloud.google.com → APIs → OAuth 2.0"
          }), /* @__PURE__ */ jsx(SecretField, {
            name: "GOOGLE_CLIENT_SECRET",
            label: "Google Client Secret",
            value: secrets.GOOGLE_CLIENT_SECRET,
            hint: "Paired with Client ID above. Found in the same OAuth 2.0 credentials page"
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-3 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
            children: "Save credentials"
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Calendar sync"
      }), /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-1 md:grid-cols-2 gap-4",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "p-4 border border-ih-border rounded-lg",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-3 mb-3",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-8 h-8 rounded-lg bg-ih-primary-tint flex items-center justify-center",
              children: /* @__PURE__ */ jsx(CalendarIcon, {
                className: "w-4 h-4 text-ih-primary"
              })
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-bold text-ih-fg-1",
                children: "Google Calendar"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3",
                children: "Two-way sync via OAuth"
              })]
            })]
          }), googleCalendarConnected ? /* @__PURE__ */ jsx("span", {
            className: "text-[11px] font-bold text-ih-ok-fg",
            children: "Connected"
          }) : /* @__PURE__ */ jsx("button", {
            className: "h-8 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
            children: "Connect Google Calendar"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "p-4 border border-ih-border rounded-lg",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-3 mb-3",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-8 h-8 rounded-lg bg-ih-bg-muted flex items-center justify-center",
              children: /* @__PURE__ */ jsx(CalendarIcon, {
                className: "w-4 h-4 text-ih-fg-3"
              })
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-bold text-ih-fg-1",
                children: "Apple Calendar"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[11px] text-ih-fg-3",
                children: "Read-only ICS feed"
              })]
            })]
          }), icsUrl ? /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2",
            children: [/* @__PURE__ */ jsx("input", {
              type: "text",
              readOnly: true,
              value: icsUrl,
              className: "flex-1 h-8 px-2 rounded-md border border-ih-border bg-ih-bg-muted text-[11px] font-mono text-ih-fg-3 outline-none"
            }), /* @__PURE__ */ jsx("button", {
              onClick: () => {
                void navigator.clipboard.writeText(icsUrl);
              },
              className: "h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors shrink-0",
              children: "Copy"
            })]
          }) : /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-3",
            children: "ICS feed URL will appear once calendar sync is configured."
          })]
        })]
      })]
    })]
  });
});
function CalendarIcon({
  className
}) {
  return /* @__PURE__ */ jsx("svg", {
    className,
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      d: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
    })
  });
}
const route50 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$7,
  default: settingsCommunication,
  loader: loader$m,
  meta: meta$j
}, Symbol.toStringTag, { value: "Module" }));
function meta$i() {
  return [{
    title: "Automations - Settings - OpenInspection"
  }];
}
const TRIGGER_LABELS = {
  inspection_confirmed: "Inspection confirmed",
  inspection_completed: "Inspection completed",
  report_delivered: "Report delivered",
  payment_received: "Payment received",
  booking_created: "New booking created",
  reminder_24h: "24 hours before inspection"
};
const ACTION_LABELS = {
  send_confirmation: "Send confirmation email",
  send_reminder: "Send reminder email",
  send_report: "Deliver report",
  send_receipt: "Send payment receipt",
  send_review_request: "Request review",
  notify_agent: "Notify agent"
};
async function loader$l({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/automations", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      rules: body.data ?? []
    };
  } catch {
    return {
      rules: []
    };
  }
}
async function action$6({
  request
}) {
  const token = await requireToken(request);
  const form = await request.formData();
  const intent = form.get("intent");
  if (intent === "toggle") {
    const id = form.get("id");
    const active = form.get("active") === "true";
    await apiFetch(`/api/admin/automations/${id}`, {
      token,
      method: "PATCH",
      body: JSON.stringify({
        active: !active
      })
    });
  }
  return {
    ok: true
  };
}
const settingsAutomations = UNSAFE_withComponentProps(function SettingsAutomations() {
  const {
    rules
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Automations"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-center justify-between gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-[19px] font-bold text-ih-fg-1",
          children: "Automations"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-0.5",
          children: "Emails sent automatically when inspection events occur."
        })]
      }), /* @__PURE__ */ jsx("button", {
        className: "h-8 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
        children: "+ Add automation"
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: rules.length === 0 ? /* @__PURE__ */ jsxs("div", {
        className: "py-10 text-center",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-12 h-12 mx-auto mb-3 rounded-lg bg-ih-primary-tint flex items-center justify-center",
          children: /* @__PURE__ */ jsx(BoltIcon, {})
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] font-semibold text-ih-fg-2",
          children: "No automations yet"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Add an automation rule to send emails on inspection events."
        })]
      }) : /* @__PURE__ */ jsx("div", {
        className: "divide-y divide-ih-border",
        children: rules.map((rule) => /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-4 px-5 py-3.5 hover:bg-ih-bg-muted transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex-1 min-w-0",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex items-center gap-2",
              children: [/* @__PURE__ */ jsx("p", {
                className: "text-[13px] font-bold text-ih-fg-1",
                children: rule.name
              }), rule.isDefault && /* @__PURE__ */ jsx("span", {
                className: "text-[9px] font-bold px-1.5 py-0.5 bg-ih-bg-muted text-ih-fg-3 rounded uppercase tracking-widest",
                children: "Default"
              })]
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-[11px] text-ih-fg-3 mt-0.5",
              children: [/* @__PURE__ */ jsx("span", {
                children: TRIGGER_LABELS[rule.trigger] || rule.trigger
              }), /* @__PURE__ */ jsx("span", {
                className: "mx-1.5",
                children: "→"
              }), /* @__PURE__ */ jsx("span", {
                children: ACTION_LABELS[rule.action] || rule.action
              })]
            })]
          }), /* @__PURE__ */ jsxs(Form, {
            method: "post",
            className: "flex items-center gap-2 shrink-0",
            children: [/* @__PURE__ */ jsx("input", {
              type: "hidden",
              name: "intent",
              value: "toggle"
            }), /* @__PURE__ */ jsx("input", {
              type: "hidden",
              name: "id",
              value: rule.id
            }), /* @__PURE__ */ jsx("input", {
              type: "hidden",
              name: "active",
              value: String(rule.active)
            }), /* @__PURE__ */ jsx("button", {
              type: "submit",
              className: `w-10 h-6 rounded-full relative transition-colors ${rule.active ? "bg-ih-primary" : "bg-slate-200 dark:bg-slate-600"}`,
              "aria-label": rule.active ? "Disable automation" : "Enable automation",
              children: /* @__PURE__ */ jsx("span", {
                className: `absolute w-4 h-4 bg-white rounded-full top-1 transition-all ${rule.active ? "right-1" : "left-1"}`
              })
            })]
          })]
        }, rule.id))
      })
    })]
  });
});
function BoltIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-5 h-5 text-ih-primary",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      d: "M13 10V3L4 14h7v7l9-11h-7z"
    })
  });
}
const route51 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$6,
  default: settingsAutomations,
  loader: loader$l,
  meta: meta$i
}, Symbol.toStringTag, { value: "Module" }));
function meta$h() {
  return [{
    title: "Data - Settings - OpenInspection"
  }];
}
const settingsData = UNSAFE_withComponentProps(function SettingsData() {
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Data"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Data import / export"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Download your data or import contacts from other platforms."
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
          children: "Export"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Download your data as CSV or JSON. All historical records are included."
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex gap-3 flex-wrap",
        children: [/* @__PURE__ */ jsxs("a", {
          href: "/api/admin/export?format=csv&type=inspections",
          className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors inline-flex items-center gap-2",
          children: [/* @__PURE__ */ jsx(DownloadIcon, {}), "Inspections CSV"]
        }), /* @__PURE__ */ jsxs("a", {
          href: "/api/admin/export?format=csv&type=contacts",
          className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2",
          children: [/* @__PURE__ */ jsx(DownloadIcon, {}), "Contacts CSV"]
        }), /* @__PURE__ */ jsxs("a", {
          href: "/api/admin/export?format=json",
          className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2",
          children: [/* @__PURE__ */ jsx(DownloadIcon, {}), "Full JSON"]
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
          children: "Import contacts"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Supports Spectora and Inspector Toolbelt export formats. Duplicates (same email) are skipped."
        })]
      }), /* @__PURE__ */ jsxs("label", {
        className: "block cursor-pointer",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "inline-flex items-center gap-3",
          children: [/* @__PURE__ */ jsxs("span", {
            className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center gap-2",
            children: [/* @__PURE__ */ jsx(UploadIcon, {}), "Choose CSV file"]
          }), /* @__PURE__ */ jsx("span", {
            className: "text-[11px] text-ih-fg-3",
            children: "Max 5 MB, UTF-8 encoded"
          })]
        }), /* @__PURE__ */ jsx("input", {
          type: "file",
          accept: ".csv,text/csv",
          className: "hidden"
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
          children: "Data cleanup"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Remove test data or request a full GDPR data export."
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex gap-3 flex-wrap",
        children: [/* @__PURE__ */ jsx("button", {
          className: "h-9 px-4 rounded-md border border-ih-bad text-[13px] font-medium text-ih-bad-fg hover:bg-ih-bad-bg transition-colors",
          children: "Delete test data"
        }), /* @__PURE__ */ jsx("button", {
          className: "h-9 px-4 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
          children: "Request GDPR export"
        })]
      })]
    })]
  });
});
function DownloadIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
    })
  });
}
function UploadIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-3.5 h-3.5",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      d: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
    })
  });
}
const route52 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsData,
  meta: meta$h
}, Symbol.toStringTag, { value: "Module" }));
function meta$g() {
  return [{
    title: "Embed Widget - Settings - OpenInspection"
  }];
}
async function loader$k({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/widget", {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      config: {
        origins: (d == null ? void 0 : d.origins) || [],
        style: (d == null ? void 0 : d.style) || "light",
        snippetUrl: (d == null ? void 0 : d.snippetUrl) || null,
        previewUrl: (d == null ? void 0 : d.previewUrl) || null
      }
    };
  } catch {
    return {
      config: {
        origins: [],
        style: "light",
        snippetUrl: null,
        previewUrl: null
      }
    };
  }
}
const STYLES = [{
  id: "light",
  label: "Light",
  icon: "sun"
}, {
  id: "dark",
  label: "Dark",
  icon: "moon"
}, {
  id: "branded",
  label: "Branded",
  icon: "palette"
}];
const settingsWidget = UNSAFE_withComponentProps(function SettingsWidget() {
  const {
    config
  } = useLoaderData();
  const [style, setStyle] = useState(config.style);
  const [copied, setCopied] = useState(false);
  const snippet = config.snippetUrl ? `<iframe src="${config.snippetUrl}?style=${style}" style="width:100%;min-height:700px;border:none;" loading="lazy"></iframe>` : `<!-- Widget snippet will appear once your booking page is configured -->`;
  function copySnippet() {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2e3);
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Embed widget"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Embed booking widget"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Paste a snippet on your marketing site. Bookings flow into your inspections list."
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Widget style"
      }), /* @__PURE__ */ jsx("div", {
        className: "flex gap-2",
        children: STYLES.map((s) => /* @__PURE__ */ jsx("button", {
          onClick: () => setStyle(s.id),
          className: `h-9 px-4 rounded-md border-2 text-[13px] font-bold transition-colors ${style === s.id ? "border-ih-primary text-ih-primary bg-ih-primary-tint" : "border-ih-border text-ih-fg-2 hover:border-ih-border"}`,
          children: s.label
        }, s.id))
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
          children: "Embed code"
        }), /* @__PURE__ */ jsx("button", {
          onClick: copySnippet,
          className: "h-8 px-3 rounded-md bg-ih-primary text-white font-bold text-[12px] hover:bg-ih-primary-600 transition-colors",
          children: copied ? "Copied!" : "Copy snippet"
        })]
      }), /* @__PURE__ */ jsx("pre", {
        className: "bg-slate-900 text-emerald-300 dark:bg-slate-950 p-4 rounded-md overflow-x-auto text-[12px] font-mono leading-relaxed whitespace-pre-wrap break-all",
        children: snippet
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 space-y-3",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[13px] font-bold uppercase tracking-[0.15em] text-ih-fg-3",
        children: "Live preview"
      }), config.previewUrl ? /* @__PURE__ */ jsx("iframe", {
        src: `${config.previewUrl}?style=${style}`,
        className: "w-full min-h-[700px] rounded-md border border-ih-border",
        loading: "lazy",
        title: "Widget preview"
      }) : /* @__PURE__ */ jsx("div", {
        className: "w-full min-h-[300px] rounded-md border-2 border-dashed border-ih-border flex items-center justify-center",
        children: /* @__PURE__ */ jsxs("div", {
          className: "text-center",
          children: [/* @__PURE__ */ jsx(WidgetIcon, {}), /* @__PURE__ */ jsx("p", {
            className: "text-[13px] text-ih-fg-3 mt-2",
            children: "Preview will appear once your booking page is set up."
          })]
        })
      })]
    })]
  });
});
function WidgetIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-8 h-8 mx-auto text-ih-fg-4",
    fill: "none",
    stroke: "currentColor",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeWidth: 1.5,
      d: "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
    })
  });
}
const route53 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsWidget,
  loader: loader$k,
  meta: meta$g
}, Symbol.toStringTag, { value: "Module" }));
async function loader$j({
  request
}) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/auth/me", {
    token
  });
  const body = res.ok ? await res.json() : {};
  return {
    account: body.data ?? {}
  };
}
async function action$5({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "export-data") {
    const res = await apiFetch("/api/account/export", {
      token,
      method: "POST"
    });
    if (!res.ok) {
      return {
        success: false,
        error: "Data export failed. Please try again."
      };
    }
    return {
      success: true,
      error: null,
      message: "Data export initiated. You will receive a download link via email."
    };
  }
  if (intent === "delete-account") {
    const password = fd.get("password");
    if (!password) {
      return {
        success: false,
        error: "Password is required to delete your account."
      };
    }
    const res = await apiFetch("/api/account/delete", {
      token,
      method: "POST",
      body: JSON.stringify({
        password
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err == null ? void 0 : err.message) || "Account deletion failed."
      };
    }
    return {
      success: true,
      error: null,
      message: "Account deleted."
    };
  }
  return {
    success: false,
    error: "Unknown action"
  };
}
const settingsAccount = UNSAFE_withComponentProps(function SettingsAccountPage() {
  const {
    account
  } = useLoaderData();
  const actionData = useActionData();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px] max-w-3xl",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Account"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Account"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Account information, data export, and account deletion."
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: actionData.message || "Done."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Account details"
      }), /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1",
            children: "Email"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[13px] text-ih-fg-1 font-medium",
            children: account.email || "Not set"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4 mb-1",
            children: "Name"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[13px] text-ih-fg-1 font-medium",
            children: account.name || "Not set"
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Data export"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3",
        children: "Download a copy of all your data including inspections, reports, templates, and client information."
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "export-data"
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors",
          children: "Download my data"
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-bad p-6 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-bad-fg uppercase tracking-[0.2em]",
        children: "Danger zone"
      }), /* @__PURE__ */ jsxs("div", {
        className: "p-4 rounded-md bg-ih-bad-bg border border-ih-bad",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[13px] font-bold text-ih-bad-fg mb-1",
          children: "Delete account"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-bad-fg leading-relaxed",
          children: "Permanently delete your account and all associated data including inspections, reports, templates, and client records. This action cannot be undone."
        })]
      }), !showDeleteConfirm ? /* @__PURE__ */ jsx("button", {
        type: "button",
        onClick: () => setShowDeleteConfirm(true),
        className: "h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors",
        children: "Delete my account"
      }) : /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-3 max-w-sm",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "delete-account"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "deletePassword",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Enter your password to confirm"
          }), /* @__PURE__ */ jsx("input", {
            type: "password",
            id: "deletePassword",
            name: "password",
            required: true,
            autoComplete: "current-password",
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-bad focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex gap-2",
          children: [/* @__PURE__ */ jsx("button", {
            type: "button",
            onClick: () => setShowDeleteConfirm(false),
            className: "h-9 px-3 rounded-md border border-ih-border text-[13px] font-medium text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
            children: "Cancel"
          }), /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-rose-600 text-white font-bold text-[13px] hover:bg-ih-bad-fg active:scale-[.98] transition-all",
            children: "Permanently delete"
          })]
        })]
      })]
    })]
  });
});
const route54 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$5,
  default: settingsAccount,
  loader: loader$j
}, Symbol.toStringTag, { value: "Module" }));
async function loader$i({
  request
}) {
  const token = await requireToken(request);
  const [stripeRes, aiRes, secretsRes] = await Promise.all([apiFetch("/api/admin/payments/status", {
    token
  }).catch(() => null), apiFetch("/api/admin/ai/status", {
    token
  }).catch(() => null), apiFetch("/api/admin/secrets", {
    token
  }).catch(() => null)]);
  let stripeConnected = false;
  let stripeAccountId = null;
  if (stripeRes == null ? void 0 : stripeRes.ok) {
    const body = await stripeRes.json();
    const data = body.data ?? {};
    stripeConnected = Boolean(data == null ? void 0 : data.connected);
    stripeAccountId = (data == null ? void 0 : data.accountId) || null;
  }
  let geminiConfigured = false;
  if (aiRes == null ? void 0 : aiRes.ok) {
    const body = await aiRes.json();
    const data = body.data ?? {};
    geminiConfigured = Boolean(data == null ? void 0 : data.configured);
  }
  const secretsBody = (secretsRes == null ? void 0 : secretsRes.ok) ? await secretsRes.json() : {};
  const secrets = secretsBody.data ?? {};
  return {
    config: {
      stripeConnected,
      stripeAccountId,
      geminiConfigured
    },
    secrets: {
      GEMINI_API_KEY: secrets.GEMINI_API_KEY || "",
      GOOGLE_PLACES_API_KEY: secrets.GOOGLE_PLACES_API_KEY || "",
      ESTATED_API_KEY: secrets.ESTATED_API_KEY || "",
      APP_BASE_URL: secrets.APP_BASE_URL || ""
    }
  };
}
async function action$4({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "connect-stripe") {
    const accountId = fd.get("stripeAccountId");
    if (!accountId || typeof accountId !== "string" || !accountId.startsWith("acct_")) {
      return {
        success: false,
        error: "Please enter a valid Stripe account ID (starts with acct_)."
      };
    }
    const res = await apiFetch("/api/admin/payments/connect", {
      token,
      method: "POST",
      body: JSON.stringify({
        accountId
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err == null ? void 0 : err.message) || "Failed to connect Stripe account."
      };
    }
    return {
      success: true,
      error: null
    };
  }
  if (intent === "disconnect-stripe") {
    const res = await apiFetch("/api/admin/payments/disconnect", {
      token,
      method: "POST"
    });
    if (!res.ok) {
      return {
        success: false,
        error: "Failed to disconnect Stripe account."
      };
    }
    return {
      success: true,
      error: null
    };
  }
  if (intent === "save-ai") {
    const geminiApiKey = fd.get("GEMINI_API_KEY");
    if (!geminiApiKey || typeof geminiApiKey !== "string" || !geminiApiKey.trim()) {
      return {
        success: false,
        error: "API key is required."
      };
    }
    const res = await apiFetch("/api/admin/secrets", {
      token,
      method: "PUT",
      body: JSON.stringify({
        GEMINI_API_KEY: geminiApiKey
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err == null ? void 0 : err.message) || "Failed to save AI configuration."
      };
    }
    return {
      success: true,
      error: null
    };
  }
  if (intent === "save-advanced-secrets") {
    const body = {};
    for (const key of ["GOOGLE_PLACES_API_KEY", "ESTATED_API_KEY", "APP_BASE_URL"]) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return {
          success: false,
          error: "Failed to save integration keys."
        };
      }
    }
    return {
      success: true,
      error: null
    };
  }
  return {
    success: false,
    error: "Unknown action"
  };
}
const settingsAdvanced = UNSAFE_withComponentProps(function SettingsAdvancedPage() {
  const {
    config,
    secrets
  } = useLoaderData();
  const actionData = useActionData();
  const [stripeInput, setStripeInput] = useState("");
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px] max-w-3xl",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Advanced"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Advanced"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Stripe payments, AI features, and integrations."
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "Settings saved."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between gap-4",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "Payments (Stripe Connect)"
        }), /* @__PURE__ */ jsx("span", {
          className: `text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${config.stripeConnected ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
          children: config.stripeConnected ? "Connected" : "Not connected"
        })]
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Accept card payments on invoices via your Stripe Express account. Create your account at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://dashboard.stripe.com/connect/express",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "dashboard.stripe.com/connect/express"
        }), ", then paste the account ID below."]
      }), config.stripeConnected ? /* @__PURE__ */ jsxs("div", {
        className: "space-y-3",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "text-[13px] text-ih-fg-2",
          children: ["Connected account:", " ", /* @__PURE__ */ jsx("code", {
            className: "font-mono text-[12px] px-2 py-1 rounded bg-ih-bg-muted text-ih-fg-1",
            children: config.stripeAccountId
          })]
        }), /* @__PURE__ */ jsxs(Form, {
          method: "post",
          children: [/* @__PURE__ */ jsx("input", {
            type: "hidden",
            name: "intent",
            value: "disconnect-stripe"
          }), /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-colors",
            children: "Disconnect"
          })]
        })]
      }) : /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-3 max-w-md",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "connect-stripe"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "stripeAccountId",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Stripe account ID"
          }), /* @__PURE__ */ jsx("input", {
            type: "text",
            id: "stripeAccountId",
            name: "stripeAccountId",
            value: stripeInput,
            onChange: (e) => setStripeInput(e.target.value),
            placeholder: "acct_1AbCdEfGhIjKlMnO",
            autoComplete: "off",
            autoCorrect: "off",
            autoCapitalize: "off",
            spellCheck: false,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none transition-all font-mono text-[13px] placeholder:text-slate-300 dark:placeholder:text-slate-500 text-ih-fg-1"
          })]
        }), /* @__PURE__ */ jsx("button", {
          type: "submit",
          className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
          children: "Connect Account"
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center justify-between gap-4",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
          children: "AI features"
        }), /* @__PURE__ */ jsx("span", {
          className: `text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full ${config.geminiConfigured ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
          children: config.geminiConfigured ? "Configured" : "Not configured"
        })]
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Google Gemini powers comment assist and inspection summaries. Get a key at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://aistudio.google.com",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "aistudio.google.com"
        }), "."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-3 max-w-xl",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-ai"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "GEMINI_API_KEY",
          label: "Gemini API Key",
          value: secrets.GEMINI_API_KEY,
          hint: "Powers AI comment suggestions and smart field completion. Get at aistudio.google.com/apikey"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Save"
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Integration API keys"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3",
        children: "These integrations enhance the inspection workflow. All are optional — features degrade gracefully when unconfigured."
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4 max-w-xl",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-advanced-secrets"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "GOOGLE_PLACES_API_KEY",
          label: "Google Places API key",
          value: secrets.GOOGLE_PLACES_API_KEY,
          hint: "Address autocomplete on booking and new inspection forms. Create at console.cloud.google.com → Places API"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "ESTATED_API_KEY",
          label: "Estated API key",
          value: secrets.ESTATED_API_KEY,
          hint: "Auto-fills Property Facts (year built, sqft, bedrooms). Get at estated.com → API"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "APP_BASE_URL",
          label: "Application base URL",
          value: secrets.APP_BASE_URL,
          type: "text",
          hint: "Public URL of your deployment (e.g. https://app.yourdomain.com). Used in email links"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Save"
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Data management"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3",
        children: "Import data from another inspection platform or export your data for backup."
      }), /* @__PURE__ */ jsx("div", {
        className: "flex flex-wrap gap-3",
        children: /* @__PURE__ */ jsx(Link, {
          to: "/settings/data",
          className: "h-9 px-4 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-colors inline-flex items-center",
          children: "Import / Export data"
        })
      })]
    })]
  });
});
const route55 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$4,
  default: settingsAdvanced,
  loader: loader$i
}, Symbol.toStringTag, { value: "Module" }));
function meta$f() {
  return [{
    title: "Integrations - Settings - OpenInspection"
  }];
}
async function loader$h({
  request
}) {
  const token = await requireToken(request);
  const secretsRes = await apiFetch("/api/admin/secrets", {
    token
  }).catch(() => null);
  const secretsBody = (secretsRes == null ? void 0 : secretsRes.ok) ? await secretsRes.json() : {};
  const secrets = secretsBody.data ?? {};
  return {
    secrets: {
      STRIPE_SECRET_KEY: secrets.STRIPE_SECRET_KEY || "",
      STRIPE_WEBHOOK_SECRET: secrets.STRIPE_WEBHOOK_SECRET || ""
    }
  };
}
async function action$3({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "save-stripe-secrets") {
    const body = {};
    for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return {
          success: false,
          error: "Failed to save Stripe keys."
        };
      }
    }
    return {
      success: true,
      error: null
    };
  }
  return {
    success: false,
    error: "Unknown action"
  };
}
const INTEGRATIONS = [{
  id: "qbo",
  name: "QuickBooks Online",
  description: "Sync invoices, contacts, and payment status in real time.",
  status: "available",
  href: "/settings/integrations/qbo",
  color: "#2CA01C"
}, {
  id: "gcal",
  name: "Google Calendar",
  description: "Two-way sync for inspection scheduling and availability.",
  status: "available",
  color: "#4285F4"
}, {
  id: "google-places",
  name: "Google Places",
  description: "Address autocomplete and property data enrichment.",
  status: "available",
  color: "#34A853"
}, {
  id: "stripe",
  name: "Stripe",
  description: "Accept online payments and manage billing.",
  status: "available",
  color: "#635BFF"
}, {
  id: "resend",
  name: "Resend",
  description: "Transactional email delivery for reports and notifications.",
  status: "connected",
  color: "#000000"
}, {
  id: "zapier",
  name: "Zapier",
  description: "Connect to 5,000+ apps with no-code workflows.",
  status: "available",
  color: "#FF4A00"
}, {
  id: "gemini",
  name: "Gemini AI",
  description: "AI-powered inspection assistance and defect detection.",
  status: "available",
  color: "#8E75B2"
}];
const STATUS_STYLES = {
  connected: "bg-emerald-50 dark:bg-emerald-900/30 text-ih-ok-fg",
  available: "bg-ih-bg-muted text-ih-fg-3"
};
const settingsIntegrations = UNSAFE_withComponentProps(function SettingsIntegrations() {
  const {
    secrets
  } = useLoaderData();
  const actionData = useActionData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Integrations"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      children: [/* @__PURE__ */ jsx("h2", {
        className: "text-[19px] font-bold text-ih-fg-1",
        children: "Integrations"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mt-1",
        children: "Connect OpenInspection to your other business tools."
      })]
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "Settings saved."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold",
          style: {
            backgroundColor: "#635BFF"
          },
          children: "ST"
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("h3", {
            className: "text-[13px] font-bold text-ih-fg-1",
            children: "Stripe API keys"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-3",
            children: "Required for payment processing. Get keys at dashboard.stripe.com/apikeys."
          })]
        })]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4 max-w-xl",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-stripe-secrets"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "STRIPE_SECRET_KEY",
          label: "Stripe Secret Key",
          value: secrets.STRIPE_SECRET_KEY,
          hint: "Enables online payment for inspections. Get at dashboard.stripe.com → Developers → API Keys"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "STRIPE_WEBHOOK_SECRET",
          label: "Stripe Webhook Secret",
          value: secrets.STRIPE_WEBHOOK_SECRET,
          hint: "Verifies payment event notifications. Found at dashboard.stripe.com → Developers → Webhooks → Signing secret"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Save Stripe keys"
          })
        })]
      })]
    }), /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",
      children: INTEGRATIONS.map((i) => /* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card border border-ih-border rounded-lg p-5 flex flex-col gap-3",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-start justify-between gap-2",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2.5",
            children: [/* @__PURE__ */ jsx("div", {
              className: "w-8 h-8 rounded-md flex items-center justify-center text-white text-[10px] font-extrabold",
              style: {
                backgroundColor: i.color
              },
              children: i.name.slice(0, 2).toUpperCase()
            }), /* @__PURE__ */ jsx("h3", {
              className: "text-[13px] font-bold text-ih-fg-1",
              children: i.name
            })]
          }), /* @__PURE__ */ jsx("span", {
            className: `flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${STATUS_STYLES[i.status]}`,
            children: i.status === "connected" ? "Connected" : "Available"
          })]
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 leading-relaxed flex-1",
          children: i.description
        }), i.href ? /* @__PURE__ */ jsx(Link, {
          to: i.href,
          className: "self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors inline-flex items-center",
          children: i.status === "connected" ? "Configure" : "Connect"
        }) : /* @__PURE__ */ jsx("button", {
          disabled: true,
          className: "self-start px-3 h-7 rounded-md border border-ih-border bg-ih-bg-card text-[12px] font-bold text-ih-fg-2 opacity-50 cursor-not-allowed inline-flex items-center",
          children: i.status === "connected" ? "Configure" : "Connect"
        })]
      }, i.id))
    })]
  });
});
const route56 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$3,
  default: settingsIntegrations,
  loader: loader$h,
  meta: meta$f
}, Symbol.toStringTag, { value: "Module" }));
function meta$e() {
  return [{
    title: "QuickBooks Integration - OpenInspection"
  }];
}
async function loader$g({
  request
}) {
  const token = await requireToken(request);
  const [qboRes, secretsRes] = await Promise.all([apiFetch("/api/qbo/status", {
    token
  }).catch(() => null), apiFetch("/api/admin/secrets", {
    token
  }).catch(() => null)]);
  let status = null;
  if (qboRes == null ? void 0 : qboRes.ok) {
    const body = await qboRes.json();
    const d = body.data ?? {};
    status = Object.keys(d).length > 0 ? d : null;
  }
  const secretsBody = (secretsRes == null ? void 0 : secretsRes.ok) ? await secretsRes.json() : {};
  const secrets = secretsBody.data ?? {};
  return {
    status,
    secrets: {
      QBO_CLIENT_ID: secrets.QBO_CLIENT_ID || "",
      QBO_CLIENT_SECRET: secrets.QBO_CLIENT_SECRET || "",
      QBO_WEBHOOK_SECRET: secrets.QBO_WEBHOOK_SECRET || ""
    }
  };
}
async function action$2({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "save-qbo-secrets") {
    const body = {};
    for (const key of ["QBO_CLIENT_ID", "QBO_CLIENT_SECRET", "QBO_WEBHOOK_SECRET"]) {
      const val = fd.get(key);
      if (val && typeof val === "string" && val.trim()) body[key] = val;
    }
    if (Object.keys(body).length > 0) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        return {
          success: false,
          error: "Failed to save QBO keys."
        };
      }
    }
    return {
      success: true,
      error: null
    };
  }
  return {
    success: false,
    error: "Unknown action"
  };
}
function timeSince(ts) {
  if (!ts) return "Never";
  const diff = Math.floor(Date.now() / 1e3) - ts;
  if (diff < 60) return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  return `${Math.floor(diff / 3600)} hours ago`;
}
const settingsIntegrationsQbo = UNSAFE_withComponentProps(function SettingsIntegrationsQbo() {
  const {
    status: initial,
    secrets
  } = useLoaderData();
  const actionData = useActionData();
  const [status, setStatus] = useState(initial);
  const [syncing, setSyncing] = useState(false);
  const connected = status == null ? void 0 : status.connected;
  const expiryWarning = (status == null ? void 0 : status.refreshTokenExpiresAt) && status.refreshTokenExpiresAt < Math.floor(Date.now() / 1e3) + 30 * 24 * 3600;
  async function triggerSync() {
    setSyncing(true);
    await fetch("/api/qbo/sync", {
      method: "POST",
      credentials: "same-origin"
    });
    setSyncing(false);
  }
  async function togglePause() {
    const res = await fetch("/api/qbo/pause", {
      method: "POST",
      credentials: "same-origin"
    });
    if (res.ok) {
      const json = await res.json();
      setStatus((s) => s ? {
        ...s,
        syncEnabled: json.syncEnabled
      } : s);
    }
  }
  async function disconnect() {
    await fetch("/api/qbo/disconnect", {
      method: "POST",
      credentials: "same-origin"
    });
    setStatus(null);
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx(Link, {
        to: "/settings/integrations",
        className: "hover:text-ih-primary transition-colors",
        children: "Integrations"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "QuickBooks Online"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "QuickBooks Online"
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "QBO credentials saved."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "API credentials"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["OAuth credentials from your QuickBooks Developer app. Required before connecting. Get them at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://developer.intuit.com/app/developer/appdetail",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "developer.intuit.com"
        }), "."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4 max-w-xl",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-qbo-secrets"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "QBO_CLIENT_ID",
          label: "QBO Client ID",
          value: secrets.QBO_CLIENT_ID,
          hint: "QuickBooks Online integration for invoice sync. Create at developer.intuit.com → My Apps"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "QBO_CLIENT_SECRET",
          label: "QBO Client Secret",
          value: secrets.QBO_CLIENT_SECRET,
          hint: "Paired with Client ID. Found in the same Intuit app settings"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "QBO_WEBHOOK_SECRET",
          label: "QBO Webhook Verifier Token",
          value: secrets.QBO_WEBHOOK_SECRET,
          hint: "Verifies QuickBooks data change notifications. Found at developer.intuit.com → Webhooks"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Save credentials"
          })
        })]
      })]
    }), connected && expiryWarning && /* @__PURE__ */ jsxs("div", {
      className: "flex items-start gap-3 p-4 bg-ih-watch-bg border border-ih-watch-fg/20 rounded-lg text-ih-watch-fg text-[13px]",
      children: [/* @__PURE__ */ jsx("svg", {
        className: "w-5 h-5 flex-shrink-0 mt-0.5",
        fill: "none",
        viewBox: "0 0 24 24",
        stroke: "currentColor",
        children: /* @__PURE__ */ jsx("path", {
          strokeLinecap: "round",
          strokeLinejoin: "round",
          strokeWidth: 2,
          d: "M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        })
      }), /* @__PURE__ */ jsxs("span", {
        children: ["Your QuickBooks connection expires soon.", " ", /* @__PURE__ */ jsx("a", {
          href: "/api/qbo/connect",
          className: "underline font-semibold",
          children: "Reconnect to avoid interruption."
        })]
      })]
    }), !connected && /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-8 text-center",
      children: [/* @__PURE__ */ jsx("div", {
        className: "w-16 h-16 bg-[#2CA01C]/10 rounded-2xl flex items-center justify-center mx-auto mb-4",
        children: /* @__PURE__ */ jsx("span", {
          className: "text-[#2CA01C] text-2xl font-extrabold",
          children: "QB"
        })
      }), /* @__PURE__ */ jsx("h3", {
        className: "text-[16px] font-bold text-ih-fg-1 mb-2",
        children: "Connect QuickBooks Online"
      }), /* @__PURE__ */ jsxs("ul", {
        className: "text-[13px] text-ih-fg-3 text-left max-w-xs mx-auto mb-6 space-y-2",
        children: [/* @__PURE__ */ jsxs("li", {
          className: "flex items-start gap-2",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-emerald-500 mt-0.5",
            children: "✓"
          }), " Real-time invoice sync"]
        }), /* @__PURE__ */ jsxs("li", {
          className: "flex items-start gap-2",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-emerald-500 mt-0.5",
            children: "✓"
          }), " Automatic payment status updates"]
        }), /* @__PURE__ */ jsxs("li", {
          className: "flex items-start gap-2",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-emerald-500 mt-0.5",
            children: "✓"
          }), " Duplicate customer detection"]
        }), /* @__PURE__ */ jsxs("li", {
          className: "flex items-start gap-2",
          children: [/* @__PURE__ */ jsx("span", {
            className: "text-emerald-500 mt-0.5",
            children: "✓"
          }), " Invoice void and refund sync"]
        })]
      }), /* @__PURE__ */ jsx("a", {
        href: "/api/qbo/connect",
        className: "inline-flex items-center gap-2 px-6 py-3 bg-[#2CA01C] text-white rounded-lg font-bold text-[13px] hover:bg-[#237a16] transition-colors",
        children: "Connect QuickBooks"
      })]
    }), connected && /* @__PURE__ */ jsxs("div", {
      className: "space-y-4",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card border border-ih-border rounded-lg p-6",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-start justify-between mb-4",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("p", {
              className: "font-bold text-[14px] text-ih-fg-1",
              children: status.companyName ?? "Connected"
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-[12px] text-ih-fg-3 mt-0.5",
              children: ["Last synced: ", timeSince(status.lastSyncAt)]
            })]
          }), /* @__PURE__ */ jsxs("span", {
            className: `inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${status.syncEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
            children: [/* @__PURE__ */ jsx("span", {
              className: `w-1.5 h-1.5 rounded-full ${status.syncEnabled ? "bg-emerald-500" : "bg-slate-400"}`
            }), status.syncEnabled ? "Active" : "Paused"]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex gap-2 flex-wrap",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: triggerSync,
            disabled: syncing,
            className: "px-4 py-2 text-[12px] font-bold bg-ih-primary-tint text-ih-primary rounded-md hover:bg-ih-primary-tint transition-colors disabled:opacity-50",
            children: syncing ? "Syncing..." : "Sync Now"
          }), /* @__PURE__ */ jsx("button", {
            onClick: togglePause,
            className: "px-4 py-2 text-[12px] font-bold bg-ih-bg-muted text-ih-fg-2 rounded-md hover:bg-ih-bg-muted transition-colors",
            children: status.syncEnabled ? "Pause Sync" : "Resume Sync"
          }), /* @__PURE__ */ jsx("button", {
            onClick: disconnect,
            className: "px-4 py-2 text-[12px] font-bold text-ih-bad-fg hover:bg-ih-bad-bg rounded-md transition-colors",
            children: "Disconnect"
          })]
        })]
      }), (status.openErrors ?? 0) > 0 && /* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card border border-ih-bad rounded-lg p-6",
        children: [/* @__PURE__ */ jsxs("h3", {
          className: "font-bold text-[14px] text-ih-fg-1 mb-2 flex items-center gap-2",
          children: [/* @__PURE__ */ jsx("svg", {
            className: "w-4 h-4 text-ih-bad-fg",
            fill: "none",
            viewBox: "0 0 24 24",
            stroke: "currentColor",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            })
          }), "Sync Errors (", status.openErrors, ")"]
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3",
          children: "Check the sync error log for details. Errors will retry automatically on the next sync."
        })]
      })]
    })]
  });
});
const route57 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$2,
  default: settingsIntegrationsQbo,
  loader: loader$g,
  meta: meta$e
}, Symbol.toStringTag, { value: "Module" }));
function meta$d() {
  return [{
    title: "Event Types - OpenInspection"
  }];
}
async function loader$f({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/event-types", {
      token
    });
    if (!res.ok) return {
      types: []
    };
    const body = await res.json();
    return {
      types: body.data ?? []
    };
  } catch {
    return {
      types: []
    };
  }
}
const EMPTY_FORM$1 = {
  name: "",
  slug: "",
  defaultDurationMin: 30,
  priceDollars: 0,
  color: "#4a72ff",
  sortOrder: 0
};
const settingsEventTypes = UNSAFE_withComponentProps(function SettingsEventTypes() {
  const {
    types: initial
  } = useLoaderData();
  const [types, setTypes] = useState(initial);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM$1);
  const [saving, setSaving] = useState(false);
  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM$1);
    setModalOpen(true);
  }
  function openEdit(t) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      slug: t.slug,
      defaultDurationMin: t.defaultDurationMin ?? 30,
      priceDollars: (t.defaultPriceCents ?? 0) / 100,
      color: t.color ?? "#4a72ff",
      sortOrder: t.sortOrder ?? 0
    });
    setModalOpen(true);
  }
  async function save() {
    setSaving(true);
    const body = {
      name: form.name,
      slug: form.slug,
      defaultDurationMin: form.defaultDurationMin,
      defaultPriceCents: Math.round(form.priceDollars * 100),
      color: form.color,
      sortOrder: form.sortOrder
    };
    const method = editingId ? "PATCH" : "POST";
    const url = editingId ? `/api/admin/event-types/${editingId}` : "/api/admin/event-types";
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    if (res.ok) {
      const json = await res.json();
      if (editingId) {
        setTypes((prev) => prev.map((t) => t.id === editingId ? json.data ?? t : t));
      } else if (json.data) {
        setTypes((prev) => [...prev, json.data]);
      }
      setModalOpen(false);
    }
    setSaving(false);
  }
  async function confirmDelete(t) {
    const res = await fetch(`/api/admin/event-types/${t.id}`, {
      method: "DELETE",
      credentials: "same-origin"
    });
    if (res.ok) {
      setTypes((prev) => prev.filter((x) => x.id !== t.id));
    }
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Event types"
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-start justify-between gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-[19px] font-bold text-ih-fg-1",
          children: "Event types"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: "Define ancillary inspection events that can be attached to an inspection."
        })]
      }), /* @__PURE__ */ jsx("button", {
        onClick: openCreate,
        className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
        children: "+ Add type"
      })]
    }), types.length === 0 ? /* @__PURE__ */ jsxs("div", {
      className: "text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg",
      children: [/* @__PURE__ */ jsx("p", {
        className: "font-bold text-[14px] text-ih-fg-2",
        children: "No event types yet."
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[12px] text-ih-fg-3 mt-2",
        children: "Click “+ Add type” to define your first event type."
      })]
    }) : /* @__PURE__ */ jsx("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Slug"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Duration"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Price"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Color"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right",
              children: "Actions"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          className: "divide-y divide-ih-border",
          children: types.map((t) => /* @__PURE__ */ jsxs("tr", {
            className: "hover:bg-ih-bg-muted/50",
            children: [/* @__PURE__ */ jsx("td", {
              className: "px-4 py-3",
              children: /* @__PURE__ */ jsxs("div", {
                className: "flex items-center gap-2",
                children: [/* @__PURE__ */ jsx("span", {
                  className: "w-3 h-3 rounded-full flex-shrink-0",
                  style: {
                    backgroundColor: t.color ?? "#4a72ff"
                  }
                }), /* @__PURE__ */ jsx("span", {
                  className: "font-bold text-[13px] text-ih-fg-1",
                  children: t.name
                }), !t.active && /* @__PURE__ */ jsx("span", {
                  className: "text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ih-bg-muted text-ih-fg-3",
                  children: "Inactive"
                })]
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 font-mono text-[12px] text-ih-fg-3",
              children: t.slug
            }), /* @__PURE__ */ jsxs("td", {
              className: "px-4 py-3 text-[13px] text-ih-fg-2",
              children: [t.defaultDurationMin ?? 0, " min"]
            }), /* @__PURE__ */ jsxs("td", {
              className: "px-4 py-3 text-[13px] text-ih-fg-2",
              children: ["$", ((t.defaultPriceCents ?? 0) / 100).toFixed(2)]
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 font-mono text-[11px] text-ih-fg-3",
              children: t.color
            }), /* @__PURE__ */ jsxs("td", {
              className: "px-4 py-3 text-right",
              children: [/* @__PURE__ */ jsx("button", {
                onClick: () => openEdit(t),
                className: "text-[12px] text-ih-primary hover:underline mr-3 font-bold",
                children: "Edit"
              }), /* @__PURE__ */ jsx("button", {
                onClick: () => confirmDelete(t),
                className: "text-[12px] text-ih-bad-fg hover:underline font-bold",
                children: "Delete"
              })]
            })]
          }, t.id))
        })]
      })
    }), modalOpen && /* @__PURE__ */ jsxs("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center",
      children: [/* @__PURE__ */ jsx("div", {
        className: "absolute inset-0 bg-black/40",
        onClick: () => setModalOpen(false)
      }), /* @__PURE__ */ jsxs("div", {
        className: "relative bg-ih-bg-card border border-ih-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[16px] font-bold text-ih-fg-1",
          children: editingId ? "Edit event type" : "New event type"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-3",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
              children: "Name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              value: form.name,
              onChange: (e) => setForm((f) => ({
                ...f,
                name: e.target.value
              })),
              placeholder: "e.g., Radon Test - Pickup",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
              children: "Slug"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              value: form.slug,
              onChange: (e) => setForm((f) => ({
                ...f,
                slug: e.target.value
              })),
              placeholder: "radon_pickup",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "grid grid-cols-2 gap-3",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
                children: "Duration (min)"
              }), /* @__PURE__ */ jsx("input", {
                type: "number",
                value: form.defaultDurationMin,
                onChange: (e) => setForm((f) => ({
                  ...f,
                  defaultDurationMin: Number(e.target.value)
                })),
                min: 1,
                className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
                children: "Price ($)"
              }), /* @__PURE__ */ jsx("input", {
                type: "number",
                value: form.priceDollars,
                onChange: (e) => setForm((f) => ({
                  ...f,
                  priceDollars: Number(e.target.value)
                })),
                min: 0,
                step: 0.01,
                className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              })]
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "grid grid-cols-2 gap-3",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
                children: "Color"
              }), /* @__PURE__ */ jsxs("div", {
                className: "flex items-center gap-2",
                children: [/* @__PURE__ */ jsx("input", {
                  type: "color",
                  value: form.color,
                  onChange: (e) => setForm((f) => ({
                    ...f,
                    color: e.target.value
                  })),
                  className: "w-10 h-10 rounded-md border border-ih-border cursor-pointer"
                }), /* @__PURE__ */ jsx("input", {
                  type: "text",
                  value: form.color,
                  onChange: (e) => setForm((f) => ({
                    ...f,
                    color: e.target.value
                  })),
                  className: "flex-1 px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 font-mono focus:border-ih-primary focus:shadow-ih-focus outline-none"
                })]
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
                children: "Sort order"
              }), /* @__PURE__ */ jsx("input", {
                type: "number",
                value: form.sortOrder,
                onChange: (e) => setForm((f) => ({
                  ...f,
                  sortOrder: Number(e.target.value)
                })),
                min: 0,
                className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
              })]
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2 pt-2",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setModalOpen(false),
            className: "px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
            children: "Cancel"
          }), /* @__PURE__ */ jsx("button", {
            onClick: save,
            disabled: saving,
            className: "px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50",
            children: saving ? "Saving..." : "Save"
          })]
        })]
      })]
    })]
  });
});
const route58 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsEventTypes,
  loader: loader$f,
  meta: meta$d
}, Symbol.toStringTag, { value: "Module" }));
const PLATFORM_SUBTYPES = [{
  slug: "office",
  name: "Office",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}, {
  slug: "retail",
  name: "Retail",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}, {
  slug: "hospitality",
  name: "Hospitality",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}, {
  slug: "industrial",
  name: "Industrial",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}, {
  slug: "institutional",
  name: "Institutional",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}, {
  slug: "mixed-use",
  name: "Mixed-Use",
  enabled: true,
  templateCount: 0,
  inspectionCount: 0
}];
const EMPTY_FORM = {
  name: "",
  basedOn: "",
  description: ""
};
const settingsInspectionTypes = UNSAFE_withComponentProps(function SettingsInspectionTypes() {
  const [platformSubtypes] = useState(PLATFORM_SUBTYPES);
  const [orgSubtypes, setOrgSubtypes] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }
  function openEdit(ot) {
    setEditingId(ot.id);
    setForm({
      name: ot.name,
      basedOn: ot.basedOn,
      description: ot.description
    });
    setModalOpen(true);
  }
  async function save() {
    setSaving(true);
    const newSubtype = {
      id: editingId ?? crypto.randomUUID(),
      name: form.name,
      basedOn: form.basedOn,
      description: form.description,
      enabled: true,
      templateCount: 0,
      inspectionCount: 0
    };
    if (editingId) {
      setOrgSubtypes((prev) => prev.map((o) => o.id === editingId ? newSubtype : o));
    } else {
      setOrgSubtypes((prev) => [...prev, newSubtype]);
    }
    setModalOpen(false);
    setSaving(false);
  }
  function toggleOrg(ot) {
    setOrgSubtypes((prev) => prev.map((o) => o.id === ot.id ? {
      ...o,
      enabled: !o.enabled
    } : o));
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Inspection types"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Inspection types"
    }), /* @__PURE__ */ jsxs("section", {
      className: "space-y-3",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
          children: "Platform"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-0.5",
          children: "Standard types that ship with the platform."
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3",
        children: platformSubtypes.map((pt) => /* @__PURE__ */ jsx("div", {
          className: "p-4 bg-ih-bg-card border border-ih-border rounded-lg",
          children: /* @__PURE__ */ jsxs("div", {
            className: "flex items-start justify-between gap-3",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex-1 min-w-0",
              children: [/* @__PURE__ */ jsx("p", {
                className: "font-bold text-[13px] text-ih-fg-1",
                children: pt.name
              }), /* @__PURE__ */ jsxs("p", {
                className: "text-[11px] text-ih-fg-3 mt-1",
                children: [pt.templateCount, " templates · ", pt.inspectionCount, " ", "inspections"]
              })]
            }), /* @__PURE__ */ jsx("span", {
              className: `text-[11px] font-bold px-2.5 py-1 rounded-md border ${pt.enabled ? "border-ih-ok-fg/20 bg-emerald-50 dark:bg-emerald-900/30 text-ih-ok-fg" : "border-ih-border bg-ih-bg-muted text-ih-fg-3"}`,
              children: pt.enabled ? "Enabled" : "Disabled"
            })]
          })
        }, pt.slug))
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "space-y-3",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-end justify-between gap-3",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
            children: "Your organization"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-3 mt-0.5",
            children: "Custom types based on platform types."
          })]
        }), /* @__PURE__ */ jsx("button", {
          onClick: openAdd,
          className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
          children: "+ Add custom subtype"
        })]
      }), orgSubtypes.length === 0 ? /* @__PURE__ */ jsx("div", {
        className: "text-center py-10 bg-ih-bg-card border border-ih-border rounded-lg",
        children: /* @__PURE__ */ jsx("p", {
          className: "font-bold text-[14px] text-ih-fg-3",
          children: "No custom subtypes yet."
        })
      }) : /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3",
        children: orgSubtypes.map((ot) => /* @__PURE__ */ jsx("div", {
          className: "p-4 bg-ih-bg-card border border-ih-border rounded-lg",
          children: /* @__PURE__ */ jsxs("div", {
            className: "flex items-start justify-between gap-3",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "flex-1 min-w-0",
              children: [/* @__PURE__ */ jsx("p", {
                className: "font-bold text-[13px] text-ih-fg-1",
                children: ot.name
              }), /* @__PURE__ */ jsxs("p", {
                className: "text-[11px] text-ih-fg-3 mt-1",
                children: [ot.templateCount, " templates ·", " ", ot.inspectionCount, " inspections"]
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "flex flex-col gap-1",
              children: [/* @__PURE__ */ jsx("button", {
                onClick: () => openEdit(ot),
                className: "text-[12px] text-ih-primary hover:underline font-bold",
                children: "Edit"
              }), /* @__PURE__ */ jsx("button", {
                onClick: () => toggleOrg(ot),
                className: `text-[12px] font-bold hover:underline ${ot.enabled ? "text-ih-fg-3" : "text-ih-ok-fg"}`,
                children: ot.enabled ? "Disable" : "Enable"
              })]
            })]
          })
        }, ot.id))
      })]
    }), modalOpen && /* @__PURE__ */ jsxs("div", {
      className: "fixed inset-0 z-50 flex items-center justify-center",
      children: [/* @__PURE__ */ jsx("div", {
        className: "absolute inset-0 bg-black/40",
        onClick: () => setModalOpen(false)
      }), /* @__PURE__ */ jsxs("div", {
        className: "relative bg-ih-bg-card border border-ih-border rounded-lg shadow-xl w-full max-w-md mx-4 p-6 space-y-4",
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[16px] font-bold text-ih-fg-1",
          children: editingId ? "Edit custom subtype" : "Add custom subtype"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-3",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
              children: "Name"
            }), /* @__PURE__ */ jsx("input", {
              type: "text",
              value: form.name,
              onChange: (e) => setForm((f) => ({
                ...f,
                name: e.target.value
              })),
              placeholder: "e.g., Medical Office",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
              children: "Based on"
            }), /* @__PURE__ */ jsxs("select", {
              value: form.basedOn,
              onChange: (e) => setForm((f) => ({
                ...f,
                basedOn: e.target.value
              })),
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none",
              children: [/* @__PURE__ */ jsx("option", {
                value: "",
                children: "Select a platform type..."
              }), platformSubtypes.map((pt) => /* @__PURE__ */ jsx("option", {
                value: pt.slug,
                children: pt.name
              }, pt.slug))]
            })]
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("label", {
              className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
              children: "Description"
            }), /* @__PURE__ */ jsx("textarea", {
              value: form.description,
              onChange: (e) => setForm((f) => ({
                ...f,
                description: e.target.value
              })),
              rows: 2,
              placeholder: "Optional details...",
              className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex justify-end gap-2 pt-2",
          children: [/* @__PURE__ */ jsx("button", {
            onClick: () => setModalOpen(false),
            className: "px-4 py-2 rounded-md border border-ih-border text-[13px] font-bold text-ih-fg-2 hover:bg-ih-bg-muted transition-colors",
            children: "Cancel"
          }), /* @__PURE__ */ jsx("button", {
            onClick: save,
            disabled: saving,
            className: "px-4 py-2 rounded-md bg-ih-primary text-white text-[13px] font-bold hover:bg-ih-primary-600 transition-colors disabled:opacity-50",
            children: saving ? "Saving..." : "Save"
          })]
        })]
      })]
    })]
  });
});
const route59 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsInspectionTypes
}, Symbol.toStringTag, { value: "Module" }));
function meta$c() {
  return [{
    title: "Booking Settings - OpenInspection"
  }];
}
async function loader$e({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/booking-config", {
      token
    });
    if (!res.ok) return {
      config: {
        enabled: false,
        conciergeReviewRequired: false,
        defaultDurationMin: 60,
        availabilityStart: "08:00",
        availabilityEnd: "17:00"
      }
    };
    const body = await res.json();
    const d = body.data ?? {};
    return {
      config: Object.keys(d).length > 0 ? d : null
    };
  } catch {
    return {
      config: {
        enabled: false,
        conciergeReviewRequired: false,
        defaultDurationMin: 60,
        availabilityStart: "08:00",
        availabilityEnd: "17:00"
      }
    };
  }
}
const settingsCatalogBooking = UNSAFE_withComponentProps(function SettingsCatalogBooking() {
  const {
    config: initial
  } = useLoaderData();
  const cfg = initial;
  const [enabled, setEnabled] = useState((cfg == null ? void 0 : cfg.enabled) ?? false);
  const [reviewRequired, setReviewRequired] = useState((cfg == null ? void 0 : cfg.conciergeReviewRequired) ?? false);
  const [duration, setDuration] = useState((cfg == null ? void 0 : cfg.defaultDurationMin) ?? 60);
  const [startTime, setStartTime] = useState((cfg == null ? void 0 : cfg.availabilityStart) ?? "08:00");
  const [endTime, setEndTime] = useState((cfg == null ? void 0 : cfg.availabilityEnd) ?? "17:00");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const embedCode = `<iframe src="${typeof window !== "undefined" ? window.location.origin : ""}/book/YOUR_TENANT/default" width="100%" height="600" frameborder="0"></iframe>`;
  async function handleSave() {
    setSaving(true);
    setSaved(false);
    await fetch("/api/admin/booking-config", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      credentials: "same-origin",
      body: JSON.stringify({
        enabled,
        conciergeReviewRequired: reviewRequired,
        defaultDurationMin: duration,
        availabilityStart: startTime,
        availabilityEnd: endTime
      })
    });
    setSaving(false);
    setSaved(true);
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Booking"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Booking"
    }), /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-5",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[15px] font-bold text-ih-fg-1",
          children: "Public booking page"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Allow clients to book inspections through your public booking page."
        })]
      }), /* @__PURE__ */ jsxs("label", {
        className: "flex items-start gap-3 cursor-pointer select-none",
        children: [/* @__PURE__ */ jsx("input", {
          type: "checkbox",
          checked: enabled,
          onChange: (e) => setEnabled(e.target.checked),
          className: "mt-1 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-indigo-500"
        }), /* @__PURE__ */ jsxs("span", {
          children: [/* @__PURE__ */ jsx("span", {
            className: "block text-[13px] font-bold text-ih-fg-1",
            children: "Enable public booking"
          }), /* @__PURE__ */ jsx("span", {
            className: "block text-[12px] text-ih-fg-3 mt-0.5",
            children: "When enabled, clients can self-schedule through your booking link."
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-5",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h3", {
          className: "text-[15px] font-bold text-ih-fg-1",
          children: "Concierge bookings"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-ih-fg-3 mt-1",
          children: "Partner agents can submit bookings on behalf of their clients."
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-1 sm:grid-cols-2 gap-3",
        children: [/* @__PURE__ */ jsxs("div", {
          className: `border rounded-lg p-4 ${reviewRequired ? "border-ih-border bg-ih-bg-muted" : "border-ih-primary bg-ih-primary-tint"}`,
          children: [/* @__PURE__ */ jsxs("div", {
            className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2",
            children: ["Auto mode", !reviewRequired ? " — active" : ""]
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 text-[11px] font-bold text-ih-fg-1",
            children: [/* @__PURE__ */ jsx("span", {
              className: "px-2 py-1 rounded border border-ih-border bg-ih-bg-card",
              children: "Agent submits"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-4",
              children: "→"
            }), /* @__PURE__ */ jsx("span", {
              className: "px-2 py-1 rounded border border-ih-border bg-ih-bg-card",
              children: "Client confirms"
            })]
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: `border rounded-lg p-4 ${reviewRequired ? "border-ih-primary bg-ih-primary-tint" : "border-ih-border bg-ih-bg-muted"}`,
          children: [/* @__PURE__ */ jsxs("div", {
            className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-3 mb-2",
            children: ["Review mode", reviewRequired ? " — active" : ""]
          }), /* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2 text-[11px] font-bold text-ih-fg-1",
            children: [/* @__PURE__ */ jsx("span", {
              className: "px-2 py-1 rounded border border-ih-border bg-ih-bg-card",
              children: "Agent submits"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-4",
              children: "→"
            }), /* @__PURE__ */ jsx("span", {
              className: "px-2 py-1 rounded border border-ih-primary bg-ih-primary-tint",
              children: "You review"
            }), /* @__PURE__ */ jsx("span", {
              className: "text-ih-fg-4",
              children: "→"
            }), /* @__PURE__ */ jsx("span", {
              className: "px-2 py-1 rounded border border-ih-border bg-ih-bg-card",
              children: "Client confirms"
            })]
          })]
        })]
      }), /* @__PURE__ */ jsxs("label", {
        className: "flex items-start gap-3 cursor-pointer select-none",
        children: [/* @__PURE__ */ jsx("input", {
          type: "checkbox",
          checked: reviewRequired,
          onChange: (e) => setReviewRequired(e.target.checked),
          className: "mt-1 h-4 w-4 rounded border-ih-border text-ih-primary focus:ring-indigo-500"
        }), /* @__PURE__ */ jsxs("span", {
          children: [/* @__PURE__ */ jsx("span", {
            className: "block text-[13px] font-bold text-ih-fg-1",
            children: "Review concierge bookings before sending to client"
          }), /* @__PURE__ */ jsx("span", {
            className: "block text-[12px] text-ih-fg-3 mt-0.5",
            children: "When enabled, you must approve each booking from your dashboard before the client receives the magic link."
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[15px] font-bold text-ih-fg-1",
        children: "Availability"
      }), /* @__PURE__ */ jsxs("div", {
        className: "grid grid-cols-1 sm:grid-cols-3 gap-4",
        children: [/* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
            children: "Default duration (min)"
          }), /* @__PURE__ */ jsx("input", {
            type: "number",
            value: duration,
            onChange: (e) => setDuration(Number(e.target.value)),
            min: 15,
            step: 15,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
            children: "Start time"
          }), /* @__PURE__ */ jsx("input", {
            type: "time",
            value: startTime,
            onChange: (e) => setStartTime(e.target.value),
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("label", {
            className: "block text-[11px] font-bold text-ih-fg-3 mb-1 uppercase tracking-widest",
            children: "End time"
          }), /* @__PURE__ */ jsx("input", {
            type: "time",
            value: endTime,
            onChange: (e) => setEndTime(e.target.value),
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card text-[13px] text-ih-fg-1 focus:border-ih-primary focus:shadow-ih-focus outline-none"
          })]
        })]
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6 space-y-3",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[15px] font-bold text-ih-fg-1",
        children: "Widget embed code"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[12px] text-ih-fg-3",
        children: "Copy this snippet to embed the booking widget on your website."
      }), /* @__PURE__ */ jsx("pre", {
        className: "bg-ih-bg-muted border border-ih-border rounded-md p-3 text-[12px] text-ih-fg-2 font-mono overflow-x-auto",
        children: embedCode
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-3",
      children: [/* @__PURE__ */ jsx("button", {
        onClick: handleSave,
        disabled: saving,
        className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors disabled:opacity-50",
        children: saving ? "Saving..." : "Save changes"
      }), saved && /* @__PURE__ */ jsx("span", {
        className: "text-[13px] text-ih-ok-fg font-bold",
        children: "Saved."
      })]
    })]
  });
});
const route60 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsCatalogBooking,
  loader: loader$e,
  meta: meta$c
}, Symbol.toStringTag, { value: "Module" }));
async function loader$d({
  request
}) {
  const token = await requireToken(request);
  const res = await apiFetch("/api/billing/summary", {
    token
  });
  const body = res.ok ? await res.json() : {};
  return {
    billing: body.data ?? {}
  };
}
function fmtMoney(n) {
  return `$${n.toFixed(2)}`;
}
const settingsBilling = UNSAFE_withComponentProps(function SettingsBillingPage() {
  const {
    billing
  } = useLoaderData();
  const {
    hasBilling = false,
    hasSeatQuota = false,
    tier = "free",
    portalUrl,
    seatsUsed = 0,
    maxUsers,
    permanent = 0,
    guests = 0
  } = billing;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Billing"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Billing"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: hasBilling ? "Manage your subscription, seats, and invoices." : "Self-hosted deployment — no subscription required."
    }), /* @__PURE__ */ jsxs("div", {
      className: "grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "space-y-4",
        children: [!hasBilling && /* @__PURE__ */ jsx("section", {
          className: "bg-ih-ok-bg border border-ih-ok-fg/20 rounded-md p-6",
          children: /* @__PURE__ */ jsxs("div", {
            className: "flex items-start gap-3",
            children: [/* @__PURE__ */ jsx("span", {
              className: "inline-flex items-center justify-center w-9 h-9 rounded-full bg-emerald-500 text-white flex-shrink-0",
              children: /* @__PURE__ */ jsx("svg", {
                className: "w-5 h-5",
                fill: "none",
                stroke: "currentColor",
                strokeWidth: 2.5,
                strokeLinecap: "round",
                strokeLinejoin: "round",
                viewBox: "0 0 24 24",
                children: /* @__PURE__ */ jsx("path", {
                  d: "M4.5 12.75l6 6 9-13.5"
                })
              })
            }), /* @__PURE__ */ jsxs("div", {
              className: "flex-1",
              children: [/* @__PURE__ */ jsx("h3", {
                className: "text-lg font-bold text-ih-fg-1",
                children: "Self-hosted · no subscription"
              }), /* @__PURE__ */ jsx("p", {
                className: "text-[13px] text-ih-fg-2 mt-1.5 leading-relaxed",
                children: "This deployment runs in standalone mode. No per-seat charge, no Stripe. Add as many inspectors, apprentices, and guests as you need."
              }), /* @__PURE__ */ jsxs("a", {
                href: "https://github.com/InspectorHub/OpenInspection",
                target: "_blank",
                rel: "noopener",
                className: "mt-3 inline-flex items-center gap-1 text-[13px] font-bold text-ih-ok-fg hover:underline",
                children: ["OpenInspection on GitHub", /* @__PURE__ */ jsx(ArrowIcon, {})]
              })]
            })]
          })
        }), hasBilling && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-bg-card border border-ih-border rounded-md p-6",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-start justify-between gap-4 mb-5",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-4",
                children: "Current plan"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold capitalize text-ih-fg-1 mt-1",
                children: tier
              })]
            }), portalUrl && /* @__PURE__ */ jsxs("a", {
              href: portalUrl,
              target: "_blank",
              rel: "noopener",
              className: "px-4 py-2 rounded-md bg-ih-primary hover:bg-ih-primary-600 text-white text-[12px] font-bold inline-flex items-center gap-1.5 transition-colors",
              children: ["Open Stripe portal", /* @__PURE__ */ jsx(ArrowIcon, {})]
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "grid grid-cols-3 gap-4 pt-5 border-t border-ih-border",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: hasSeatQuota ? "Seats used" : "Active members"
              }), /* @__PURE__ */ jsxs("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: [seatsUsed, hasSeatQuota && maxUsers != null && /* @__PURE__ */ jsxs("span", {
                  className: "text-ih-fg-4 text-base font-normal",
                  children: [" / ", /* @__PURE__ */ jsx("span", {
                    className: "text-ih-fg-3 text-lg",
                    children: maxUsers
                  })]
                })]
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: "Permanent"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: permanent
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: "Active guests"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: guests
              })]
            })]
          })]
        }), !hasBilling && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-bg-card border border-ih-border rounded-md p-6",
          children: [/* @__PURE__ */ jsxs("header", {
            className: "mb-4",
            children: [/* @__PURE__ */ jsx("h3", {
              className: "text-lg font-bold text-ih-fg-1",
              children: "Workspace capacity"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3 mt-0.5",
              children: "No quotas in standalone mode — these are informational."
            })]
          }), /* @__PURE__ */ jsxs("div", {
            className: "grid grid-cols-3 gap-4",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: "Active members"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: seatsUsed
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: "Permanent"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: permanent
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("div", {
                className: "text-[10px] font-bold uppercase tracking-[0.18em] text-ih-fg-4",
                children: "Active guests"
              }), /* @__PURE__ */ jsx("div", {
                className: "text-2xl font-bold text-ih-fg-1 mt-1 tabular-nums",
                children: guests
              })]
            })]
          })]
        }), hasBilling && hasSeatQuota && tier !== "free" && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-bg-card border border-ih-border rounded-md p-6",
          children: [/* @__PURE__ */ jsxs("header", {
            className: "mb-4",
            children: [/* @__PURE__ */ jsx("h3", {
              className: "text-lg font-bold text-ih-fg-1",
              children: "Estimated monthly cost"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3 mt-0.5",
              children: "Stripe issues the canonical invoice — these figures are an estimate based on the per-seat rate."
            })]
          }), /* @__PURE__ */ jsxs("dl", {
            className: "divide-y divide-ih-border",
            children: [/* @__PURE__ */ jsxs("div", {
              className: "py-2 flex items-center justify-between text-[13px]",
              children: [/* @__PURE__ */ jsxs("dt", {
                className: "text-ih-fg-3",
                children: [permanent, " permanent inspector seat", permanent !== 1 ? "s" : "", " · $29.99 each"]
              }), /* @__PURE__ */ jsx("dd", {
                className: "font-mono font-semibold text-ih-fg-1",
                children: fmtMoney(permanent * 29.99)
              })]
            }), guests > 0 && /* @__PURE__ */ jsxs("div", {
              className: "py-2 flex items-center justify-between text-[13px]",
              children: [/* @__PURE__ */ jsxs("dt", {
                className: "text-ih-fg-3",
                children: [guests, " active guest", guests !== 1 ? "s" : "", " · $1.49 / day each"]
              }), /* @__PURE__ */ jsx("dd", {
                className: "font-mono font-semibold text-ih-fg-1",
                children: "billed on use"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              className: "py-3 flex items-center justify-between",
              children: [/* @__PURE__ */ jsx("dt", {
                className: "text-[13px] font-bold text-ih-fg-1",
                children: "Approximate seat charges this month"
              }), /* @__PURE__ */ jsx("dd", {
                className: "font-mono font-bold text-lg text-ih-fg-1",
                children: fmtMoney(permanent * 29.99)
              })]
            })]
          })]
        }), hasBilling && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-bg-card border border-ih-border rounded-md p-6",
          children: [/* @__PURE__ */ jsx("header", {
            className: "mb-3",
            children: /* @__PURE__ */ jsx("h3", {
              className: "text-lg font-bold text-ih-fg-1",
              children: "Invoices & payment method"
            })
          }), /* @__PURE__ */ jsxs("p", {
            className: "text-[13px] text-ih-fg-3 leading-relaxed",
            children: ["Invoice history, card-on-file updates, and ", hasSeatQuota ? "seat-cycle changes" : "plan tier changes", " happen in the Stripe-hosted billing portal so PCI compliance lives outside OpenInspection."]
          }), portalUrl ? /* @__PURE__ */ jsxs("a", {
            href: portalUrl,
            target: "_blank",
            rel: "noopener",
            className: "mt-4 inline-flex items-center gap-1.5 text-[13px] font-bold text-ih-primary hover:underline",
            children: ["Manage in Stripe portal", /* @__PURE__ */ jsx(ArrowIcon, {})]
          }) : /* @__PURE__ */ jsx("p", {
            className: "mt-4 text-[11px] text-ih-fg-3 italic",
            children: "Billing portal is not configured on this deployment."
          })]
        })]
      }), /* @__PURE__ */ jsxs("aside", {
        className: "space-y-4",
        children: [!hasBilling && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-primary-tint border border-ih-primary rounded-md p-5",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary",
            children: "Need hosted instead?"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-2 mt-2 leading-relaxed",
            children: "InspectorHub.io offers the same OpenInspection codebase as a managed service — no Cloudflare account, no D1 quota worries."
          }), /* @__PURE__ */ jsxs("a", {
            href: "https://inspectorhub.io/",
            target: "_blank",
            rel: "noopener",
            className: "mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-ih-primary hover:underline",
            children: ["Try the hosted version ", /* @__PURE__ */ jsx(ArrowIcon, {})]
          })]
        }), hasBilling && hasSeatQuota && /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-primary-tint border border-ih-primary rounded-md p-5",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-[10px] font-bold uppercase tracking-[0.2em] text-ih-primary",
            children: "Want to self-host?"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[12px] text-ih-fg-2 mt-2 leading-relaxed",
            children: "Every collaboration feature is free on the open-source build. The per-seat subscription only exists on the hosted shared plan."
          }), /* @__PURE__ */ jsxs("a", {
            href: "https://github.com/InspectorHub/OpenInspection",
            target: "_blank",
            rel: "noopener",
            className: "mt-3 inline-flex items-center gap-1 text-[11px] font-bold text-ih-primary hover:underline",
            children: ["Self-host docs ", /* @__PURE__ */ jsx(ArrowIcon, {})]
          })]
        }), /* @__PURE__ */ jsxs("section", {
          className: "bg-ih-bg-card border border-ih-border rounded-md p-5 text-[12px] text-ih-fg-3 leading-relaxed",
          children: [/* @__PURE__ */ jsx("div", {
            className: "font-bold text-ih-fg-1 mb-1.5 text-[13px]",
            children: "Add a seat"
          }), "Add a permanent inspector or generate a guest invite link in", " ", /* @__PURE__ */ jsx(Link, {
            to: "/settings/team",
            className: "font-semibold text-ih-primary hover:underline",
            children: "Team settings"
          }), "."]
        })]
      })]
    })]
  });
});
function ArrowIcon() {
  return /* @__PURE__ */ jsx("svg", {
    className: "w-3 h-3",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    viewBox: "0 0 24 24",
    children: /* @__PURE__ */ jsx("path", {
      d: "M14 5l7 7m0 0l-7 7m7-7H3"
    })
  });
}
const route61 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsBilling,
  loader: loader$d
}, Symbol.toStringTag, { value: "Module" }));
async function loader$c({
  request
}) {
  const token = await requireToken(request);
  const [meRes, secretsRes] = await Promise.all([apiFetch("/api/auth/me", {
    token
  }), apiFetch("/api/admin/secrets", {
    token
  }).catch(() => null)]);
  const meBody = meRes.ok ? await meRes.json() : {};
  const secretsBody = (secretsRes == null ? void 0 : secretsRes.ok) ? await secretsRes.json() : {};
  const secrets = secretsBody.data ?? {};
  return {
    user: meBody.data ?? {},
    secrets: {
      TURNSTILE_SECRET_KEY: secrets.TURNSTILE_SECRET_KEY || ""
    }
  };
}
async function action$1({
  request
}) {
  const token = await requireToken(request);
  const fd = await request.formData();
  const intent = fd.get("intent");
  if (intent === "change-password") {
    const body = {
      currentPassword: fd.get("currentPassword"),
      newPassword: fd.get("newPassword"),
      confirmPassword: fd.get("confirmPassword")
    };
    if (body.newPassword !== body.confirmPassword) {
      return {
        success: false,
        error: "New passwords do not match."
      };
    }
    const res = await apiFetch("/api/auth/change-password", {
      token,
      method: "POST",
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return {
        success: false,
        error: (err == null ? void 0 : err.message) || "Password change failed"
      };
    }
    return {
      success: true,
      error: null
    };
  }
  if (intent === "save-turnstile") {
    const val = fd.get("TURNSTILE_SECRET_KEY");
    if (val && typeof val === "string" && val.trim()) {
      const res = await apiFetch("/api/admin/secrets", {
        token,
        method: "PUT",
        body: JSON.stringify({
          TURNSTILE_SECRET_KEY: val
        })
      });
      if (!res.ok) {
        return {
          success: false,
          error: "Failed to save Turnstile key."
        };
      }
    }
    return {
      success: true,
      error: null
    };
  }
  return {
    success: false,
    error: "Unknown action"
  };
}
const settingsSecurity = UNSAFE_withComponentProps(function SettingsSecurityPage() {
  const {
    user,
    secrets
  } = useLoaderData();
  const actionData = useActionData();
  const [showPassword, setShowPassword] = useState(false);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px] max-w-3xl",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Security"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Security"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Password, two-factor authentication, and active sessions."
    }), (actionData == null ? void 0 : actionData.success) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-ok-bg border border-ih-ok-fg/20 text-[13px] text-ih-ok-fg font-medium",
      children: "Password changed successfully."
    }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg font-medium",
      children: actionData.error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Change password"
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-4 max-w-md",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "change-password"
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "currentPassword",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Current password"
          }), /* @__PURE__ */ jsx("input", {
            type: showPassword ? "text" : "password",
            id: "currentPassword",
            name: "currentPassword",
            autoComplete: "current-password",
            required: true,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "newPassword",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "New password"
          }), /* @__PURE__ */ jsx("input", {
            type: showPassword ? "text" : "password",
            id: "newPassword",
            name: "newPassword",
            autoComplete: "new-password",
            required: true,
            minLength: 8,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
          })]
        }), /* @__PURE__ */ jsxs("div", {
          className: "space-y-2",
          children: [/* @__PURE__ */ jsx("label", {
            htmlFor: "confirmPassword",
            className: "block text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
            children: "Confirm new password"
          }), /* @__PURE__ */ jsx("input", {
            type: showPassword ? "text" : "password",
            id: "confirmPassword",
            name: "confirmPassword",
            autoComplete: "new-password",
            required: true,
            minLength: 8,
            className: "w-full px-3 py-2 rounded-md border border-ih-border bg-ih-bg-card focus:border-ih-primary focus:shadow-ih-focus outline-none text-[13px] text-ih-fg-1"
          })]
        }), /* @__PURE__ */ jsxs("label", {
          className: "flex items-center gap-2 text-[11px] text-ih-fg-3 cursor-pointer",
          children: [/* @__PURE__ */ jsx("input", {
            type: "checkbox",
            checked: showPassword,
            onChange: (e) => setShowPassword(e.target.checked),
            className: "rounded border-ih-border"
          }), "Show passwords"]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Change Password"
          })
        })]
      })]
    }), /* @__PURE__ */ jsx("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6",
      children: /* @__PURE__ */ jsxs("div", {
        className: "flex items-start justify-between gap-4 flex-wrap",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-3",
          children: [/* @__PURE__ */ jsx("div", {
            className: `w-10 h-10 rounded-full flex items-center justify-center ${user.totpEnabled ? "bg-ih-ok-bg text-ih-ok-fg" : "bg-ih-bg-muted text-ih-fg-3"}`,
            children: /* @__PURE__ */ jsx("svg", {
              width: "20",
              height: "20",
              viewBox: "0 0 24 24",
              fill: "none",
              stroke: "currentColor",
              strokeWidth: 2,
              children: /* @__PURE__ */ jsx("path", {
                d: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"
              })
            })
          }), /* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("p", {
              className: "font-bold text-ih-fg-1 text-[13px]",
              children: "Two-factor authentication"
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] text-ih-fg-3",
              children: user.totpEnabled ? "Enabled. Required at every sign in." : "Not enabled."
            }), user.totpEnabled && user.recoveryCodesRemaining != null && /* @__PURE__ */ jsxs("p", {
              className: "text-[11px] text-ih-fg-3 mt-1",
              children: [user.recoveryCodesRemaining, " recovery codes remaining"]
            })]
          })]
        }), /* @__PURE__ */ jsx("div", {
          className: "flex gap-2 flex-wrap",
          children: !user.totpEnabled ? /* @__PURE__ */ jsx("button", {
            className: "px-4 py-2 bg-ih-primary text-white rounded-md font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Enable 2FA"
          }) : /* @__PURE__ */ jsxs(Fragment, {
            children: [/* @__PURE__ */ jsx("button", {
              className: "px-4 py-2 rounded-md border border-ih-border bg-ih-bg-card text-ih-fg-2 text-[13px] font-semibold hover:bg-ih-bg-muted transition-all",
              children: "Regenerate codes"
            }), /* @__PURE__ */ jsx("button", {
              className: "px-4 py-2 rounded-md border border-ih-bad text-ih-bad-fg text-[13px] font-bold hover:bg-ih-bad-bg transition-all",
              children: "Disable 2FA"
            })]
          })
        })]
      })
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-5",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Bot protection"
      }), /* @__PURE__ */ jsxs("p", {
        className: "text-[13px] text-ih-fg-3",
        children: ["Bot protection prevents automated form submissions on public-facing pages. Get keys at", " ", /* @__PURE__ */ jsx("a", {
          href: "https://dash.cloudflare.com/?to=/:account/turnstile",
          target: "_blank",
          rel: "noopener noreferrer",
          className: "text-ih-primary hover:underline",
          children: "Cloudflare dashboard"
        }), "."]
      }), /* @__PURE__ */ jsxs(Form, {
        method: "post",
        className: "space-y-3 max-w-xl",
        children: [/* @__PURE__ */ jsx("input", {
          type: "hidden",
          name: "intent",
          value: "save-turnstile"
        }), /* @__PURE__ */ jsx(SecretField, {
          name: "TURNSTILE_SECRET_KEY",
          label: "Turnstile Secret Key",
          value: secrets.TURNSTILE_SECRET_KEY,
          hint: "Bot protection on booking and signup forms. Create at dash.cloudflare.com → Turnstile. Use test key 1x0000000000000000000000000000000AA for development"
        }), /* @__PURE__ */ jsx("div", {
          className: "flex justify-end pt-2 border-t border-ih-border",
          children: /* @__PURE__ */ jsx("button", {
            type: "submit",
            className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 active:scale-[.98] transition-all",
            children: "Save"
          })
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card rounded-lg border border-ih-border p-6 space-y-4",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-[11px] font-bold text-ih-fg-2 uppercase tracking-[0.2em]",
        children: "Active sessions"
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 p-3 rounded-md bg-ih-bg-muted border border-ih-border",
        children: [/* @__PURE__ */ jsx("div", {
          className: "w-8 h-8 rounded-full bg-ih-primary-tint text-ih-primary flex items-center justify-center",
          children: /* @__PURE__ */ jsx("svg", {
            className: "w-4 h-4",
            fill: "none",
            stroke: "currentColor",
            viewBox: "0 0 24 24",
            children: /* @__PURE__ */ jsx("path", {
              strokeLinecap: "round",
              strokeLinejoin: "round",
              strokeWidth: 2,
              d: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            })
          })
        }), /* @__PURE__ */ jsxs("div", {
          children: [/* @__PURE__ */ jsx("p", {
            className: "text-[13px] font-medium text-ih-fg-1",
            children: "Current session"
          }), /* @__PURE__ */ jsx("p", {
            className: "text-[11px] text-ih-fg-3",
            children: "Active now"
          })]
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[11px] text-ih-fg-3",
        children: "Full session management coming soon."
      })]
    })]
  });
});
const route62 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action: action$1,
  default: settingsSecurity,
  loader: loader$c
}, Symbol.toStringTag, { value: "Module" }));
function meta$b() {
  return [{
    title: "Analytics & Metrics - Settings - OpenInspection"
  }];
}
async function loader$b({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/analytics/dashboard", {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      chartPlaceholder: (d == null ? void 0 : d.chartPlaceholder) ?? "No data yet",
      defects: (d == null ? void 0 : d.defects) ?? [],
      teamCounts: (d == null ? void 0 : d.teamCounts) ?? {
        inspectors: 0,
        specialists: 0,
        apprentices: 0
      },
      error: null
    };
  } catch {
    return {
      chartPlaceholder: "No data yet",
      defects: [],
      teamCounts: {
        inspectors: 0,
        specialists: 0,
        apprentices: 0
      },
      error: "Failed to load analytics"
    };
  }
}
const settingsAnalytics = UNSAFE_withComponentProps(function SettingsAnalyticsPage() {
  const {
    chartPlaceholder,
    defects,
    teamCounts,
    error
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-center gap-2 text-[13px] text-ih-fg-3",
      children: [/* @__PURE__ */ jsx(Link, {
        to: "/settings",
        className: "hover:text-ih-primary transition-colors",
        children: "Settings"
      }), /* @__PURE__ */ jsx("span", {
        children: "›"
      }), /* @__PURE__ */ jsx("span", {
        className: "text-ih-fg-1",
        children: "Analytics & Metrics"
      })]
    }), /* @__PURE__ */ jsx("h2", {
      className: "text-[19px] font-bold text-ih-fg-1",
      children: "Analytics & Metrics"
    }), /* @__PURE__ */ jsx("p", {
      className: "text-[13px] text-ih-fg-3",
      children: "Inspection volume, recurring defects, and team growth."
    }), error && /* @__PURE__ */ jsx("div", {
      className: "px-4 py-2.5 rounded-md bg-ih-bad-bg border border-ih-bad text-[13px] text-ih-bad-fg",
      children: error
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-sm font-bold text-ih-fg-1 mb-1",
        children: "Inspections per month"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-xs text-ih-fg-3 mb-4",
        children: "12-month rolling trend. Chart renders when data is available."
      }), /* @__PURE__ */ jsx("div", {
        className: "h-48 flex items-center justify-center border border-dashed border-ih-border rounded-md",
        children: /* @__PURE__ */ jsx("span", {
          className: "text-xs text-ih-fg-4",
          children: chartPlaceholder
        })
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-sm font-bold text-ih-fg-1 mb-1",
        children: "Recurring defects"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-xs text-ih-fg-3 mb-4",
        children: "Most frequently flagged items across all inspections."
      }), defects.length === 0 ? /* @__PURE__ */ jsx("div", {
        className: "text-xs text-ih-fg-4 py-4 text-center",
        children: "No defect data yet"
      }) : /* @__PURE__ */ jsxs("table", {
        className: "w-full text-sm",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border text-left",
            children: [/* @__PURE__ */ jsx("th", {
              className: "py-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4",
              children: "Item"
            }), /* @__PURE__ */ jsx("th", {
              className: "py-2 text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 text-right",
              children: "Occurrences"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          children: defects.map((d) => /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("td", {
              className: "py-2 text-ih-fg-2",
              children: d.name
            }), /* @__PURE__ */ jsx("td", {
              className: "py-2 text-right font-mono text-ih-fg-1",
              children: d.count
            })]
          }, d.name))
        })]
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-lg p-6",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-sm font-bold text-ih-fg-1 mb-1",
        children: "Team growth"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-xs text-ih-fg-3 mb-4",
        children: "Active inspectors, specialists, and apprentices over time."
      }), /* @__PURE__ */ jsx("div", {
        className: "grid grid-cols-3 gap-4",
        children: [{
          label: "Inspectors",
          value: teamCounts.inspectors
        }, {
          label: "Specialists",
          value: teamCounts.specialists
        }, {
          label: "Apprentices",
          value: teamCounts.apprentices
        }].map((t) => /* @__PURE__ */ jsxs("div", {
          className: "text-center",
          children: [/* @__PURE__ */ jsx("div", {
            className: "text-2xl font-bold text-ih-fg-1 tabular-nums",
            children: t.value
          }), /* @__PURE__ */ jsx("div", {
            className: "text-[10px] font-bold uppercase tracking-widest text-ih-fg-4 mt-1",
            children: t.label
          })]
        }, t.label))
      })]
    })]
  });
});
const route63 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsAnalytics,
  loader: loader$b,
  meta: meta$b
}, Symbol.toStringTag, { value: "Module" }));
function meta$a() {
  return [{
    title: "Comments Library - OpenInspection"
  }];
}
async function loader$a({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/comments", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      comments: body.data ?? []
    };
  } catch {
    return {
      comments: []
    };
  }
}
const TABS$3 = [{
  id: "all",
  label: "All"
}, {
  id: "satisfactory",
  label: "Satisfactory"
}, {
  id: "monitor",
  label: "Monitor"
}, {
  id: "defect",
  label: "Defect"
}];
const BUCKET_TONE = {
  satisfactory: "sat",
  monitor: "monitor",
  defect: "defect"
};
const comments = UNSAFE_withComponentProps(function CommentsPage() {
  const {
    comments: comments2
  } = useLoaderData();
  const [activeTab, setActiveTab] = useState("all");
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Comments",
      title: "Comments Library",
      meta: `${comments2.length} in library`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ Add comment"
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$3,
      activeId: activeTab,
      onChange: setActiveTab
    }), comments2.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No comments yet",
        description: 'Click "+ Add comment" above to create your first comment snippet.'
      })
    }) : /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 gap-3",
      children: comments2.map((c) => /* @__PURE__ */ jsxs(Card, {
        className: "p-4",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 line-clamp-3",
          children: c.text
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-2 mt-2",
          children: [c.ratingBucket && /* @__PURE__ */ jsx(Pill, {
            tone: BUCKET_TONE[c.ratingBucket] || "gen",
            children: c.ratingBucket
          }), c.section && /* @__PURE__ */ jsx("span", {
            className: "text-[10px] font-bold uppercase tracking-wide text-ih-fg-4",
            children: c.section
          })]
        })]
      }, c.id))
    })]
  });
});
const route64 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: comments,
  loader: loader$a,
  meta: meta$a
}, Symbol.toStringTag, { value: "Module" }));
function meta$9() {
  return [{
    title: "Repair Items - OpenInspection"
  }];
}
async function loader$9({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/recommendations", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      items: body.data ?? []
    };
  } catch {
    return {
      items: []
    };
  }
}
const TABS$2 = [{
  id: "all",
  label: "All"
}, {
  id: "safety",
  label: "Safety"
}, {
  id: "repair",
  label: "Repair"
}, {
  id: "maintenance",
  label: "Maintenance"
}];
const recommendations$1 = UNSAFE_withComponentProps(function RecommendationsPage() {
  const {
    items
  } = useLoaderData();
  const [activeTab, setActiveTab] = useState("all");
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Repair Items",
      title: "Repair Items",
      meta: `${items.length} in library`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ Add item"
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$2,
      activeId: activeTab,
      onChange: setActiveTab
    }), items.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No repair items yet",
        description: 'Click "+ Add item" above to create your first repair recommendation.'
      })
    }) : /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 gap-3",
      children: items.map((item) => /* @__PURE__ */ jsxs(Card, {
        className: "p-4",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[13px] font-semibold text-ih-fg-1",
          children: item.title || item.name
        }), item.description && /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1 line-clamp-2",
          children: item.description
        }), /* @__PURE__ */ jsx("div", {
          className: "flex items-center gap-2 mt-2",
          children: item.category && /* @__PURE__ */ jsx(Pill, {
            tone: "gen",
            children: item.category
          })
        })]
      }, item.id))
    })]
  });
});
const route65 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: recommendations$1,
  loader: loader$9,
  meta: meta$9
}, Symbol.toStringTag, { value: "Module" }));
function meta$8() {
  return [{
    title: "Tags - OpenInspection"
  }];
}
async function loader$8({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/tags", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      tags: body.data ?? []
    };
  } catch {
    return {
      tags: []
    };
  }
}
const tags = UNSAFE_withComponentProps(function TagsPage() {
  const {
    tags: tags2
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Tags",
      title: "Tags",
      meta: `${tags2.length} tags`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ Add tag"
      })
    }), tags2.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No tags yet",
        description: 'Click "+ Add tag" above to organize your library with tags.'
      })
    }) : /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: "Name"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: "Color"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: "Used"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right",
              children: "Actions"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          className: "divide-y divide-ih-border",
          children: tags2.map((tag) => /* @__PURE__ */ jsxs("tr", {
            className: "hover:bg-ih-bg-muted/50 transition-colors",
            children: [/* @__PURE__ */ jsx("td", {
              className: "px-4 py-3",
              children: /* @__PURE__ */ jsxs("span", {
                className: "inline-flex items-center gap-2 text-[13px] font-semibold text-ih-fg-1",
                children: [tag.color && /* @__PURE__ */ jsx("span", {
                  className: "w-3 h-3 rounded-full",
                  style: {
                    backgroundColor: tag.color
                  }
                }), tag.name]
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-[13px] text-ih-fg-3",
              children: tag.color || "--"
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-[13px] text-ih-fg-3",
              children: tag.count ?? 0
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-right",
              children: /* @__PURE__ */ jsx("button", {
                className: "text-[13px] text-ih-primary hover:opacity-80 font-semibold",
                children: "Edit"
              })
            })]
          }, tag.id))
        })]
      })
    })]
  });
});
const route66 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: tags,
  loader: loader$8,
  meta: meta$8
}, Symbol.toStringTag, { value: "Module" }));
function meta$7() {
  return [{
    title: "Agreements - OpenInspection"
  }];
}
async function loader$7({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/agreements", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      agreements: body.data ?? []
    };
  } catch {
    return {
      agreements: []
    };
  }
}
const TABS$1 = [{
  id: "templates",
  label: "Templates"
}, {
  id: "signing",
  label: "Signing"
}];
const agreements = UNSAFE_withComponentProps(function AgreementsPage() {
  const {
    agreements: agreements2
  } = useLoaderData();
  const [activeTab, setActiveTab] = useState("templates");
  const filtered = activeTab === "templates" ? agreements2.filter((a) => !a.signedAt) : agreements2.filter((a) => a.signedAt);
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Agreements",
      title: "Agreements",
      meta: `${agreements2.length} total`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ New agreement"
      })
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS$1,
      activeId: activeTab,
      onChange: setActiveTab
    }), filtered.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: activeTab === "templates" ? "No agreement templates yet" : "No signed agreements yet",
        description: activeTab === "templates" ? 'Click "+ New agreement" above to create your first agreement template.' : "Signed agreements will appear here after clients complete the signing process."
      })
    }) : /* @__PURE__ */ jsx(Card, {
      className: "overflow-hidden",
      children: /* @__PURE__ */ jsxs("table", {
        className: "w-full text-left",
        children: [/* @__PURE__ */ jsx("thead", {
          children: /* @__PURE__ */ jsxs("tr", {
            className: "border-b border-ih-border",
            children: [/* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: "Title"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: activeTab === "templates" ? "Last updated" : "Signed"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3",
              children: "Status"
            }), /* @__PURE__ */ jsx("th", {
              className: "px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-ih-fg-3 text-right",
              children: "Actions"
            })]
          })
        }), /* @__PURE__ */ jsx("tbody", {
          className: "divide-y divide-ih-border",
          children: filtered.map((a) => /* @__PURE__ */ jsxs("tr", {
            className: "hover:bg-ih-bg-muted/50 transition-colors",
            children: [/* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-[13px] font-semibold text-ih-fg-1",
              children: a.title || a.name || "Untitled"
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-[13px] text-ih-fg-3",
              children: a.signedAt || a.updatedAt || "--"
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3",
              children: /* @__PURE__ */ jsx(Pill, {
                tone: a.signedAt ? "sat" : "gen",
                children: a.signedAt ? "Signed" : "Draft"
              })
            }), /* @__PURE__ */ jsx("td", {
              className: "px-4 py-3 text-right",
              children: /* @__PURE__ */ jsx("button", {
                className: "text-[13px] text-ih-primary hover:opacity-80 font-semibold",
                children: activeTab === "templates" ? "Edit" : "View"
              })
            })]
          }, a.id))
        })]
      })
    })]
  });
});
const route67 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: agreements,
  loader: loader$7,
  meta: meta$7
}, Symbol.toStringTag, { value: "Module" }));
function meta$6() {
  return [{
    title: "Rating Systems - OpenInspection"
  }];
}
async function loader$6({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/admin/rating-systems", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      systems: body.data ?? []
    };
  } catch {
    return {
      systems: []
    };
  }
}
const ratingSystems = UNSAFE_withComponentProps(function RatingSystemsPage() {
  const {
    systems
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Rating Systems",
      title: "Rating Systems",
      meta: `${systems.length} systems`,
      actions: /* @__PURE__ */ jsx(Button, {
        variant: "primary",
        children: "+ New rating system"
      })
    }), systems.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "No rating systems yet",
        description: 'Click "+ New rating system" above to define how items are rated during inspections.'
      })
    }) : /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 gap-3",
      children: systems.map((sys) => /* @__PURE__ */ jsxs(Card, {
        className: "p-4",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-start justify-between",
          children: [/* @__PURE__ */ jsxs("div", {
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-semibold text-ih-fg-1",
              children: sys.name
            }), sys.description && /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3 mt-1 line-clamp-2",
              children: sys.description
            })]
          }), /* @__PURE__ */ jsx("button", {
            className: "text-[13px] text-ih-primary hover:opacity-80 font-semibold shrink-0 ml-4",
            children: "Edit"
          })]
        }), sys.ratings && Array.isArray(sys.ratings) && /* @__PURE__ */ jsx("div", {
          className: "flex items-center gap-1.5 mt-3",
          children: sys.ratings.map((r, idx) => /* @__PURE__ */ jsx("span", {
            className: "inline-flex items-center h-6 px-2 rounded text-[11px] font-bold",
            style: {
              backgroundColor: r.color ? `${r.color}20` : void 0,
              color: r.color || void 0
            },
            children: r.label || r.name
          }, idx))
        })]
      }, sys.id))
    })]
  });
});
const route68 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: ratingSystems,
  loader: loader$6,
  meta: meta$6
}, Symbol.toStringTag, { value: "Module" }));
function meta$5() {
  return [{
    title: "Marketplace - OpenInspection"
  }];
}
async function loader$5({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/marketplace/templates", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      templates: body.data ?? []
    };
  } catch {
    return {
      templates: []
    };
  }
}
const TABS = [{
  id: "all",
  label: "All"
}, {
  id: "templates",
  label: "Templates"
}, {
  id: "comments",
  label: "Comments"
}, {
  id: "agreements",
  label: "Agreements"
}];
const marketplace = UNSAFE_withComponentProps(function MarketplacePage() {
  const {
    templates: templates2
  } = useLoaderData();
  const [activeTab, setActiveTab] = useState("all");
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-[18px]",
    children: [/* @__PURE__ */ jsx(PageHeader, {
      eyebrow: "Library · Marketplace",
      title: "Marketplace",
      meta: `${templates2.length} available`
    }), /* @__PURE__ */ jsx(TabStrip, {
      tabs: TABS,
      activeId: activeTab,
      onChange: setActiveTab
    }), templates2.length === 0 ? /* @__PURE__ */ jsx(Card, {
      children: /* @__PURE__ */ jsx(EmptyState, {
        title: "Marketplace is empty",
        description: "Community templates and content packs will appear here."
      })
    }) : /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3",
      children: templates2.map((t) => /* @__PURE__ */ jsxs(Card, {
        className: "p-4",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[13px] font-semibold text-ih-fg-1",
          children: t.name || t.title
        }), t.description && /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1 line-clamp-2",
          children: t.description
        }), /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between mt-3",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "flex items-center gap-2",
            children: [t.category && /* @__PURE__ */ jsx(Pill, {
              tone: "gen",
              children: t.category
            }), t.author && /* @__PURE__ */ jsx("span", {
              className: "text-[11px] text-ih-fg-4",
              children: t.author
            })]
          }), /* @__PURE__ */ jsx(Button, {
            variant: "primary",
            size: "sm",
            children: "Install"
          })]
        })]
      }, t.id))
    })]
  });
});
const route69 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: marketplace,
  loader: loader$5,
  meta: meta$5
}, Symbol.toStringTag, { value: "Module" }));
async function loader$4({
  request
}) {
  await requireToken(request);
  return null;
}
const NAV_ITEMS = [{
  to: "/agent-dashboard",
  label: "Dashboard"
}, {
  to: "/agent-recommendations",
  label: "Recommendations"
}, {
  to: "/agent-inspectors",
  label: "Inspectors"
}, {
  to: "/agent-settings/profile",
  label: "Settings"
}];
const agentLayout = UNSAFE_withComponentProps(function AgentLayout() {
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen bg-[#f8fafc] dark:bg-slate-900",
    children: [/* @__PURE__ */ jsx("header", {
      className: "border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800",
      children: /* @__PURE__ */ jsxs("div", {
        className: "max-w-[1080px] mx-auto px-6 h-14 flex items-center justify-between",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-3",
          children: [/* @__PURE__ */ jsx("img", {
            src: "/logo.svg",
            alt: "",
            className: "w-7 h-7 shrink-0"
          }), /* @__PURE__ */ jsx("span", {
            className: "text-sm font-bold text-slate-900 dark:text-slate-100",
            children: "OpenInspection"
          }), /* @__PURE__ */ jsx("span", {
            className: "text-[10px] font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 ml-2 hidden sm:inline",
            children: "Agent Portal"
          })]
        }), /* @__PURE__ */ jsxs("nav", {
          className: "flex items-center gap-1",
          children: [NAV_ITEMS.map((item) => /* @__PURE__ */ jsx(NavLink, {
            to: item.to,
            className: ({
              isActive
            }) => `px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors ${isActive ? "bg-indigo-50 text-indigo-600 dark:bg-slate-700 dark:text-white" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"}`,
            children: item.label
          }, item.to)), /* @__PURE__ */ jsx("a", {
            href: "/logout",
            className: "px-3 py-1.5 rounded-md text-[13px] font-medium text-slate-600 hover:bg-red-50 hover:text-red-600 dark:text-slate-400 dark:hover:bg-red-900/20 dark:hover:text-red-400 transition-colors ml-2",
            children: "Sign out"
          })]
        })]
      })
    }), /* @__PURE__ */ jsx("main", {
      className: "max-w-[1080px] mx-auto px-6 py-8",
      children: /* @__PURE__ */ jsx(Outlet, {})
    })]
  });
});
const route70 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: agentLayout,
  loader: loader$4
}, Symbol.toStringTag, { value: "Module" }));
function meta$4() {
  return [{
    title: "Agent Dashboard - OpenInspection"
  }];
}
async function loader$3({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/referrals", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      referrals: body.data ?? [],
      unreadReports: typeof (body == null ? void 0 : body.unreadReports) === "number" ? body.unreadReports : 0
    };
  } catch {
    return {
      referrals: [],
      unreadReports: 0
    };
  }
}
function statusLabel(s) {
  const map = {
    draft: "Booked",
    scheduled: "Scheduled",
    confirmed: "Confirmed",
    in_progress: "On site",
    completed: "Completed",
    delivered: "Published",
    cancelled: "Cancelled"
  };
  return map[s.toLowerCase()] || s || "Pending";
}
function statusColor(s) {
  const lower = s.toLowerCase();
  if (lower === "delivered") return "bg-ih-ok-bg text-ih-ok-fg";
  if (lower === "in_progress" || lower === "completed") return "bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-400";
  if (lower === "cancelled") return "bg-ih-bad-bg text-ih-bad-fg";
  return "bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400";
}
const dashboard = UNSAFE_withComponentProps(function AgentDashboardPage() {
  const {
    referrals,
    unreadReports
  } = useLoaderData();
  const grouped = /* @__PURE__ */ new Map();
  for (const r of referrals) {
    const existing = grouped.get(r.tenantName) || [];
    existing.push(r);
    grouped.set(r.tenantName, existing);
  }
  const sections = Array.from(grouped.entries());
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-6",
    children: [/* @__PURE__ */ jsxs("div", {
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-[28px] font-bold tracking-tight text-slate-900 dark:text-white",
        children: "Agent Dashboard"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[14px] text-ih-fg-3 mt-1",
        children: "Your referrals across every team you partner with."
      })]
    }), /* @__PURE__ */ jsxs("div", {
      className: "grid grid-cols-1 sm:grid-cols-2 gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-5",
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1",
          children: "Active Referrals"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-3xl font-bold text-slate-900 dark:text-white",
          children: referrals.length
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: ["Across ", sections.length, " ", sections.length === 1 ? "team" : "teams"]
        })]
      }), /* @__PURE__ */ jsxs("div", {
        className: `bg-ih-bg-card border border-ih-border rounded-xl p-5 ${unreadReports > 0 ? "border-indigo-300 dark:border-indigo-700" : ""}`,
        children: [/* @__PURE__ */ jsx("p", {
          className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1",
          children: "Reports Ready to Read"
        }), /* @__PURE__ */ jsx("p", {
          className: `text-3xl font-bold ${unreadReports > 0 ? "text-ih-primary" : "text-slate-900 dark:text-white"}`,
          children: unreadReports
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[13px] text-ih-fg-3 mt-1",
          children: unreadReports === 0 ? "You're all caught up" : "Tap a row below to open"
        })]
      })]
    }), sections.length === 0 ? /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-lg font-bold text-slate-900 dark:text-white mb-2",
        children: "No referrals yet"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 max-w-md mx-auto",
        children: "Inspectors invite agents from their contacts list. Once you are linked, every inspection you refer lands here."
      }), /* @__PURE__ */ jsx(Link, {
        to: "/agent-settings/profile",
        className: "inline-flex items-center mt-4 h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors",
        children: "Set up your referral slug"
      })]
    }) : sections.map(([tenantName, rows]) => /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-ih-border rounded-xl overflow-hidden",
      children: [/* @__PURE__ */ jsxs("div", {
        className: "flex items-center gap-3 px-5 py-3 bg-ih-bg-app/30 border-b border-ih-border",
        children: [/* @__PURE__ */ jsx("span", {
          className: "w-1 h-6 rounded bg-indigo-500"
        }), /* @__PURE__ */ jsx("span", {
          className: "text-sm font-bold text-ih-fg-1",
          children: tenantName
        }), /* @__PURE__ */ jsxs("span", {
          className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest ml-auto",
          children: [rows.length, " ", rows.length === 1 ? "referral" : "referrals"]
        })]
      }), /* @__PURE__ */ jsx("div", {
        className: "divide-y divide-slate-100 dark:divide-slate-700",
        children: rows.map((r) => /* @__PURE__ */ jsxs("div", {
          className: "flex items-center justify-between px-5 py-3 hover:bg-ih-bg-muted/30 transition-colors",
          children: [/* @__PURE__ */ jsxs("div", {
            className: "min-w-0",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[13px] font-semibold text-ih-fg-1 truncate",
              children: r.propertyAddress || "No address"
            }), /* @__PURE__ */ jsxs("p", {
              className: "text-[11px] text-ih-fg-3 mt-0.5",
              children: [r.clientName || "No client", r.date ? ` · ${r.date}` : "", r.inspectorName ? ` · w/ ${r.inspectorName}` : ""]
            })]
          }), /* @__PURE__ */ jsx("span", {
            className: `inline-flex items-center h-6 px-2 rounded text-[11px] font-bold uppercase tracking-[0.04em] shrink-0 ml-4 ${statusColor(r.status)}`,
            children: statusLabel(r.status)
          })]
        }, r.id))
      })]
    }, tenantName))]
  });
});
const route71 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: dashboard,
  loader: loader$3,
  meta: meta$4
}, Symbol.toStringTag, { value: "Module" }));
function meta$3() {
  return [{
    title: "Agent Settings - OpenInspection"
  }];
}
async function loader$2({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/profile", {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      agent: Object.keys(d).length > 0 ? d : {
        name: null,
        email: "",
        slug: null,
        notifyOnReferral: true,
        notifyOnReport: true,
        notifyOnPaid: false
      }
    };
  } catch {
    return {
      agent: {
        name: null,
        email: "",
        slug: null,
        notifyOnReferral: true,
        notifyOnReport: true,
        notifyOnPaid: false
      }
    };
  }
}
const settingsProfile = UNSAFE_withComponentProps(function AgentSettingsProfilePage() {
  const {
    agent
  } = useLoaderData();
  const [slug, setSlug] = useState(agent.slug || "");
  const previewLink = slug ? `https://*.inspectorhub.io/book/<slug>?ref=${slug}` : null;
  return /* @__PURE__ */ jsxs("div", {
    className: "max-w-2xl space-y-6",
    children: [/* @__PURE__ */ jsxs("div", {
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-[28px] font-bold tracking-tight text-slate-900 dark:text-white",
        children: "Settings"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[14px] text-ih-fg-3 mt-1",
        children: "Your public referral slug and the emails we send you."
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-xl p-6",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1",
        children: "Referral slug"
      }), /* @__PURE__ */ jsx("h2", {
        className: "text-sm font-bold text-ih-fg-1 mb-1",
        children: "Your referral link"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mb-4",
        children: "When you share a booking link with a client, this slug attributes the referral to you so the inspector knows where the client came from."
      }), /* @__PURE__ */ jsx("label", {
        htmlFor: "agentSlug",
        className: "block text-[12px] font-semibold text-ih-fg-3 mb-1.5",
        children: "Slug"
      }), /* @__PURE__ */ jsxs("div", {
        className: "flex gap-2",
        children: [/* @__PURE__ */ jsx("input", {
          id: "agentSlug",
          type: "text",
          value: slug,
          onChange: (e) => setSlug(e.target.value),
          placeholder: "jane",
          className: "flex-1 h-9 px-3 rounded-md border border-ih-border dark:bg-slate-700 dark:text-slate-100 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none text-[13px] font-medium placeholder:text-slate-400 transition-all"
        }), /* @__PURE__ */ jsx("button", {
          className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors uppercase tracking-wide",
          children: "Save slug"
        })]
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[12px] text-slate-400 mt-2",
        children: "Lowercase letters, numbers, and hyphens (3-32 chars)."
      }), previewLink && /* @__PURE__ */ jsx("div", {
        className: "mt-3 bg-ih-bg-app/40 rounded-md px-3 py-2 text-[12px] font-mono text-ih-fg-3 break-all",
        children: previewLink
      })]
    }), /* @__PURE__ */ jsxs("section", {
      className: "bg-ih-bg-card border border-ih-border rounded-xl p-6",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-1",
        children: "Notifications"
      }), /* @__PURE__ */ jsx("h2", {
        className: "text-sm font-bold text-ih-fg-1 mb-1",
        children: "Email me when..."
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 mb-4",
        children: "High-signal alerts default ON. Toggle off any you don't want."
      }), /* @__PURE__ */ jsxs("div", {
        className: "divide-y divide-slate-100 dark:divide-slate-700",
        children: [/* @__PURE__ */ jsx(ToggleRow, {
          title: "A new referral is booked",
          subtitle: "When a client books an inspection using your referral link.",
          defaultOn: agent.notifyOnReferral
        }), /* @__PURE__ */ jsx(ToggleRow, {
          title: "A report is ready to read",
          subtitle: "When the inspector publishes the report for one of your referrals.",
          defaultOn: agent.notifyOnReport
        }), /* @__PURE__ */ jsx(ToggleRow, {
          title: "An invoice is paid",
          subtitle: "When your client pays the inspection invoice.",
          defaultOn: agent.notifyOnPaid
        })]
      })]
    })]
  });
});
function ToggleRow({
  title,
  subtitle,
  defaultOn
}) {
  const [on, setOn] = useState(defaultOn);
  return /* @__PURE__ */ jsxs("div", {
    className: "flex items-center gap-4 py-3",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex-1 min-w-0",
      children: [/* @__PURE__ */ jsx("p", {
        className: "text-[13px] font-semibold text-ih-fg-1",
        children: title
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[12px] text-ih-fg-3 mt-0.5",
        children: subtitle
      })]
    }), /* @__PURE__ */ jsx("button", {
      onClick: () => setOn(!on),
      role: "switch",
      "aria-checked": on,
      className: `relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${on ? "bg-ih-ok-bg0" : "bg-ih-bg-muted"}`,
      children: /* @__PURE__ */ jsx("span", {
        className: `inline-block h-4 w-4 rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`
      })
    })]
  });
}
const route72 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: settingsProfile,
  loader: loader$2,
  meta: meta$3
}, Symbol.toStringTag, { value: "Module" }));
function meta$2() {
  return [{
    title: "Your Inspectors - OpenInspection"
  }];
}
async function loader$1({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/inspectors", {
      token
    });
    const body = res.ok ? await res.json() : {
      data: []
    };
    return {
      inspectors: body.data ?? []
    };
  } catch {
    return {
      inspectors: []
    };
  }
}
function initials(name) {
  var _a, _b, _c;
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return (((_a = parts[0]) == null ? void 0 : _a[0]) ?? "?").toUpperCase();
  return ((((_b = parts[0]) == null ? void 0 : _b[0]) ?? "") + (((_c = parts[parts.length - 1]) == null ? void 0 : _c[0]) ?? "")).toUpperCase();
}
const inspectors = UNSAFE_withComponentProps(function AgentInspectorsPage() {
  const {
    inspectors: inspectors2
  } = useLoaderData();
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-6",
    children: [/* @__PURE__ */ jsxs("div", {
      children: [/* @__PURE__ */ jsx("h1", {
        className: "text-[28px] font-bold tracking-tight text-slate-900 dark:text-white",
        children: "Your Inspectors"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[14px] text-ih-fg-3 mt-1",
        children: "Every team you partner with. Copy a booking link to share with clients."
      })]
    }), inspectors2.length === 0 ? /* @__PURE__ */ jsxs("div", {
      className: "bg-ih-bg-card border border-dashed border-ih-border-strong rounded-xl p-8 text-center",
      children: [/* @__PURE__ */ jsx("h3", {
        className: "text-lg font-bold text-slate-900 dark:text-white mb-2",
        children: "No inspectors linked yet"
      }), /* @__PURE__ */ jsx("p", {
        className: "text-[13px] text-ih-fg-3 max-w-md mx-auto",
        children: "Inspectors who invite you, or whose contact list already has your email, will appear here automatically."
      })]
    }) : /* @__PURE__ */ jsx("div", {
      className: "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4",
      children: inspectors2.map((row, i) => /* @__PURE__ */ jsxs("article", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-5 flex flex-col gap-4 hover:-translate-y-0.5 hover:shadow-lg transition-all",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-3",
          children: [row.inspectorPhotoUrl ? /* @__PURE__ */ jsx("img", {
            src: row.inspectorPhotoUrl,
            alt: row.inspectorName || "Inspector",
            className: "w-14 h-14 rounded-full object-cover shrink-0"
          }) : /* @__PURE__ */ jsx("span", {
            className: "w-14 h-14 rounded-full bg-ih-bg-muted flex items-center justify-center text-lg font-bold text-ih-fg-3 shrink-0",
            children: initials(row.inspectorName || row.tenantName)
          }), /* @__PURE__ */ jsxs("div", {
            className: "min-w-0",
            children: [/* @__PURE__ */ jsx("p", {
              className: "text-[15px] font-bold text-ih-fg-1 truncate",
              children: row.inspectorName || row.tenantName
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[11px] font-semibold text-slate-400 uppercase tracking-widest",
              children: row.tenantName
            })]
          })]
        }), row.inspectorSlug ? /* @__PURE__ */ jsx("button", {
          onClick: () => {
            const url = `https://${row.tenantSubdomain}.inspectorhub.io/book/${row.inspectorSlug}`;
            navigator.clipboard.writeText(url);
          },
          className: "w-full h-9 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors uppercase tracking-wide mt-auto",
          children: "Copy Booking Link"
        }) : /* @__PURE__ */ jsx("p", {
          className: "text-[12px] text-slate-400 mt-auto",
          children: "This inspector has not published a booking slug yet."
        })]
      }, row.inspectorSlug || i))
    })]
  });
});
const route73 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: inspectors,
  loader: loader$1,
  meta: meta$2
}, Symbol.toStringTag, { value: "Module" }));
function meta$1() {
  return [{
    title: "Recommendations - OpenInspection"
  }];
}
async function loader({
  request
}) {
  const token = await requireToken(request);
  try {
    const res = await apiFetch("/api/agent/my-recommendations", {
      token
    });
    const body = res.ok ? await res.json() : {};
    const d = body.data ?? {};
    return {
      groups: {
        safety: Array.isArray(d == null ? void 0 : d.safety) ? d.safety : [],
        recommendation: Array.isArray(d == null ? void 0 : d.recommendation) ? d.recommendation : [],
        maintenance: Array.isArray(d == null ? void 0 : d.maintenance) ? d.maintenance : []
      }
    };
  } catch {
    return {
      groups: {
        safety: [],
        recommendation: [],
        maintenance: []
      }
    };
  }
}
const GROUP_META = [{
  key: "safety",
  label: "Safety",
  color: "text-ih-bad-fg"
}, {
  key: "recommendation",
  label: "Recommendation",
  color: "text-ih-watch-fg"
}, {
  key: "maintenance",
  label: "Maintenance",
  color: "text-blue-700 dark:text-blue-400"
}];
const recommendations = UNSAFE_withComponentProps(function AgentRecommendationsPage() {
  const {
    groups
  } = useLoaderData();
  const total = groups.safety.length + groups.recommendation.length + groups.maintenance.length;
  return /* @__PURE__ */ jsxs("div", {
    className: "space-y-6",
    children: [/* @__PURE__ */ jsxs("div", {
      className: "flex items-start justify-between gap-4",
      children: [/* @__PURE__ */ jsxs("div", {
        children: [/* @__PURE__ */ jsx("h1", {
          className: "text-[28px] font-bold tracking-tight text-slate-900 dark:text-white",
          children: "Recommendations"
        }), /* @__PURE__ */ jsxs("p", {
          className: "text-[14px] text-ih-fg-3 mt-1",
          children: ["Every defect flagged in delivered inspection reports, grouped by category.", total > 0 && ` ${total} total items.`]
        })]
      }), /* @__PURE__ */ jsx("button", {
        onClick: () => window.print(),
        className: "h-9 px-4 rounded-md bg-ih-primary text-white font-bold text-[13px] hover:bg-ih-primary-600 transition-colors shrink-0",
        children: "Print as PDF"
      })]
    }), GROUP_META.map(({
      key,
      label,
      color
    }) => {
      const items = groups[key];
      return /* @__PURE__ */ jsxs("section", {
        className: "bg-ih-bg-card border border-ih-border rounded-xl p-5",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-baseline justify-between mb-4 pb-3 border-b border-slate-100 dark:border-slate-700",
          children: [/* @__PURE__ */ jsx("h2", {
            className: `text-lg font-bold ${color}`,
            children: label
          }), /* @__PURE__ */ jsxs("span", {
            className: "text-[11px] font-bold text-slate-400 uppercase tracking-widest",
            children: [items.length, " ", items.length === 1 ? "item" : "items"]
          })]
        }), items.length === 0 ? /* @__PURE__ */ jsxs("p", {
          className: "text-[13px] text-slate-400 py-2",
          children: ["No ", label.toLowerCase(), " items in your referred reports."]
        }) : /* @__PURE__ */ jsx("div", {
          className: "space-y-3",
          children: items.map((r, i) => /* @__PURE__ */ jsxs("div", {
            className: "p-4 border border-ih-border rounded-md bg-ih-bg-app/30",
            children: [/* @__PURE__ */ jsxs("p", {
              className: "text-[11px] font-mono text-slate-400 mb-1",
              children: [r.propertyAddress || "No address", " · ", r.sectionTitle]
            }), /* @__PURE__ */ jsx("p", {
              className: "text-[14px] font-semibold text-ih-fg-1",
              children: r.defectTitle
            }), r.location && /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3 mt-0.5",
              children: r.location
            }), r.comment && /* @__PURE__ */ jsx("p", {
              className: "text-[13px] text-ih-fg-3 mt-2 leading-relaxed",
              children: r.comment
            })]
          }, `${r.inspectionId}-${r.defectTitle}-${i}`))
        })]
      }, key);
    })]
  });
});
const route74 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  default: recommendations,
  loader,
  meta: meta$1
}, Symbol.toStringTag, { value: "Module" }));
function meta() {
  return [{
    title: "Become a partner agent - OpenInspection"
  }];
}
async function action({
  request
}) {
  const fd = await request.formData();
  const body = {
    name: fd.get("name"),
    email: fd.get("email"),
    password: fd.get("password"),
    turnstileToken: fd.get("cf-turnstile-response") || void 0
  };
  const res = await apiFetch("/api/agent-signup", {
    method: "POST",
    body: JSON.stringify(body),
    csrf: true
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.success) {
    const err = json.error;
    if ((err == null ? void 0 : err.code) === "conflict") {
      return {
        error: "That email is already registered. Sign in instead.",
        redirect: null
      };
    }
    return {
      error: (err == null ? void 0 : err.message) || "Could not create account",
      redirect: null
    };
  }
  const data = json.data;
  return {
    error: null,
    redirect: (data == null ? void 0 : data.redirect) || "/agent-dashboard"
  };
}
const VALUE_PROPS = [{
  num: "1",
  bold: "See every referred inspection.",
  text: "One dashboard, every inspector you work with."
}, {
  num: "2",
  bold: "Subscribe to availability.",
  text: "Calendar feeds keep the dates your inspectors are open in your own calendar app."
}, {
  num: "3",
  bold: "Free forever.",
  text: "No fees, no card on file. Your inspectors pay for the platform."
}];
const signup = UNSAFE_withComponentProps(function AgentSignupPage() {
  const actionData = useActionData();
  const [submitting, setSubmitting] = useState(false);
  if (typeof window !== "undefined" && (actionData == null ? void 0 : actionData.redirect)) {
    window.location.href = actionData.redirect;
  }
  return /* @__PURE__ */ jsxs("div", {
    className: "min-h-screen grid grid-cols-1 lg:grid-cols-2",
    children: [/* @__PURE__ */ jsxs("aside", {
      className: "relative flex flex-col justify-center px-8 py-12 lg:px-12 bg-slate-900 text-white overflow-hidden",
      children: [/* @__PURE__ */ jsx("div", {
        className: "absolute w-[480px] h-[480px] -right-[120px] -top-[160px] bg-ih-primary blur-[140px] opacity-35 pointer-events-none"
      }), /* @__PURE__ */ jsxs("div", {
        className: "relative z-10 max-w-[460px] mx-auto",
        children: [/* @__PURE__ */ jsxs("div", {
          className: "flex items-center gap-3 mb-12",
          children: [/* @__PURE__ */ jsx("img", {
            src: "/logo.svg",
            alt: "",
            className: "w-8 h-8"
          }), /* @__PURE__ */ jsx("span", {
            className: "font-serif font-bold text-lg tracking-tight",
            children: "OpenInspection"
          })]
        }), /* @__PURE__ */ jsx("h1", {
          className: "font-serif font-bold text-[2.75rem] leading-[1.05] tracking-tight mb-5",
          children: "Become a partner agent"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-base leading-relaxed text-stone-300 mb-8",
          children: "The free way for real-estate agents to track every inspection their inspectors completed for clients they referred."
        }), /* @__PURE__ */ jsx("ul", {
          className: "space-y-0",
          children: VALUE_PROPS.map((v) => /* @__PURE__ */ jsxs("li", {
            className: "flex gap-3.5 py-4 border-t border-white/[0.08] last:border-b",
            children: [/* @__PURE__ */ jsx("span", {
              className: "w-7 h-7 rounded-full bg-ih-primary text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
              children: v.num
            }), /* @__PURE__ */ jsxs("span", {
              className: "text-[15px] leading-relaxed text-stone-200",
              children: [/* @__PURE__ */ jsx("strong", {
                className: "text-white font-semibold",
                children: v.bold
              }), " ", v.text]
            })]
          }, v.num))
        })]
      })]
    }), /* @__PURE__ */ jsx("section", {
      className: "flex flex-col justify-center px-8 py-12 lg:px-12 bg-ih-bg-card",
      children: /* @__PURE__ */ jsxs("div", {
        className: "max-w-[420px] w-full mx-auto",
        children: [/* @__PURE__ */ jsx("h2", {
          className: "text-2xl font-bold tracking-tight mb-2 text-ih-fg-1",
          children: "Create your free account"
        }), /* @__PURE__ */ jsx("p", {
          className: "text-[15px] text-ih-fg-3 leading-relaxed mb-8",
          children: "Takes about a minute. Already invited? Use the link in your email instead -- it pre-fills the right tenant."
        }), /* @__PURE__ */ jsxs(Form, {
          method: "post",
          autoComplete: "off",
          onSubmit: () => setSubmitting(true),
          children: [/* @__PURE__ */ jsxs("div", {
            className: "space-y-5",
            children: [/* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                htmlFor: "name",
                className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
                children: "Full name"
              }), /* @__PURE__ */ jsx("input", {
                type: "text",
                id: "name",
                name: "name",
                placeholder: "Jane Smith",
                required: true,
                minLength: 2,
                className: "w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                htmlFor: "email",
                className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
                children: "Work email"
              }), /* @__PURE__ */ jsx("input", {
                type: "email",
                id: "email",
                name: "email",
                placeholder: "jane@realty.com",
                required: true,
                className: "w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
              })]
            }), /* @__PURE__ */ jsxs("div", {
              children: [/* @__PURE__ */ jsx("label", {
                htmlFor: "password",
                className: "block text-[13px] font-semibold text-ih-fg-3 mb-2",
                children: "Password"
              }), /* @__PURE__ */ jsx("input", {
                type: "password",
                id: "password",
                name: "password",
                placeholder: "At least 12 characters",
                required: true,
                minLength: 12,
                className: "w-full px-4 py-3 text-[15px] bg-ih-bg-card border border-ih-border rounded-xl outline-none focus:border-indigo-500 focus:shadow-ih-focus transition-all text-ih-fg-1"
              })]
            })]
          }), /* @__PURE__ */ jsx("button", {
            type: "submit",
            disabled: submitting,
            className: "w-full mt-7 px-6 py-3.5 text-[15px] font-semibold text-white bg-ih-primary rounded-xl hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity",
            children: submitting ? "Creating account..." : "Create account"
          }), (actionData == null ? void 0 : actionData.error) && /* @__PURE__ */ jsx("div", {
            className: "mt-4 px-4 py-3 rounded-lg bg-ih-bad-bg border border-ih-bad text-[14px] text-ih-bad-fg",
            children: actionData.error
          })]
        }), /* @__PURE__ */ jsxs("p", {
          className: "mt-6 text-[14px] text-ih-fg-3 text-center",
          children: ["Already have an account?", " ", /* @__PURE__ */ jsx(Link, {
            to: "/login",
            className: "text-ih-primary font-medium hover:underline",
            children: "Sign in"
          })]
        })]
      })
    })]
  });
});
const route75 = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  action,
  default: signup,
  meta
}, Symbol.toStringTag, { value: "Module" }));
const serverManifest = { "entry": { "module": "/assets/entry.client-BsDlLcZE.js", "imports": ["/assets/jsx-runtime-b4Ok1DgB.js", "/assets/chunk-4N6VE7H7-DUHpw1R5.js"], "css": [] }, "routes": { "root": { "id": "root", "parentId": void 0, "path": "", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": true, "module": "/assets/root-CoTaH2WD.js", "imports": ["/assets/jsx-runtime-b4Ok1DgB.js", "/assets/chunk-4N6VE7H7-DUHpw1R5.js"], "css": ["/assets/root-_7kVa_f-.css"], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/home": { "id": "routes/home", "parentId": "root", "path": void 0, "index": true, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/home-DwCMmUM_.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/login": { "id": "routes/login", "parentId": "root", "path": "login", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/login-nQtTpKLa.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/logout": { "id": "routes/logout", "parentId": "root", "path": "logout", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": false, "hasErrorBoundary": false, "module": "/assets/logout-l0sNRNKZ.js", "imports": [], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/inspection-edit": { "id": "routes/inspection-edit", "parentId": "root", "path": "inspections/:id/edit", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/inspection-edit-CpT_Zf-1.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/template-edit": { "id": "routes/template-edit", "parentId": "root", "path": "templates/:id/edit", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/template-edit-sNoEdRkU.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public-layout": { "id": "routes/public-layout", "parentId": "root", "path": void 0, "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/public-layout-BWlz41mN.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/booking": { "id": "routes/public/booking", "parentId": "routes/public-layout", "path": "book/:tenant/:slug", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/booking-DkyFeHE5.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/report": { "id": "routes/public/report", "parentId": "routes/public-layout", "path": "report/:tenant/:id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/report-Dq6vt9Mv.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/agreement-sign": { "id": "routes/public/agreement-sign", "parentId": "routes/public-layout", "path": "agreements/sign/:tenant/:token", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/agreement-sign-DwZMbnc8.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/invoice": { "id": "routes/public/invoice", "parentId": "routes/public-layout", "path": "r/:id/invoice", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/invoice-BZUJUSOD.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/verify": { "id": "routes/public/verify", "parentId": "routes/public-layout", "path": "verify/:envelopeId", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/verify-eW3_729p.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/observe": { "id": "routes/public/observe", "parentId": "routes/public-layout", "path": "observe/inspections/:id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/observe-BqGHNqQ0.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/concierge-book": { "id": "routes/public/concierge-book", "parentId": "routes/public-layout", "path": "concierge/book/:tenant/:slug", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/concierge-book-BL99zS9v.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/concierge-confirm": { "id": "routes/public/concierge-confirm", "parentId": "routes/public-layout", "path": "concierge/confirm", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/concierge-confirm-co69z_Lv.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/concierge-expired": { "id": "routes/public/concierge-expired", "parentId": "routes/public-layout", "path": "concierge/expired", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/concierge-expired-CpJlnHwZ.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/inspector-profile": { "id": "routes/public/inspector-profile", "parentId": "routes/public-layout", "path": "inspector/:tenant/:slug", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/inspector-profile-BgIZx8XX.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/inspector-not-found": { "id": "routes/public/inspector-not-found", "parentId": "routes/public-layout", "path": "inspector-not-found", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/inspector-not-found-CXDCcnZ2.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/report-gate": { "id": "routes/public/report-gate", "parentId": "routes/public-layout", "path": "report-gate/:tenant/:id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/report-gate-xxAxjXsp.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/report-card-stack": { "id": "routes/public/report-card-stack", "parentId": "routes/public-layout", "path": "report-view/:tenant/:id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/report-card-stack-Cqf2ubK2.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/messages": { "id": "routes/public/messages", "parentId": "routes/public-layout", "path": "messages/:token", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/messages-H1zfeiU9.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/repair-request": { "id": "routes/public/repair-request", "parentId": "routes/public-layout", "path": "r/:id/repair-request", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/repair-request-YkxPQO1N.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/agreement-printable": { "id": "routes/public/agreement-printable", "parentId": "routes/public-layout", "path": "agreements/print/:token", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/agreement-printable-MjIWDno2.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/setup": { "id": "routes/setup", "parentId": "root", "path": "setup", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/setup-DCcqnHXW.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/form-renderer": { "id": "routes/form-renderer", "parentId": "root", "path": "inspections/:id/form", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/form-renderer-BGhCUdBl.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/join": { "id": "routes/join", "parentId": "root", "path": "join/:token", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/join-1344fRAU.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/guest-join": { "id": "routes/guest-join", "parentId": "root", "path": "guest-join/:token", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/guest-join-Cj0ISaWr.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/conflict-resolver": { "id": "routes/conflict-resolver", "parentId": "root", "path": "conflict-resolver/:id", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/conflict-resolver-CXHEk_n2.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/version-diff": { "id": "routes/version-diff", "parentId": "root", "path": "version-diff/:id", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/version-diff-wVn6sx2k.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/public/booking-embed": { "id": "routes/public/booking-embed", "parentId": "root", "path": "embed/:tenant/:slug", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/booking-embed-sSi8ogHt.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/invite-accept": { "id": "routes/agent/invite-accept", "parentId": "root", "path": "agent-invite/:token", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/invite-accept-DvKelQpw.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/invite-expired": { "id": "routes/agent/invite-expired", "parentId": "root", "path": "agent-invite-expired", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/invite-expired-BUqepPfE.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/not-found": { "id": "routes/not-found", "parentId": "root", "path": "not-found", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/not-found-DSqNVOWc.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/feature-disabled": { "id": "routes/feature-disabled", "parentId": "root", "path": "feature-disabled", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/feature-disabled-CJsAlFLF.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/auth-layout": { "id": "routes/auth-layout", "parentId": "root", "path": void 0, "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/auth-layout-CiaUWJk1.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/useSessionContext-JQhCMuLv.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/dashboard": { "id": "routes/dashboard", "parentId": "routes/auth-layout", "path": "dashboard", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/dashboard-CGbquwVs.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/useSessionContext-JQhCMuLv.js", "/assets/SeatBanner-nI_Z6gq7.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/calendar": { "id": "routes/calendar", "parentId": "routes/auth-layout", "path": "calendar", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/calendar-DMLmVsrj.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/contacts": { "id": "routes/contacts", "parentId": "routes/auth-layout", "path": "contacts", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/contacts-jvZ7U8iM.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/invoices": { "id": "routes/invoices", "parentId": "routes/auth-layout", "path": "invoices", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/invoices-DVJEF9Zz.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Input-s8CWg-pL.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/notifications": { "id": "routes/notifications", "parentId": "routes/auth-layout", "path": "notifications", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/notifications-D_axpOK-.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Input-s8CWg-pL.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/templates": { "id": "routes/templates", "parentId": "routes/auth-layout", "path": "templates", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/templates-DgUJXMCb.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/team": { "id": "routes/team", "parentId": "routes/auth-layout", "path": "team", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/team-BusW0I6L.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SeatBanner-nI_Z6gq7.js", "/assets/useSessionContext-JQhCMuLv.js", "/assets/Button-C1es9Mae.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/metrics": { "id": "routes/metrics", "parentId": "routes/auth-layout", "path": "metrics", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/metrics-CR32TCf6.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Input-s8CWg-pL.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/apprentice-review": { "id": "routes/apprentice-review", "parentId": "routes/auth-layout", "path": "apprentice-review", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/apprentice-review-BF8ZNa4L.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Input-s8CWg-pL.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/reports": { "id": "routes/reports", "parentId": "routes/auth-layout", "path": "reports", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/reports-sax5-bqY.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-layout": { "id": "routes/settings-layout", "parentId": "routes/auth-layout", "path": void 0, "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-layout-D1ozTv0e.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Input-s8CWg-pL.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-hub": { "id": "routes/settings-hub", "parentId": "routes/settings-layout", "path": "settings", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-hub-C17k8efT.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-profile": { "id": "routes/settings-profile", "parentId": "routes/settings-layout", "path": "settings/profile", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-profile-XTyNeyt-.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-workspace": { "id": "routes/settings-workspace", "parentId": "routes/settings-layout", "path": "settings/workspace", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-workspace-Dc0Oa8U2.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-services": { "id": "routes/settings-services", "parentId": "routes/settings-layout", "path": "settings/services", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-services-CxKYD1Y9.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-communication": { "id": "routes/settings-communication", "parentId": "routes/settings-layout", "path": "settings/communication", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-communication-DPoiu3_x.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SecretField-CuWOkzQP.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-automations": { "id": "routes/settings-automations", "parentId": "routes/settings-layout", "path": "settings/automations", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-automations-BmLecmNz.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-data": { "id": "routes/settings-data", "parentId": "routes/settings-layout", "path": "settings/data", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-data-BglfZPV_.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-widget": { "id": "routes/settings-widget", "parentId": "routes/settings-layout", "path": "settings/widget", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-widget-Bw8tkw_H.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-account": { "id": "routes/settings-account", "parentId": "routes/settings-layout", "path": "settings/account", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-account-CKcrCis1.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-advanced": { "id": "routes/settings-advanced", "parentId": "routes/settings-layout", "path": "settings/advanced", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-advanced-DKKdYvAq.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SecretField-CuWOkzQP.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-integrations": { "id": "routes/settings-integrations", "parentId": "routes/settings-layout", "path": "settings/integrations", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-integrations-DGjPaFNG.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SecretField-CuWOkzQP.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-integrations-qbo": { "id": "routes/settings-integrations-qbo", "parentId": "routes/settings-layout", "path": "settings/integrations/qbo", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-integrations-qbo-DKWL9slA.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SecretField-CuWOkzQP.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-event-types": { "id": "routes/settings-event-types", "parentId": "routes/settings-layout", "path": "settings/event-types", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-event-types-DA3kSmLS.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-inspection-types": { "id": "routes/settings-inspection-types", "parentId": "routes/settings-layout", "path": "settings/inspection-types", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-inspection-types-C5_3Zf7u.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-catalog-booking": { "id": "routes/settings-catalog-booking", "parentId": "routes/settings-layout", "path": "settings/catalog/booking", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-catalog-booking-Cn8CAPCq.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-billing": { "id": "routes/settings-billing", "parentId": "routes/settings-layout", "path": "settings/billing", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-billing-BkP0nZgw.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-security": { "id": "routes/settings-security", "parentId": "routes/settings-layout", "path": "settings/security", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-security-C7rrTaPZ.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/SecretField-CuWOkzQP.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/settings-analytics": { "id": "routes/settings-analytics", "parentId": "routes/settings-layout", "path": "settings/analytics", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-analytics-B5alm7Qk.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/comments": { "id": "routes/comments", "parentId": "routes/auth-layout", "path": "comments", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/comments-DV7lvNd9.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/recommendations": { "id": "routes/recommendations", "parentId": "routes/auth-layout", "path": "recommendations", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/recommendations-D6QwZBmL.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/library/tags": { "id": "routes/library/tags", "parentId": "routes/auth-layout", "path": "library/tags", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/tags-BKoXbu9o.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Input-s8CWg-pL.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agreements": { "id": "routes/agreements", "parentId": "routes/auth-layout", "path": "agreements", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/agreements-DovVC5Lx.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/library/rating-systems": { "id": "routes/library/rating-systems", "parentId": "routes/auth-layout", "path": "library/rating-systems", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/rating-systems-CJ3lGwsu.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Input-s8CWg-pL.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/marketplace": { "id": "routes/marketplace", "parentId": "routes/auth-layout", "path": "marketplace", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/marketplace-BRafzWT9.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js", "/assets/Button-C1es9Mae.js", "/assets/Pill-Ccs8QiX-.js", "/assets/Input-s8CWg-pL.js", "/assets/TabStrip-BMVsoH-v.js", "/assets/EmptyState-DGCb1y5g.js", "/assets/Card-Bk3LzbEU.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent-layout": { "id": "routes/agent-layout", "parentId": "root", "path": void 0, "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/agent-layout-uJRjv5pd.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/dashboard": { "id": "routes/agent/dashboard", "parentId": "routes/agent-layout", "path": "agent-dashboard", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/dashboard-U8B1bp1H.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/settings-profile": { "id": "routes/agent/settings-profile", "parentId": "routes/agent-layout", "path": "agent-settings/profile", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/settings-profile-Dtz2LcvR.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/inspectors": { "id": "routes/agent/inspectors", "parentId": "routes/agent-layout", "path": "agent-inspectors", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/inspectors-Cq0Qhp7r.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/recommendations": { "id": "routes/agent/recommendations", "parentId": "routes/agent-layout", "path": "agent-recommendations", "index": void 0, "caseSensitive": void 0, "hasAction": false, "hasLoader": true, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/recommendations-BJFyzRgc.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 }, "routes/agent/signup": { "id": "routes/agent/signup", "parentId": "routes/agent-layout", "path": "agent-signup", "index": void 0, "caseSensitive": void 0, "hasAction": true, "hasLoader": false, "hasClientAction": false, "hasClientLoader": false, "hasClientMiddleware": false, "hasDefaultExport": true, "hasErrorBoundary": false, "module": "/assets/signup-B2TbJktr.js", "imports": ["/assets/chunk-4N6VE7H7-DUHpw1R5.js", "/assets/jsx-runtime-b4Ok1DgB.js"], "css": [], "clientActionModule": void 0, "clientLoaderModule": void 0, "clientMiddlewareModule": void 0, "hydrateFallbackModule": void 0 } }, "url": "/assets/manifest-50a01565.js", "version": "50a01565", "sri": void 0 };
const assetsBuildDirectory = "build\\client";
const basename = "/";
const future = { "unstable_optimizeDeps": false, "v8_passThroughRequests": false, "unstable_trailingSlashAwareDataRequests": false, "unstable_previewServerPrerendering": false, "v8_middleware": false, "v8_splitRouteModules": false, "v8_viteEnvironmentApi": false };
const ssr = true;
const isSpaMode = false;
const prerender = [];
const routeDiscovery = { "mode": "lazy", "manifestPath": "/__manifest" };
const publicPath = "/";
const entry = { module: entryServer };
const routes = {
  "root": {
    id: "root",
    parentId: void 0,
    path: "",
    index: void 0,
    caseSensitive: void 0,
    module: route0
  },
  "routes/home": {
    id: "routes/home",
    parentId: "root",
    path: void 0,
    index: true,
    caseSensitive: void 0,
    module: route1
  },
  "routes/login": {
    id: "routes/login",
    parentId: "root",
    path: "login",
    index: void 0,
    caseSensitive: void 0,
    module: route2
  },
  "routes/logout": {
    id: "routes/logout",
    parentId: "root",
    path: "logout",
    index: void 0,
    caseSensitive: void 0,
    module: route3
  },
  "routes/inspection-edit": {
    id: "routes/inspection-edit",
    parentId: "root",
    path: "inspections/:id/edit",
    index: void 0,
    caseSensitive: void 0,
    module: route4
  },
  "routes/template-edit": {
    id: "routes/template-edit",
    parentId: "root",
    path: "templates/:id/edit",
    index: void 0,
    caseSensitive: void 0,
    module: route5
  },
  "routes/public-layout": {
    id: "routes/public-layout",
    parentId: "root",
    path: void 0,
    index: void 0,
    caseSensitive: void 0,
    module: route6
  },
  "routes/public/booking": {
    id: "routes/public/booking",
    parentId: "routes/public-layout",
    path: "book/:tenant/:slug",
    index: void 0,
    caseSensitive: void 0,
    module: route7
  },
  "routes/public/report": {
    id: "routes/public/report",
    parentId: "routes/public-layout",
    path: "report/:tenant/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route8
  },
  "routes/public/agreement-sign": {
    id: "routes/public/agreement-sign",
    parentId: "routes/public-layout",
    path: "agreements/sign/:tenant/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route9
  },
  "routes/public/invoice": {
    id: "routes/public/invoice",
    parentId: "routes/public-layout",
    path: "r/:id/invoice",
    index: void 0,
    caseSensitive: void 0,
    module: route10
  },
  "routes/public/verify": {
    id: "routes/public/verify",
    parentId: "routes/public-layout",
    path: "verify/:envelopeId",
    index: void 0,
    caseSensitive: void 0,
    module: route11
  },
  "routes/public/observe": {
    id: "routes/public/observe",
    parentId: "routes/public-layout",
    path: "observe/inspections/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route12
  },
  "routes/public/concierge-book": {
    id: "routes/public/concierge-book",
    parentId: "routes/public-layout",
    path: "concierge/book/:tenant/:slug",
    index: void 0,
    caseSensitive: void 0,
    module: route13
  },
  "routes/public/concierge-confirm": {
    id: "routes/public/concierge-confirm",
    parentId: "routes/public-layout",
    path: "concierge/confirm",
    index: void 0,
    caseSensitive: void 0,
    module: route14
  },
  "routes/public/concierge-expired": {
    id: "routes/public/concierge-expired",
    parentId: "routes/public-layout",
    path: "concierge/expired",
    index: void 0,
    caseSensitive: void 0,
    module: route15
  },
  "routes/public/inspector-profile": {
    id: "routes/public/inspector-profile",
    parentId: "routes/public-layout",
    path: "inspector/:tenant/:slug",
    index: void 0,
    caseSensitive: void 0,
    module: route16
  },
  "routes/public/inspector-not-found": {
    id: "routes/public/inspector-not-found",
    parentId: "routes/public-layout",
    path: "inspector-not-found",
    index: void 0,
    caseSensitive: void 0,
    module: route17
  },
  "routes/public/report-gate": {
    id: "routes/public/report-gate",
    parentId: "routes/public-layout",
    path: "report-gate/:tenant/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route18
  },
  "routes/public/report-card-stack": {
    id: "routes/public/report-card-stack",
    parentId: "routes/public-layout",
    path: "report-view/:tenant/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route19
  },
  "routes/public/messages": {
    id: "routes/public/messages",
    parentId: "routes/public-layout",
    path: "messages/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route20
  },
  "routes/public/repair-request": {
    id: "routes/public/repair-request",
    parentId: "routes/public-layout",
    path: "r/:id/repair-request",
    index: void 0,
    caseSensitive: void 0,
    module: route21
  },
  "routes/public/agreement-printable": {
    id: "routes/public/agreement-printable",
    parentId: "routes/public-layout",
    path: "agreements/print/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route22
  },
  "routes/setup": {
    id: "routes/setup",
    parentId: "root",
    path: "setup",
    index: void 0,
    caseSensitive: void 0,
    module: route23
  },
  "routes/form-renderer": {
    id: "routes/form-renderer",
    parentId: "root",
    path: "inspections/:id/form",
    index: void 0,
    caseSensitive: void 0,
    module: route24
  },
  "routes/join": {
    id: "routes/join",
    parentId: "root",
    path: "join/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route25
  },
  "routes/guest-join": {
    id: "routes/guest-join",
    parentId: "root",
    path: "guest-join/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route26
  },
  "routes/conflict-resolver": {
    id: "routes/conflict-resolver",
    parentId: "root",
    path: "conflict-resolver/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route27
  },
  "routes/version-diff": {
    id: "routes/version-diff",
    parentId: "root",
    path: "version-diff/:id",
    index: void 0,
    caseSensitive: void 0,
    module: route28
  },
  "routes/public/booking-embed": {
    id: "routes/public/booking-embed",
    parentId: "root",
    path: "embed/:tenant/:slug",
    index: void 0,
    caseSensitive: void 0,
    module: route29
  },
  "routes/agent/invite-accept": {
    id: "routes/agent/invite-accept",
    parentId: "root",
    path: "agent-invite/:token",
    index: void 0,
    caseSensitive: void 0,
    module: route30
  },
  "routes/agent/invite-expired": {
    id: "routes/agent/invite-expired",
    parentId: "root",
    path: "agent-invite-expired",
    index: void 0,
    caseSensitive: void 0,
    module: route31
  },
  "routes/not-found": {
    id: "routes/not-found",
    parentId: "root",
    path: "not-found",
    index: void 0,
    caseSensitive: void 0,
    module: route32
  },
  "routes/feature-disabled": {
    id: "routes/feature-disabled",
    parentId: "root",
    path: "feature-disabled",
    index: void 0,
    caseSensitive: void 0,
    module: route33
  },
  "routes/auth-layout": {
    id: "routes/auth-layout",
    parentId: "root",
    path: void 0,
    index: void 0,
    caseSensitive: void 0,
    module: route34
  },
  "routes/dashboard": {
    id: "routes/dashboard",
    parentId: "routes/auth-layout",
    path: "dashboard",
    index: void 0,
    caseSensitive: void 0,
    module: route35
  },
  "routes/calendar": {
    id: "routes/calendar",
    parentId: "routes/auth-layout",
    path: "calendar",
    index: void 0,
    caseSensitive: void 0,
    module: route36
  },
  "routes/contacts": {
    id: "routes/contacts",
    parentId: "routes/auth-layout",
    path: "contacts",
    index: void 0,
    caseSensitive: void 0,
    module: route37
  },
  "routes/invoices": {
    id: "routes/invoices",
    parentId: "routes/auth-layout",
    path: "invoices",
    index: void 0,
    caseSensitive: void 0,
    module: route38
  },
  "routes/notifications": {
    id: "routes/notifications",
    parentId: "routes/auth-layout",
    path: "notifications",
    index: void 0,
    caseSensitive: void 0,
    module: route39
  },
  "routes/templates": {
    id: "routes/templates",
    parentId: "routes/auth-layout",
    path: "templates",
    index: void 0,
    caseSensitive: void 0,
    module: route40
  },
  "routes/team": {
    id: "routes/team",
    parentId: "routes/auth-layout",
    path: "team",
    index: void 0,
    caseSensitive: void 0,
    module: route41
  },
  "routes/metrics": {
    id: "routes/metrics",
    parentId: "routes/auth-layout",
    path: "metrics",
    index: void 0,
    caseSensitive: void 0,
    module: route42
  },
  "routes/apprentice-review": {
    id: "routes/apprentice-review",
    parentId: "routes/auth-layout",
    path: "apprentice-review",
    index: void 0,
    caseSensitive: void 0,
    module: route43
  },
  "routes/reports": {
    id: "routes/reports",
    parentId: "routes/auth-layout",
    path: "reports",
    index: void 0,
    caseSensitive: void 0,
    module: route44
  },
  "routes/settings-layout": {
    id: "routes/settings-layout",
    parentId: "routes/auth-layout",
    path: void 0,
    index: void 0,
    caseSensitive: void 0,
    module: route45
  },
  "routes/settings-hub": {
    id: "routes/settings-hub",
    parentId: "routes/settings-layout",
    path: "settings",
    index: void 0,
    caseSensitive: void 0,
    module: route46
  },
  "routes/settings-profile": {
    id: "routes/settings-profile",
    parentId: "routes/settings-layout",
    path: "settings/profile",
    index: void 0,
    caseSensitive: void 0,
    module: route47
  },
  "routes/settings-workspace": {
    id: "routes/settings-workspace",
    parentId: "routes/settings-layout",
    path: "settings/workspace",
    index: void 0,
    caseSensitive: void 0,
    module: route48
  },
  "routes/settings-services": {
    id: "routes/settings-services",
    parentId: "routes/settings-layout",
    path: "settings/services",
    index: void 0,
    caseSensitive: void 0,
    module: route49
  },
  "routes/settings-communication": {
    id: "routes/settings-communication",
    parentId: "routes/settings-layout",
    path: "settings/communication",
    index: void 0,
    caseSensitive: void 0,
    module: route50
  },
  "routes/settings-automations": {
    id: "routes/settings-automations",
    parentId: "routes/settings-layout",
    path: "settings/automations",
    index: void 0,
    caseSensitive: void 0,
    module: route51
  },
  "routes/settings-data": {
    id: "routes/settings-data",
    parentId: "routes/settings-layout",
    path: "settings/data",
    index: void 0,
    caseSensitive: void 0,
    module: route52
  },
  "routes/settings-widget": {
    id: "routes/settings-widget",
    parentId: "routes/settings-layout",
    path: "settings/widget",
    index: void 0,
    caseSensitive: void 0,
    module: route53
  },
  "routes/settings-account": {
    id: "routes/settings-account",
    parentId: "routes/settings-layout",
    path: "settings/account",
    index: void 0,
    caseSensitive: void 0,
    module: route54
  },
  "routes/settings-advanced": {
    id: "routes/settings-advanced",
    parentId: "routes/settings-layout",
    path: "settings/advanced",
    index: void 0,
    caseSensitive: void 0,
    module: route55
  },
  "routes/settings-integrations": {
    id: "routes/settings-integrations",
    parentId: "routes/settings-layout",
    path: "settings/integrations",
    index: void 0,
    caseSensitive: void 0,
    module: route56
  },
  "routes/settings-integrations-qbo": {
    id: "routes/settings-integrations-qbo",
    parentId: "routes/settings-layout",
    path: "settings/integrations/qbo",
    index: void 0,
    caseSensitive: void 0,
    module: route57
  },
  "routes/settings-event-types": {
    id: "routes/settings-event-types",
    parentId: "routes/settings-layout",
    path: "settings/event-types",
    index: void 0,
    caseSensitive: void 0,
    module: route58
  },
  "routes/settings-inspection-types": {
    id: "routes/settings-inspection-types",
    parentId: "routes/settings-layout",
    path: "settings/inspection-types",
    index: void 0,
    caseSensitive: void 0,
    module: route59
  },
  "routes/settings-catalog-booking": {
    id: "routes/settings-catalog-booking",
    parentId: "routes/settings-layout",
    path: "settings/catalog/booking",
    index: void 0,
    caseSensitive: void 0,
    module: route60
  },
  "routes/settings-billing": {
    id: "routes/settings-billing",
    parentId: "routes/settings-layout",
    path: "settings/billing",
    index: void 0,
    caseSensitive: void 0,
    module: route61
  },
  "routes/settings-security": {
    id: "routes/settings-security",
    parentId: "routes/settings-layout",
    path: "settings/security",
    index: void 0,
    caseSensitive: void 0,
    module: route62
  },
  "routes/settings-analytics": {
    id: "routes/settings-analytics",
    parentId: "routes/settings-layout",
    path: "settings/analytics",
    index: void 0,
    caseSensitive: void 0,
    module: route63
  },
  "routes/comments": {
    id: "routes/comments",
    parentId: "routes/auth-layout",
    path: "comments",
    index: void 0,
    caseSensitive: void 0,
    module: route64
  },
  "routes/recommendations": {
    id: "routes/recommendations",
    parentId: "routes/auth-layout",
    path: "recommendations",
    index: void 0,
    caseSensitive: void 0,
    module: route65
  },
  "routes/library/tags": {
    id: "routes/library/tags",
    parentId: "routes/auth-layout",
    path: "library/tags",
    index: void 0,
    caseSensitive: void 0,
    module: route66
  },
  "routes/agreements": {
    id: "routes/agreements",
    parentId: "routes/auth-layout",
    path: "agreements",
    index: void 0,
    caseSensitive: void 0,
    module: route67
  },
  "routes/library/rating-systems": {
    id: "routes/library/rating-systems",
    parentId: "routes/auth-layout",
    path: "library/rating-systems",
    index: void 0,
    caseSensitive: void 0,
    module: route68
  },
  "routes/marketplace": {
    id: "routes/marketplace",
    parentId: "routes/auth-layout",
    path: "marketplace",
    index: void 0,
    caseSensitive: void 0,
    module: route69
  },
  "routes/agent-layout": {
    id: "routes/agent-layout",
    parentId: "root",
    path: void 0,
    index: void 0,
    caseSensitive: void 0,
    module: route70
  },
  "routes/agent/dashboard": {
    id: "routes/agent/dashboard",
    parentId: "routes/agent-layout",
    path: "agent-dashboard",
    index: void 0,
    caseSensitive: void 0,
    module: route71
  },
  "routes/agent/settings-profile": {
    id: "routes/agent/settings-profile",
    parentId: "routes/agent-layout",
    path: "agent-settings/profile",
    index: void 0,
    caseSensitive: void 0,
    module: route72
  },
  "routes/agent/inspectors": {
    id: "routes/agent/inspectors",
    parentId: "routes/agent-layout",
    path: "agent-inspectors",
    index: void 0,
    caseSensitive: void 0,
    module: route73
  },
  "routes/agent/recommendations": {
    id: "routes/agent/recommendations",
    parentId: "routes/agent-layout",
    path: "agent-recommendations",
    index: void 0,
    caseSensitive: void 0,
    module: route74
  },
  "routes/agent/signup": {
    id: "routes/agent/signup",
    parentId: "routes/agent-layout",
    path: "agent-signup",
    index: void 0,
    caseSensitive: void 0,
    module: route75
  }
};
const allowedActionOrigins = false;
export {
  allowedActionOrigins,
  serverManifest as assets,
  assetsBuildDirectory,
  basename,
  entry,
  future,
  isSpaMode,
  prerender,
  publicPath,
  routeDiscovery,
  routes,
  ssr
};
