# es-419 translation glossary

One equivalent per term, decided once. The catalogue is 4,300 keys across 29
module files in `messages/`; without a fixed term list the same noun acquires
four translations across those files and the result reads as machine output.

This file is **machine-read**. `npm run lint:i18n-glossary`
(`scripts/check-i18n-glossary.mjs`) parses the tables below and fails the build
when `messages/es-419/**` contradicts them, so the glossary cannot quietly drift
away from the catalogue it governs. Edit the table, not the gate.

## Status of the Spanish catalogue

English is the authoritative locale. `es-419` is a courtesy layer: a key with no
Spanish translation falls back to English at runtime, which is safe. A key
present but **empty** is not — it renders blank. Never commit `"key": ""`.

Legally operative text is **not** translated. Inspection agreements and platform
terms stay English, and their body text is tenant/authored content that does not
live in this catalogue at all. Chrome *around* those documents (buttons, table
headers, status labels) is ordinary UI and is translated.

## Register

**Formal *usted*, second person.** Not *tú*, and not *vos*.

The reason is regional reach, not politeness. `es-419` spans voseo countries
(Argentina, Uruguay, much of Central America) where the *tú* imperative is
audibly foreign — "Ingresa" against "Ingresá". *Usted* is the one second person
that is correct everywhere in the region, so it is the only choice that lets a
single catalogue serve all of it. It is also the register a business uses when
writing to a client about their house.

Consequences, all machine-enforced below:

- Possessive is **su / sus**, never *tu / tus*.
- Imperatives take the *usted* form: **Ingrese**, **Guarde**, **Seleccione**.
- Clitic is **le / lo / la**, never *te*.
- Write **usted** in full where it is needed at all; never abbreviate to *Ud.*
- Latin American vocabulary, never Castilian: *computadora* not *ordenador*,
  *archivo* not *fichero*.

**Sentence case for buttons and labels**, matching the English UI: "Guardar
cambios", not "Guardar Cambios". Spanish sentence case also means months,
weekdays and languages are lowercase — but those come from `Intl`, not from this
catalogue.

## Rules that outrank the tables

1. **Translate what English says — do not fix English.** The English catalogue
   has known inconsistencies (four words for one trade concept; "Roles" against
   "Inspection roles"). Unifying them in Spanish desynchronises the two
   catalogues and hides the English problem. Terminology renames are an
   English-side pass; this is not it.
2. **Placeholders are part of the string.** `{address}`, `{count}`, `{status}`
   must survive translation with the same names — a dropped or renamed
   placeholder compiles to a different function signature and breaks the call
   site. Enforced.
3. **Do not translate the product name.** OpenInspection stays OpenInspection.
4. **Do not translate through the key name.** Keys are English identifiers and
   several of them lie about their own copy — the `settings_profile_credentials_*`
   family renders "Licenses & affiliations", not "Credentials". Translate the
   value in front of you.
5. **Tenant data is not in scope.** Rating-system labels, template names, canned
   comment bodies, inspection-role labels and trade names live in the database
   and stay in whatever language the tenant typed. A tenant who renamed their
   rating scale sees their own words, not these.
6. **Numbers, dates, money and addresses are formatted by code**
   (`app/lib/format.ts`, `app/lib/money.ts`), never spelled into a message. Do
   not hardcode a currency symbol or a date pattern in a translated string.

---

## Product nouns

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Inspection | inspección | orden de trabajo | The canonical noun. English forbids "Order"/"Job"; Spanish must not reintroduce them. |
| Company | empresa | compañía | One word for the business. "Compañía" is not wrong Spanish, it is just a second word for the same thing. |
| Workspace | espacio de trabajo | — | Appears only in the login heading. Not a user-facing concept elsewhere — do not spread it. |
| Report | informe | reporte | Region-neutral and unambiguous. "Reporte" is common in some markets, but picking both is how one noun becomes two. |
| Template | plantilla | — | Standard software Spanish. |
| Finding | hallazgo | — | Rare in the UI (a repair-request column, a metrics chart). Distinct from *defecto*: a hallazgo is observed, a defecto is judged. |
| Defect | defecto | — | The severity level. See the rating table. |
| Repair Items | elementos de reparación | recomendaciones | English forbids "Recommendations" for this feature; the Spanish ban mirrors it exactly. |
| Repair Request | solicitud de reparación | — | The client-facing document built from repair items. |
| Canned Comment | comentario predefinido | comentario enlatado | "Enlatado" is a literal calque of the English idiom and reads as a joke. |
| Notes | notas | apuntes | Inspector free text. Keep distinct from *comentarios*. |
| Comments | comentarios | — | Library entries and message threads. Never merge with *notas*. |
| Booking | reserva | — | The public self-scheduling flow. "Online Booking" → "Reservas en línea". |
| Appointment | cita | — | A scheduled visit. Deliberately a different word from *reserva*. |
| Schedule (noun) | agenda | — | |
| Schedule (verb) | programar | — | The verb. For the *status* "Scheduled" see the Status labels section — it is *Programado*, masculine, and that section explains why. |
| Invoice | factura | — | |
| Estimate | presupuesto | — | Not *estimado*, which reads as a guess rather than a priced offer. |
| Agreement | acuerdo | — | The document itself stays in English; this is the word for it in chrome. |
| Trade | oficio | — | The contractor discipline. English also says "contractor type" and "recommended contractor" for adjacent things — translate each as written (rule 1). |
| Contractor | contratista | — | |
| Property | propiedad | — | |
| Licenses & affiliations | licencias y afiliaciones | — | The `settings_profile_credentials_*` family. This is licences plus association memberships — **not** login credentials. |
| Credentials (sign-in / provider secrets) | credenciales | — | Only for authentication: the login form, and email/SMS/accounting provider secrets. Never for the licences feature above. |
| Library | biblioteca | — | The reusable-content area: templates, canned comments, repair items, tags, agreements, rating systems. |
| Marketplace | Marketplace | — | Left in English. It is a feature name, it is the word Latin American software actually uses, and the `MP` badge that abbreviates it has no Spanish equivalent. *Mercado* is deliberately not banned — "market value" is a legitimate phrase elsewhere in the product. |
| Dashboard | panel | — | "Back to Dashboard" → *Volver al panel*. Not *tablero*, which this product needs for the electrical panel. |
| Tag | etiqueta | — | The library tagging feature. |
| Label (of a template item) | etiqueta | — | The same word as Tag, on purpose. Both are *etiqueta* in ordinary Spanish, they never appear on the same surface, and inventing *rótulo* for one of them would be a word nobody uses to avoid a collision nobody sees. |
| Severity | gravedad | — | Not *severidad*, which is an anglicism in this sense. |
| Rating | calificación | — | "Rating system" → *sistema de calificación*; "Rating icons" → *iconos de calificación*. |
| Est. min / Est. max | Est. mín / Est. máx | — | The abbreviated repair-cost range on a repair item. Kept abbreviated because the field is a narrow numeric input, and *est.* abbreviates *estimado* in Spanish exactly as it does in English. The Estimate row still bans the unabbreviated *estimado*: that ban is about the noun for a priced offer, not about this abbreviation. |
| Amended (a report) | modificado | — | "Report amended" → *Informe modificado*. The feature is a revision after publication, not a legislative amendment, so not *enmendado*. |

## Roles and parties

The same handful of role words appears in a dozen places — the team settings
page, the invite modal, the inspection people list, the signer list, the message
thread, the public verify page. They must read identically in all of them; the
gate compares them against each other.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Owner (account role) | Titular | — | *Propietario* is the property owner — a different person, in a product whose whole subject is someone's house. "Titular" is the account holder and carries no such collision. |
| Manager (account role) | Gerente | — | Not *Administrador*, which reads as a system admin. |
| Inspector | Inspector | — | Same word. Feminine *Inspectora* only where the string is about one known person. |
| Agent | Agente | — | Real-estate agent. |
| Client | Cliente | — | English forbids "Customer"; do not reach for *consumidor*. |
| Co-Client | Cliente secundario | — | Spanish has no "co-" formation here, and the codebase's own name for the concept is the secondary client. |
| Other | Otro | — | The role bucket, masculine to agree with *rol*. |
| Contact | Contacto | — | The label English gives the `other` message role. The divergence is English's; keep it. |
| Signer | Firmante | — | |
| Recipient | Destinatario | — | |
| Staff | personal | — | "Office staff" → *personal de oficina*. |
| Team | equipo | — | |
| Field Observer | Observador de campo | — | Commercial sign-off role. |
| PCR Reviewer | Revisor del PCR | — | PCR stays an acronym; it names a document type. |

### Roles that are database seeds, not catalogue keys

`Buyer's Agent`, `Listing Agent`, `Attorney`, `Transaction Coordinator`,
`Insurance Agent`, `Title Company` and `Co-Client` are seeded labels in
`server/lib/people/default-role-profiles.ts`, and tenants can rename them. They
are **not** translatable today and **no message key should be invented for
them** during translation. The equivalents are fixed here so that whenever they
do become translatable the term is already decided:

| English | es-419 | Why |
|---|---|---|
| Buyer's Agent | Agente del comprador | |
| Listing Agent | Agente del vendedor | Do not calque "listing". The English pair was chosen for accuracy about *which party the agent serves*, and naming the party is exactly how Spanish says it. |
| Attorney | Abogado | |
| Transaction Coordinator | Coordinador de transacción | |
| Insurance Agent | Agente de seguros | |
| Title Company | Empresa de títulos | *Empresa*, not *compañía* — consistent with the Company row above. |

## Ratings and severity

`Satisfactory`, `Monitor` and `Defect` each appear in five or more module files
(`labels`, `library`, `editor`, `editor-2`, `templates`). They are the single
easiest place to end up with four Spanish words for one concept.

Residential and commercial severity are **separate scales and must never share
vocabulary**: the commercial standard excludes routine maintenance from
"deficiency", which is the opposite of the residential reading.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Satisfactory | Satisfactorio | — | The top residential tier. |
| Monitor | Vigilar | monitorear | The middle tier. "Monitorear" is a calque and long for a chip. |
| Defect (severity level) | Defecto | — | The bottom residential tier, capitalised as a chip. Same word as the Defect product noun; the two must not drift apart. |
| N/A (severity level) | N/A | — | Left as written. In Spanish *N/A* abbreviates *no aplica* — the same abbreviation with the same expansion, so translating it would only make it longer. |
| Not Inspected | No inspeccionado | — | |
| Not Present | No presente | — | |
| Deficient | Deficiente | — | The commercial/TREC wording. |
| Deficiency | Deficiencia | — | Commercial only. Not a synonym for *defecto*. |
| Hazard | Peligro | — | |
| Functional | Funcional | — | |
| Marginal | Marginal | — | |
| Maintenance | Mantenimiento | — | |

## Status labels

A status word attaches to a different noun in every module: an inspection
(*inspección*, feminine), a report (*informe*, masculine), an invoice
(*factura*, feminine), an agreement (*acuerdo*, masculine), an event
(*evento*, masculine). The same English word therefore cannot both agree with
its subject and stay consistent — and the consistency check forces exactly one
Spanish string per English string. "Published" already labels an inspections tab
*and* two report states in `labels.json` alone.

So **status labels are masculine singular**, agreeing with the implicit
*estado*: "Cancelado", never "Cancelada". This is the only form that scales to
the whole catalogue — it needs no divergence declaration in any module — and it
is what a chip actually means: it names the state, not the thing.

**Prose is different.** A hint that reads "Cancelled inspections" is a sentence,
not a chip, and agrees normally: *Inspecciones canceladas*. The rule above binds
the standalone label only.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Requested | Solicitado | — | |
| Scheduled (status) | Programado | — | Masculine by the rule above. This is the row that governs the status chip; the Schedule (verb) row governs the verb. |
| Confirmed | Confirmado | — | |
| Completed | Completado | — | |
| Cancelled | Cancelado | — | |
| Active | Activo | — | |
| In Progress | En curso | — | Not *En progreso*, a calque. |
| Submitted | Enviado | — | The report was sent for review; same participle as Send. |
| Published (status) | Publicado | — | |
| Paid | Pagado | — | "Partially paid" → *Pagado parcialmente*. |
| Signed | Firmado | — | |
| Viewed | Visto | — | |
| Declined | Rechazado | — | |
| Expired | Vencido | — | |
| Not sent | No enviado | — | The "Not …" agreement/invoice states all take this shape: *No requerido*, *Sin facturar*, *Sin factura*. |
| Awaiting X | En espera de X | — | "Awaiting payment" → *En espera de pago*; "Awaiting signature" → *En espera de firma*; "Awaiting report" → *En espera del informe*. One shape for the whole family. |
| All (filter / tab) | Todo | — | The uncountable form. The same English "All" labels an inspection filter, an inspection-status tab, a canned-comment tab and a marketplace tab; *Todo* is the only form that agrees with all four and sits correctly beside the singular status labels next to it. *Todos* is deliberately not banned — it is correct in ordinary prose ("a todos los destinatarios"). |

## Recurring UI verbs and states

These are a few hundred keys between them. One word each.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Save | Guardar | salvar | *Salvar* is to rescue. "Save changes" → "Guardar cambios". |
| Cancel | Cancelar | — | |
| Delete | Eliminar | — | |
| Remove | Quitar | — | Detaching something, not destroying it. Distinct from *Eliminar*. |
| Clear | Borrar | — | Emptying a field. This is why *borrar* is not the word for Delete. |
| Archive | Archivar | — | |
| Publish | Publicar | — | "Published" → *Publicado*. |
| Draft | Borrador | — | The noun. Unrelated to *borrar*. |
| Send | Enviar | — | |
| Resend | Reenviar | — | |
| Download | Descargar | — | |
| Upload | Subir | — | |
| Add | Agregar | añadir | Both are correct Spanish; *agregar* is the region-neutral default and picking one is the point. |
| Edit | Editar | — | |
| Preview | Vista previa | — | |
| Search | Buscar | — | |
| Continue | Continuar | — | |
| Back | Atrás | — | |
| Next | Siguiente | — | |
| Confirm | Confirmar | — | |
| Retry | Reintentar | — | |
| Share | Compartir | — | |
| Sign | Firmar | — | |
| Pay | Pagar | — | |
| Assign | Asignar | — | |
| Invite | Invitar | — | |
| Loading… | Cargando… | — | Keep the ellipsis character the English string uses. |
| Saving… | Guardando… | — | |
| Sending… | Enviando… | — | |
| Uploading… | Subiendo… | — | |

## Register enforcement

Every entry here is wrong in `es-419` in every context, which is what makes it
safe to ban outright. Soft preferences belong in the "Why" column of the tables
above, not in this one.

<!-- gate:terms -->

| Concept | Use | Never | Why |
|---|---|---|---|
| Possessive, 2nd person | su / sus | tu, tus | *tú* register. Both accented and unaccented forms are caught. |
| Subject pronoun, 2nd person | usted | tú, ti, contigo, tuyo, tuya | |
| Clitic, 2nd person | le / lo / la | te | *te* is the *tú* clitic; *usted* takes *le*. |
| Abbreviated courtesy | usted | Ud., Vd. | Write it out. |
| 2nd person plural | ustedes | vosotros, vuestro, vuestra | Castilian only; wrong everywhere in `es-419`. |
| Computer | computadora | ordenador | Castilian. |
| File | archivo | fichero | Castilian. |
| To take / get | tomar, obtener | coger | Vulgar in most of Latin America. |

## Consistency across modules

Two keys whose **English is character-for-character identical** must have
identical Spanish. This is checked automatically and is the rule that stops
"Satisfactory" becoming *Satisfactorio* in `labels.json` and *Aceptable* in
`library.json`.

Where the same English genuinely needs two Spanish renderings — usually gender
agreement, or a word that is a noun in one place and a verb in another — list
the keys here with the reason, and the gate will allow it.

<!-- gate:divergence -->

*(No declared divergences yet. Add them as `- \`key_one\`, \`key_two\` — reason.)*

## Working through a module

1. Read the English values, not the key names.
2. Apply the tables above. If a term recurs and is not in a table, add a row
   here first — that is cheaper than finding three spellings later.
3. Keep every placeholder.
4. `npm run i18n:compile` once for the whole module, not per key.
5. `npm run lint:i18n-glossary` and `npm run lint:i18n-catalog`.

### Known deviation

The 15 keys in `messages/es-419/auth.json` were written during the login pilot,
before this glossary existed, in the *tú* register. They were re-registered to
*usted* when this file landed. If any pre-glossary Spanish is found elsewhere,
fix the register rather than widening the gate.
