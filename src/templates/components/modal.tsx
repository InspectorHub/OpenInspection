/**
 * Unified Modal component.
 *
 * One canonical shape for every page-level modal in apps/core. Matches the
 * Round 38 / 39 design language: backdrop bg-black/40, white card with
 * rounded-md, h-10 button row, normal-case copy.
 *
 * Two driver modes:
 *   - Alpine: pass `name="showXxxModal"`. The component wires x-show + click-
 *     outside + Esc-to-close to that state name.
 *   - Static (id-based JS toggle): pass `id="xxxModal"`. The element starts
 *     `hidden`; consumer JS calls `el.classList.remove('hidden')` to open
 *     and `.add('hidden')` to close. Click-outside / Esc still close it via
 *     a tiny inline script attached per-instance.
 *
 * Pass exactly one of `name` or `id`. The body slot is `children`. The
 * footer slot is the optional `footer` prop — pass `<ModalFooter>` for the
 * canonical Cancel + Confirm row, or any JSX for non-standard layouts.
 */

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '5xl';

const SIZE_CLASS: Record<ModalSize, string> = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
    '2xl': 'max-w-2xl',
    '3xl': 'max-w-3xl',
    '5xl': 'max-w-5xl',
};

interface ModalProps {
    /** Alpine state variable name (e.g. `showPublishModal`). Mutually exclusive with `id`. */
    name?: string;
    /** DOM id for JS-toggled modals (e.g. `createModal`). Mutually exclusive with `name`. */
    id?: string;
    /** Title (h2). Optional only if you build the header yourself in `children`. */
    title?: string;
    /** Optional static subtitle under the title. */
    subtitle?: string;
    /** Alpine x-text expression for a dynamic subtitle (overrides `subtitle`). */
    subtitleExpr?: string;
    /** Alpine x-text expression for a dynamic title (overrides `title` when present). */
    titleExpr?: string;
    /** Body width preset. Default `md`. */
    size?: ModalSize;
    /** Body slot. */
    children: unknown;
    /** Footer slot (button row). Omit if your body has its own footer. */
    footer?: unknown;
    /** Hide the default close (X) button in the header (rare — e.g. when no header is rendered). */
    hideClose?: boolean;
    /** Hide the rendered header entirely (if you want full custom body). */
    hideHeader?: boolean;
}

/**
 * Build the close-action expression for the chosen driver.
 * Alpine mode: `<name> = false`.
 * Static mode: walks up to the modal root and toggles `.hidden`.
 */
function closeExpr(name: string | undefined, id: string | undefined): { close: string; clickOutside: string; escape: string } {
    if (name) {
        return {
            close: `${name} = false`,
            clickOutside: `if ($event.target === $el) ${name} = false`,
            escape: `${name} = false`,
        };
    }
    // Static mode: find the modal root by id and toggle .hidden
    const sel = `document.getElementById('${id}')`;
    return {
        close: `${sel}?.classList.add('hidden')`,
        clickOutside: `if (event.target === this) ${sel}?.classList.add('hidden')`,
        escape: `${sel}?.classList.add('hidden')`,
    };
}

export const Modal = ({
    name,
    id,
    title,
    titleExpr,
    subtitle,
    subtitleExpr,
    size = 'md',
    children,
    footer,
    hideClose = false,
    hideHeader = false,
}: ModalProps): JSX.Element => {
    const { close, clickOutside, escape } = closeExpr(name, id);

    // Backdrop attributes vary by driver mode.
    const backdropClass = `fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4${id ? ' hidden overflow-y-auto' : ''}`;

    const alpineAttrs: Record<string, unknown> = name
        ? {
              'x-show': name,
              'x-cloak': true,
              'x-transition.opacity': '',
              'x-on:click': clickOutside,
              'x-on:keydown.escape.window': escape,
          }
        : {
              // Static-mode: bind close behaviour via plain DOM events.
              onclick: clickOutside,
          };

    return (
        <div
            {...(id ? { id } : {})}
            class={backdropClass}
            role="dialog"
            aria-modal="true"
            {...alpineAttrs}
        >
            <div
                class={`bg-white rounded-md shadow-xl w-full ${SIZE_CLASS[size]} p-6 max-h-[90vh] overflow-y-auto`}
                {...(name ? { 'x-on:click.stop': '' } : { onclick: 'event.stopPropagation()' })}
            >
                {!hideHeader && (
                    <header class="flex items-start justify-between gap-3 mb-4">
                        <div class="min-w-0 flex-1">
                            {titleExpr ? (
                                <h2 class="text-lg font-bold text-slate-900 truncate" x-text={titleExpr} />
                            ) : title ? (
                                <h2 class="text-lg font-bold text-slate-900 truncate">{title}</h2>
                            ) : null}
                            {subtitleExpr ? (
                                <p class="text-sm text-slate-500 mt-0.5" x-text={subtitleExpr} />
                            ) : subtitle ? (
                                <p class="text-sm text-slate-500 mt-0.5">{subtitle}</p>
                            ) : null}
                        </div>
                        {!hideClose && (
                            <button
                                type="button"
                                aria-label="Close dialog"
                                class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 flex-shrink-0"
                                {...(name ? { 'x-on:click': close } : { onclick: close })}
                            >
                                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </header>
                )}
                <div>{children}</div>
                {footer ? <div class="mt-6 flex gap-3 justify-end">{footer}</div> : null}
            </div>
        </div>
    );
};

interface ModalFooterProps {
    cancelText?: string;
    confirmText?: string;
    /** Alpine expression for confirm action (Alpine mode only). */
    onConfirm?: string;
    /** Plain JS expression for confirm action (static mode). */
    onConfirmJs?: string;
    /** Alpine expression returning a boolean (e.g. `saving`). */
    confirmDisabled?: string;
    /** Alpine expression for cancel action. Defaults to closing the modal. */
    onCancel?: string;
    /** Plain JS expression for cancel action (static mode). */
    onCancelJs?: string;
    /** Optional id for the confirm button (some pages query it via getElementById). */
    confirmId?: string;
    /** Make the Confirm button visually destructive (rose) instead of indigo. */
    danger?: boolean;
    /** Override Confirm button text via x-text expression (e.g. `saving ? 'Saving…' : 'Save'`). */
    confirmTextExpr?: string;
}

/**
 * Canonical modal footer button row. Cancel (white + border) + Confirm
 * (indigo solid, or rose if danger). Both `flex-1 h-10 px-4 rounded-xl
 * text-sm font-semibold`. Use this for 90% of modals; for >2 buttons or
 * unusual layouts, inline custom JSX directly into Modal's `footer` slot.
 */
export const ModalFooter = ({
    cancelText = 'Cancel',
    confirmText = 'Confirm',
    onConfirm,
    onConfirmJs,
    confirmDisabled,
    onCancel,
    onCancelJs,
    confirmId,
    danger = false,
    confirmTextExpr,
}: ModalFooterProps): JSX.Element => {
    const cancelAttrs: Record<string, unknown> = onCancel
        ? { 'x-on:click': onCancel }
        : onCancelJs
        ? { onclick: onCancelJs }
        : {};

    const confirmAttrs: Record<string, unknown> = {};
    if (onConfirm) confirmAttrs['x-on:click'] = onConfirm;
    if (onConfirmJs) confirmAttrs['onclick'] = onConfirmJs;
    if (confirmDisabled) confirmAttrs['x-bind:disabled'] = confirmDisabled;
    if (confirmId) confirmAttrs['id'] = confirmId;

    const confirmBg = danger
        ? 'bg-rose-600 hover:bg-rose-700'
        : 'bg-indigo-600 hover:bg-indigo-700';

    return (
        <>
            <button
                type="button"
                class="flex-1 h-10 px-4 rounded-xl border bg-white text-slate-600 text-sm font-semibold hover:bg-slate-50 transition-all"
                style="border-color: #e2e8f0"
                {...cancelAttrs}
            >
                {cancelText}
            </button>
            <button
                type="button"
                class={`flex-1 h-10 px-4 rounded-xl ${confirmBg} text-white text-sm font-semibold disabled:opacity-50 transition-all`}
                {...confirmAttrs}
            >
                {confirmTextExpr ? <span x-text={confirmTextExpr} /> : confirmText}
            </button>
        </>
    );
};
