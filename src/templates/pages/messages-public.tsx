// src/templates/pages/messages-public.tsx
import { BareLayout } from '../layouts/main-layout';
import type { BrandingConfig } from '../../types/auth';

interface MessagesPublicProps {
    token: string;
    branding?: BrandingConfig | undefined;
}

export function MessagesPublicPage({ token, branding }: MessagesPublicProps) {
    const siteName = branding?.siteName || 'OpenInspection';
    return BareLayout({
        title: `${siteName} | Messages`,
        branding,
        children: (
            <div class="min-h-screen bg-slate-50">
                <div class="max-w-2xl mx-auto py-8 px-4" x-data={`messagesPublic('${token}')`} x-init="init()">
                    <h1 class="text-2xl font-bold mb-2 text-slate-900">Messages</h1>
                    <p x-show="inspection" class="text-sm text-slate-500 mb-6">
                        Inspection: <span x-text="inspection?.propertyAddress"></span>
                    </p>
                    <div class="space-y-3 max-h-[60vh] overflow-y-auto mb-4">
                        <template x-for="m in messages" x-bind:key="m.id">
                            <div x-bind:class="m.fromRole === 'client' ? 'ml-12 bg-indigo-50' : 'mr-12 bg-amber-50'" class="rounded-md p-3">
                                <div class="text-xs text-slate-500 mb-1" x-text="(m.fromName || m.fromRole) + ' · ' + new Date(m.createdAt).toLocaleString()"></div>
                                <p class="text-sm whitespace-pre-wrap text-slate-900" x-text="m.body"></p>
                                <div x-show="m.attachments && m.attachments.length" class="mt-2 flex flex-wrap gap-2">
                                    <template x-for="a in (m.attachments || [])" x-bind:key="a.id">
                                        <a x-bind:href="'/api/photos/' + encodeURIComponent(a.key)" target="_blank"
                                           class="text-xs bg-white border border-slate-200 rounded-lg px-2 py-1 hover:bg-slate-50" x-text="a.name"></a>
                                    </template>
                                </div>
                            </div>
                        </template>
                        <div x-show="messages.length === 0" class="ih-empty-state"><h3 class="ih-empty-state__title">No messages yet</h3><p class="ih-empty-state__subline">Send the first one below.</p></div>
                    </div>
                    <div class="border-t border-slate-200 pt-3 bg-white p-4 rounded-md">
                        <textarea x-model="composeBody" rows={3} placeholder="Type your message..." class="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none"></textarea>
                        <div class="mt-2 flex flex-wrap gap-2">
                            <template x-for="(a, i) in pendingAttachments" x-bind:key="a.id">
                                <span class="text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg px-2 py-1 flex items-center gap-1">
                                    <span x-text="a.name"></span>
                                    <button x-on:click="pendingAttachments.splice(i,1)" class="text-rose-500">×</button>
                                </span>
                            </template>
                        </div>
                        <div class="mt-2 flex items-center justify-between">
                            <label class="cursor-pointer text-sm text-slate-600 hover:text-indigo-600 inline-flex items-center gap-1">
                                <span>📎</span> <span class="text-xs">Attach</span>
                                <input type="file" multiple class="hidden" x-on:change="upload($event.target.files)" />
                            </label>
                            <button x-on:click="send()" x-bind:disabled="!composeBody || sending"
                                class="px-4 py-2 rounded-xl bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">
                                <span x-text="sending ? 'Sending...' : 'Send'"></span>
                            </button>
                        </div>
                    </div>
                </div>
                <script src="/js/messages-public.js"></script>
            </div>
        ),
    });
}
