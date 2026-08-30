/**
 * #348 — the import-conflict page.
 *
 * A publisher ships v2 of a comment library. Some of the comments the inspector
 * imported from v1 are no longer the publisher's words: they were rewritten into
 * the inspector's own voice, citing their state's code and their local climate,
 * on an evening nobody paid for, and they go out on reports a client paid for.
 *
 * So the page is built around those sentences rather than around the choice. The
 * rewrites ARE the body of the page, each beside the publisher's version, and
 * the two options sit underneath them — because the decision should be made
 * looking at what is at stake, not at a count. "7" is abstract; the sentence you
 * wrote is not.
 *
 * There is no confirmation dialog. Choosing to replace everything strikes those
 * comments through and turns them `ih-bad` on the spot: a dialog collects a
 * signature afterwards, this shows the bill beforehand.
 */
import { useState } from "react";
import { Form, redirect, useActionData, useLoaderData, useNavigate, useNavigation } from "react-router";
import type { Route } from "./+types/marketplace-update";
import { requireToken } from "~/lib/session.server";
import { createApi } from "~/lib/api-client.server";
import { Banner, Button, Card, EmptyState, PageHeader, RadioCardGroup } from "@core/shared-ui";
import { Breadcrumb } from "~/components/Breadcrumb";
import { EditedCommentPair, type EditedCommentPairData } from "~/components/marketplace/EditedCommentPair";
import { useDisplayLocale } from "~/hooks/useSessionContext";
import { m } from "~/paraglide/messages";

export function meta() {
  return [{ title: m.marketplace_update_meta_title() }];
}

interface Preview {
  libraryId: string;
  libraryName: string;
  fromSemver: string;
  toSemver: string;
  total: number;
  publisherChanged: number;
  edited: number;
  pairs: EditedCommentPairData[];
}

/** The replace endpoints are not on the typed client surface; reach them the way the other marketplace action routes do. */
type ReplaceClient = {
  libraries: {
    [":libraryId"]: {
      imports: {
        replace: {
          $post: (args: { param: { libraryId: string }; json: { confirmLossOfEdits: boolean } }) => Promise<Response>;
          preview: { $get: (args: { param: { libraryId: string } }) => Promise<Response> };
        };
      };
    };
  };
};

export async function loader({ request, context, params }: Route.LoaderArgs) {
  // No deployment gate, matching the marketplace page this is reached from: the
  // catalogue exists in every mode, so an update to review can exist in every
  // mode. The refusals that remain are about this workspace and this entry (not
  // imported, already current, wrong kind) and the API answers them below.
  const token = await requireToken(context, request);
  const api = createApi(context, { token }) as unknown as { marketplace: ReplaceClient };
  const res = await api.marketplace.libraries[":libraryId"].imports.replace.preview.$get({
    param: { libraryId: params.libraryId },
  });
  if (!res.ok) {
    // The API refuses a preview for exactly the cases where there is no update
    // to make (not imported, already current, wrong kind). Sending the reader
    // back to the catalogue beats rendering a page about nothing.
    throw new Response("Not Found", { status: 404 });
  }
  const body = (await res.json()) as { data: Preview };
  return { preview: body.data };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const token = await requireToken(context, request);
  const form = await request.formData();
  const confirmLossOfEdits = form.get("choice") === "replace";

  const api = createApi(context, { token }) as unknown as { marketplace: ReplaceClient };
  const res = await api.marketplace.libraries[":libraryId"].imports.replace.$post({
    param: { libraryId: params.libraryId },
    json: { confirmLossOfEdits },
  });
  if (!res.ok) return { ok: false as const };
  // Nothing on this page describes the state the update produced, so send the
  // reader to the library it just changed rather than re-rendering the choice.
  return redirect("/library/comments");
}

export default function MarketplaceUpdatePage() {
  const { preview } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const navigate = useNavigate();
  const locale = useDisplayLocale();

  // Keeping is the default. The destructive option has to be reached for.
  const [choice, setChoice] = useState<"keep" | "replace">("keep");
  const replacing = choice === "replace";
  const submitting = navigation.state === "submitting";

  const untouched = preview.total - preview.edited;
  const crumbs = [
    { label: m.library_layout_title(), href: "/library" },
    { label: m.marketplace_heading(), href: "/library/marketplace" },
    { label: m.marketplace_update_breadcrumb() },
  ];

  // Nothing was rewritten: there is no decision to put in front of anyone, and
  // manufacturing one out of a clean update is its own kind of dishonesty.
  if (preview.pairs.length === 0) {
    return (
      <div className="space-y-ih-list">
        <Breadcrumb items={crumbs} />
        <PageHeader title={preview.libraryName} meta={m.marketplace_update_eyebrow({ fromSemver: preview.fromSemver, toSemver: preview.toSemver })} />
        {actionData?.ok === false && <Banner tone="danger">{m.marketplace_update_error()}</Banner>}
        <Card>
          <EmptyState
            title={m.marketplace_update_clean_title()}
            description={m.marketplace_update_clean_desc({ total: preview.total, semver: preview.toSemver })}
          />
          <div className="px-4 pb-4">
            <Form method="post">
              <input type="hidden" name="choice" value="keep" />
              <Button type="submit" variant="primary" disabled={submitting}>
                {submitting ? m.marketplace_update_submitting() : m.marketplace_update_clean_submit({ semver: preview.toSemver })}
              </Button>
            </Form>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-ih-list">
      <Breadcrumb items={crumbs} />
      <PageHeader
        title={preview.libraryName}
        meta={m.marketplace_update_eyebrow({ fromSemver: preview.fromSemver, toSemver: preview.toSemver })}
      />

      {actionData?.ok === false && <Banner tone="danger">{m.marketplace_update_error()}</Banner>}

      {/* One sentence. The counts are here so they never have to be repeated. */}
      <p className="font-ih-display text-[19px] leading-snug text-ih-fg-1 max-w-[62ch]">
        {m.marketplace_update_summary({
          changed: preview.publisherChanged,
          total:   preview.total,
          edited:  preview.edited,
        })}
      </p>

      {/* The body of the page: their words, one pair per rewrite. */}
      <section aria-labelledby="rewrites-heading" className="space-y-3">
        <h2 id="rewrites-heading" className="text-[10px] font-bold uppercase tracking-[0.2em] text-ih-fg-3">
          {m.marketplace_update_pairs_heading({ count: preview.pairs.length })}
        </h2>
        <ul className="space-y-3 list-none p-0 m-0">
          {preview.pairs.map((pair) => (
            <EditedCommentPair
              key={pair.commentId}
              pair={pair}
              toSemver={preview.toSemver}
              doomed={replacing}
              locale={locale}
            />
          ))}
        </ul>
      </section>

      <p className="text-[13px] text-ih-fg-3 max-w-[62ch]">
        {untouched > 0
          ? m.marketplace_update_rest({ count: untouched })
          : m.marketplace_update_rest_none()}
      </p>

      {/* The choice, after the evidence. */}
      <Card className="p-4 space-y-4">
        <Form method="post" className="space-y-4">
          <input type="hidden" name="choice" value={choice} />
          <RadioCardGroup
            name="choice-display"
            legend={m.marketplace_update_choice_legend()}
            value={choice}
            onChange={(v) => setChoice(v as "keep" | "replace")}
            options={[
              {
                value: "keep",
                title: m.marketplace_update_choice_keep_title(),
                description: m.marketplace_update_choice_keep_desc({
                  count:  preview.pairs.length,
                  semver: preview.toSemver,
                }),
              },
              {
                value: "replace",
                title: m.marketplace_update_choice_replace_title({ semver: preview.toSemver }),
                description: m.marketplace_update_choice_replace_desc({ count: preview.pairs.length }),
              },
            ]}
          />

          {/* The consequence, in words, where the reader's eyes already are —
              the strike-through above may have scrolled out of view. */}
          <p aria-live="polite" className={`text-[12px] ${replacing ? "text-ih-bad-fg" : "text-ih-fg-3"}`}>
            {replacing ? m.marketplace_update_consequence({ count: preview.pairs.length }) : " "}
          </p>

          <div className="flex items-center gap-2">
            <Button type="submit" variant={replacing ? "danger" : "primary"} disabled={submitting}>
              {submitting
                ? m.marketplace_update_submitting()
                : replacing
                  ? m.marketplace_update_submit_replace({ count: preview.pairs.length })
                  : m.marketplace_update_submit_keep()}
            </Button>
            <Button type="button" variant="ghost" onClick={() => navigate("/library/marketplace")}>
              {m.marketplace_update_cancel()}
            </Button>
          </div>
        </Form>
      </Card>
    </div>
  );
}
