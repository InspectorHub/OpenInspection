# Vendored ISN schema — where it came from and why only this much

`addreporturl.openapi.json` is an **excerpt** of ISN's published OpenAPI
document: the `PUT /orders/addreporturl` operation exactly as ISN describes
it, plus the document's `info` and `servers`. Nothing inside the operation is
edited.

Only an excerpt, because the full document states no licence, and this suite
needs one operation from it. What is kept is the interface description the
contract spec checks against; the rest stays with ISN.

## Provenance

| Document | Bytes | SHA-256 |
|---|---|---|
| `https://developer.inspectionsupport.com/specs/isn/openapi.json` (full) | 629445 | `50dc541034502ba45aa87fd782f52daab5f6de7546f27d78feeee10ababf4a0f` |

- **Version:** `info.version` 8665, OpenAPI 3.1.0
- **Fetched:** 2026-09-18
- **Rendered at:** <https://developer.inspectionsupport.com/reference/>

## What this document gets wrong

It says `addreporturl` takes a form-encoded body. On the wire it does not: a
form body is answered with `"you must provide a url for the report"`, and the
same fields in the query string are read. That is pinned in
`../isn-api.live.spec.ts`, and `../report-link.contract.spec.ts` asserts the
document still says what it says — so the day ISN corrects it, that spec fails
and the comment in `server/services/isn/api-base.ts` can be revisited.

## Refreshing

```bash
curl -sSL https://developer.inspectionsupport.com/specs/isn/openapi.json -o /tmp/isn.json
sha256sum /tmp/isn.json                       # compare with the table above
node -e "const s=require('/tmp/isn.json');console.log(JSON.stringify(s.paths['/orders/addreporturl'],null,2))"
npm run test:contract
```
