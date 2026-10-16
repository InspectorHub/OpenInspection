/**
 * Where the person who just created an inspection goes next.
 *
 * Someone who can write report content lands in the report editor. Office staff
 * cannot open it, so they land on the inspection's own page, where the booking is
 * managed. If the answer cannot be had (the profile call fails) the page is the
 * safe choice: everyone can open it.
 */
type MeCall = (args?: unknown) => Promise<Response>;

export async function createLandingPath(api: { auth?: { me?: { $get?: unknown } } }, id: string): Promise<string> {
  const meGet = api.auth?.me?.$get as MeCall | undefined;
  const res = meGet ? await meGet().catch(() => null) : null;
  const body = res && res.ok
    ? ((await res.json().catch(() => null)) as { data?: { capabilities?: { editReports?: boolean } } } | null)
    : null;
  return body?.data?.capabilities?.editReports === true ? `/inspections/${id}/edit` : `/inspections/${id}`;
}
