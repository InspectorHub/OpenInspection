import { useMemo, useRef, type ReactNode } from "react";
import { useLoaderData, useNavigate, useRevalidator } from "react-router";
import { FieldDataSourceProvider } from "@core/field-ui/context";
import type { EditorData, FieldHostSlots } from "@core/field-ui/data-source";
import { useEnsureHuman } from "~/components/OutboundVerification";
import { ThemeSegmentControl } from "~/components/sidebar/ThemeSegmentControl";
import { WebUnsavedGuard } from "~/components/field/WebUnsavedGuard";
import { pdfActionLabel, usePdfExport } from "~/hooks/usePdfExport";
import { useSessionContext } from "~/hooks/useSessionContext";
import type { loader } from "~/routes/inspection-edit/loader.server";
import { createWebFieldDataSource } from "~/lib/field/web-data-source";
import { editorDataFromLoader, type EditorLoaderData } from "~/lib/field/web-editor-data";
import { createWebUrls } from "~/lib/field/web-urls";
import type { SessionLoaderBits } from "~/lib/field/web-session";
import { rememberEditorLayout } from "~/lib/field/editor-layout-cookie";

const NO_EDITOR_BITS: SessionLoaderBits = {
    tenantSlug: null,
    videoProvider: "r2",
    streamCustomerSubdomain: null,
    collabEditing: false,
};

function bitsOf(editor: EditorLoaderData | null): SessionLoaderBits {
    if (editor === null) return NO_EDITOR_BITS;
    return {
        tenantSlug: editor.tenantSlug,
        videoProvider: editor.videoProvider,
        streamCustomerSubdomain: editor.streamCustomerSubdomain,
        collabEditing: editor.collabEditing,
    };
}

export interface WebFieldHostProps {
    /** The inspection editor's loader payload; null on a host with no inspection (the template editor). */
    editor: EditorLoaderData | null;
    children?: ReactNode;
}

/**
 * Mounts `FieldDataSourceProvider` for a web editor route. The converted hooks in the package
 * (presence, scope loading, preferences) read it; unconverted components do not.
 *
 * The data source is built ONCE per mount. Everything that changes between renders (loader data,
 * the router's navigate and revalidator, the session context, PDF export state) is read through
 * refs, so the data source keeps its identity and consumers never resubscribe because the loader
 * revalidated. Nothing browser-only runs during render or construction.
 */
export function WebFieldHost({ editor, children }: WebFieldHostProps) {
    const navigate = useNavigate();
    const revalidator = useRevalidator();
    const sessionContext = useSessionContext();
    const pdf = usePdfExport();
    // On a host with no human check mounted the context's default answers true at once.
    const ensureHuman = useEnsureHuman();

    // Refs are refreshed during render on purpose (as `useKeyboard` does): an effect would run
    // after a child's effect, and a child calling `load()` there would read the previous payload.
    const editorRef = useRef(editor);
    editorRef.current = editor;
    const navigateRef = useRef(navigate);
    navigateRef.current = navigate;
    const revalidatorRef = useRef(revalidator);
    revalidatorRef.current = revalidator;
    const sessionRef = useRef(sessionContext);
    sessionRef.current = sessionContext;
    const pdfRef = useRef(pdf);
    pdfRef.current = pdf;
    const ensureHumanRef = useRef(ensureHuman);
    ensureHumanRef.current = ensureHuman;
    const { busy, error, generating, cooldown } = pdf;

    const dataSource = useMemo(() => {
        let cached: { from: EditorLoaderData; data: EditorData } | null = null;
        return createWebFieldDataSource({
            current: () => {
                const from = editorRef.current;
                if (from === null) return null;
                if (cached === null || cached.from !== from) cached = { from, data: editorDataFromLoader(from) };
                return cached.data;
            },
            sessionBits: () => bitsOf(editorRef.current),
            sessionContext: () => sessionRef.current ?? editorRef.current?.viewer ?? null,
            reload: () => {
                void revalidatorRef.current.revalidate();
            },
            exit: () => {
                void navigateRef.current("/inspections");
            },
        });
    }, []);

    const slots = useMemo<FieldHostSlots>(
        () => ({
            renderThemeControl: ({ className }) => <ThemeSegmentControl className={className} />,
            pdf: {
                run: (inspectionId) => {
                    const url = createWebUrls().reportPdf(inspectionId);
                    if (url !== null) void pdfRef.current.exportPdf(url, { mode: "view", filename: `report-${inspectionId}.pdf` });
                },
                busy,
                error,
                actionLabel: (defaultLabel) => pdfActionLabel({ generating, cooldown }, defaultLabel),
            },
            // The same check `EditorHumanCheck` mounts around the editor; read through a ref so the slot keeps its identity.
            ensureHuman: () => ensureHumanRef.current(),
            renderUnsavedGuard: ({ atRisk }) => <WebUnsavedGuard atRisk={atRisk} />,
            // Remembered per device so the next load can render this band on the server (editor-layout-cookie.ts).
            onLayoutObserved: (layout) => rememberEditorLayout(layout),
        }),
        [busy, error, generating, cooldown],
    );

    return (
        <FieldDataSourceProvider dataSource={dataSource} slots={slots}>
            {children}
        </FieldDataSourceProvider>
    );
}

/** The inspection editor's host: reads the route's own loader payload. */
export function InspectionFieldHost({ children }: { children?: ReactNode }) {
    return <WebFieldHost editor={useLoaderData<typeof loader>()}>{children}</WebFieldHost>;
}

/** The template editor's host: the same data source with no inspection behind it. */
export function TemplateFieldHost({ children }: { children?: ReactNode }) {
    return <WebFieldHost editor={null}>{children}</WebFieldHost>;
}
