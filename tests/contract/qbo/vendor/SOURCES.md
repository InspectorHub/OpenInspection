# Vendored Intuit schemas — where they came from and why they are here

These four files are **Intuit's**, copied unmodified. They are the only
machine-readable description of the QuickBooks Online v3 API that Intuit
publishes: there is no official OpenAPI or Swagger document, and Intuit has said
on its own developer forum that one is not planned. Everything else — the API
Explorer, the reference pages, the Postman collection — either renders from a
server we cannot check against in a test, or points at the sandbox.

## Provenance

| File | Bytes | SHA-256 |
|---|---|---|
| `Finance.xsd` | 530896 | `73f82ba1690ee95298b38c2f0b2079951ead1589039b5ca76c526e00d4e0e548` |
| `IntuitBaseTypes.xsd` | 68497 | `4566e2122db09252edc5ce632aed3cc08178d55078935f74a80c4042dce54626` |
| `IntuitNamesTypes.xsd` | 62262 | `bc8948a02dd3cd53875654e54edba8f2e644b8aeb4037d1925acb057870b95cd` |
| `IntuitRestServiceDef.xsd` | 42926 | `ec71e69503332692368ca01af625395f86413df2f2b1b6880de695c104a5284b` |

- **Source:** <https://github.com/intuit/QuickBooks-V3-PHP-SDK> — `src/XSD/`
- **Upstream commit:** `4f097fd4dbb4146f331f8547665bb34c8d72ec42` (2026-07-17,
  "Add PHP 8.4 support, v3 schema updates, and ignoreUnknownElements for XML")
- **Fetched:** 2026-08-16
- **Licence:** Apache-2.0 (the repository's own). Compatible one-way into this
  project's AGPL-3.0; this file is the attribution that licence asks for.

The same files ship in <https://github.com/intuit/QuickBooks-V3-DotNET-SDK>
under `IPPDotNetDevKitCSV3/Tools/XsdExtension/Intuit.Ipp.XsdExtension/Schema/`.
One origin is enough, and mixing the two would make a refresh ambiguous.

## Refreshing

```bash
cd tests/contract/qbo/vendor
BASE=https://raw.githubusercontent.com/intuit/QuickBooks-V3-PHP-SDK/master/src/XSD
for f in Finance.xsd IntuitBaseTypes.xsd IntuitNamesTypes.xsd IntuitRestServiceDef.xsd; do
  curl -sSL -o "$f" "$BASE/$f"
done
sha256sum *.xsd          # update the table above
npm run test:contract    # the specs say what changed
```

Refresh deliberately, not routinely. The contract specs quote sentences out of
these files verbatim; a refresh that changes Intuit's wording is supposed to
turn those specs red, because a rule we assert and a rule Intuit states have to
be the same rule.

## What they do and do not tell us

**They do** name the two constraints that broke this integration for its entire
life. `Finance.xsd`, the `Invoice` complexType's own `xs:documentation`:

> Business Rules: An invoice must have at least one line that describes the item
> and an amount. An invoice must have a reference to a customer in the header.

Both were true the whole time, in a file Intuit ships, while our tests asserted
otherwise.

**They do not** enforce the first of those. `Transaction/Line` is declared
`minOccurs="0"` — the schema says a line is optional and the server refuses the
document without one. So a validator run over these files would have caught the
missing `CustomerRef` (no `minOccurs`, therefore required) and **missed** the
missing `Line`. The prose is load-bearing, which is why the specs quote it.

**They also do not** contain a single error code. `6240` — the fault QuickBooks
actually returns for a duplicate DisplayName, and which our retry ladder read as
`6140` for its whole life — appears in none of these files. `IntuitRestServiceDef.xsd`
gives the fault *shape* (`FaultTypeEnum` = AuthenticationFault / AuthorizatonFault
[sic] / ValidationFault / SystemFault, and `Error` = Message + Detail + code) and
nothing about which codes exist. Codes can only come off the wire, which is what
the live lane is for.
