/**
 * Design System 0520 subsystem B phase 7 task 7.1 — TeamStrip.
 *
 * Dashboard component visible when the tenant has 2+ inspectors. Shows a
 * roster grid with each member's online/offline status (live via the
 * TenantPresenceClient WebSocket) and a "last active Nm ago" fallback
 * for offline members (drawn from users.last_active_at — see subsystem
 * B phase 1 task 1.2 touch-last-active middleware).
 *
 * State + WS connection live in window.teamStrip() Alpine factory
 * (public/js/team-strip.js). The factory degrades gracefully:
 *   - /api/team/members 404 / 403 → hide the strip
 *   - WS connect fails → all members show offline + last-active timestamp
 */

export function TeamStrip(): JSX.Element {
    return (
        <div
            x-data="teamStrip()"
            x-show="members.length > 1"
            x-cloak
            class="ih-card p-4 mb-4 bg-white border border-slate-200"
        >
            <div class="flex items-center justify-between mb-3">
                <div class="flex items-center gap-3">
                    <h3 class="ih-eyebrow">Team today</h3>
                    <span class="ih-meta">
                        <span x-text="onlineCount"></span> online · <span x-text="members.length"></span> total
                    </span>
                </div>
                <a href="/team" class="ih-btn ih-btn--sm ih-btn--ghost">Manage team →</a>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <template x-for="m in members" x-bind:key="m.id">
                    <div class="flex items-center gap-3 p-2 rounded border border-slate-100">
                        <div class="relative shrink-0">
                            <div
                                class="w-9 h-9 rounded-full bg-slate-300 flex items-center justify-center text-xs font-bold text-slate-700"
                                x-text="(m.name || m.email || '?').slice(0,2).toUpperCase()"
                            ></div>
                            <span
                                class="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white"
                                x-bind:class="m.online ? 'bg-emerald-500' : 'bg-slate-300'"
                                aria-hidden="true"
                            ></span>
                        </div>
                        <div class="min-w-0 flex-1">
                            <div class="text-sm font-medium truncate" x-text="m.name || m.email"></div>
                            <div class="ih-meta">
                                <span x-show="m.online" class="text-emerald-600">Online</span>
                                <span x-show="!m.online && m.lastSeenRel" x-text="`last active ${m.lastSeenRel}`"></span>
                                <span x-show="!m.online && !m.lastSeenRel">Offline</span>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    );
}
