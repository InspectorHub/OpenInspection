# Legacy share tokens (the 30-day report link)

A report link of the form `/report/<company>/<id>?view=agent&token=...` carries a 30-day token stored in the
`TENANT_CACHE` key-value namespace under `agent_view_token:<token>`. It predates the per-recipient portal tokens and is
kept as a **bridge**, so links already sent keep opening.

## What a token can do

- It is honoured only for the one inspection it names. A token for another report resolves to nothing.
- It carries a role, written when it is minted: `inspectionId:tenantId:role`.
  - `agent`: links issued by staff for an agent (the "agent view" and "share with agent" actions), and links made from an
    agent's own access. These may also take the agent seat in the repair builder.
  - `client`: links made with the Share button from a client's access. They read the report and nothing more; they cannot act in
    the repair builder.
  - A value with no role was written before roles existed and counts as `agent`, because every such link was issued for an agent.
- The lifetime is 30 days from minting and does not change.

## Sunset

This is a bridge and will be removed. It can be removed once no unexpired token can exist, which is 30 days after the last release
that mints one, and once the staff share actions issue per-recipient portal tokens instead. After that the
`agent_view_token:` keys, `resolveAgentViewToken` and the `?view=agent&token=` form stop being accepted.
