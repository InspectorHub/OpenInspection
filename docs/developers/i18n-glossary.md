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
7. **A format literal a parser matches on stays English.** Some strings show the
   user an input format that code then compares against, character for
   character. `editor_unitsmanager_csv_placeholder` and `_csv_hint` show
   `label,floor`, and `parseUnitCsv` (`server/lib/unit-pattern.ts`) skips a
   header row only when it reads exactly that. Translating the hint to
   `etiqueta,piso` would teach a Spanish user to type a header the parser then
   imports as a unit named "etiqueta". Translate the prose around such a
   literal; leave the literal alone.

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
| Repair Items | elementos de reparación | — | English forbids "Recommendations" **for this feature**, and so does Spanish — but that prohibition cannot be a machine ban. English uses the same word legitimately elsewhere: the ASTM PCA report's "1.5 Recommendations" section, the "Recommendation" custom-defect category, and the agent portal's "grouped under Recommendations". A blanket ban on *recomendaciones* false-fires on all of them, and a gate with false positives gets bypassed. Rule, not gate: never name **this feature** *recomendaciones*. |
| Repair Request | solicitud de reparación | — | The client-facing document built from repair items. |
| Canned Comment | comentario predefinido | comentario enlatado | "Enlatado" is a literal calque of the English idiom and reads as a joke. |
| Notes | notas | apuntes | Inspector free text. Keep distinct from *comentarios*. |
| Comments | comentarios | — | Library entries and message threads. Never merge with *notas*. |
| Booking | reserva | — | The public self-scheduling flow. "Online Booking" → "Reservas en línea". |
| Appointment | cita | — | A scheduled visit. Deliberately a different word from *reserva*. |
| Schedule (noun) | agenda | — | |
| Schedule (verb) | programar | — | The verb. For the *status* "Scheduled" see the Status labels section — it is *Programado*, masculine, and that section explains why. |
| Invoice | factura | — | |
| Estimate | presupuesto | — | The **noun** for a priced offer. Not *estimado*, which reads as a guess. The ban is on the noun only and is deliberately not machine-enforced: *estimado* is the ordinary adjective and the only right word in "Estimated cost" → *Costo estimado* and "Estimated monthly cost" → *Costo mensual estimado*. Banning the string would false-fire on both. |
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

## The editor and field workflow

Fixed while translating the four `editor*.json` files (595 keys). Several of
these words also appear in `media`, `settings*`, `misc`, `contacts` and
`components`, so they are decided here rather than re-argued there.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Speed mode | modo rápido | — | The one-item-at-a-time rating flow. Not *modo de velocidad*. |
| Burst camera | cámara en ráfaga | — | *Ráfaga* is the standard photographic term. |
| Snippet | fragmento | — | A saved piece of note text. Distinct from *comentario predefinido*, which is a library entry. |
| Unit (of a multi-unit property) | unidad | — | The per-unit inspection mode. Not the unit of measure — that is *UM* in the cost table. |
| Cost item | elemento de costo | — | A line in the PCA Opinion of Cost. Parallel to *elemento de reparación*. |
| Sign-off | aprobación | — | The commercial reviewer's approval. *Firmar* is the signature act; the sign-off is the recorded approval, and the two appear side by side on the compliance panel. |
| Location | ubicación | — | Where a defect is. Not *localización*. |
| Version history | historial de versiones | — | |
| Restore | Restaurar | — | Bringing back a saved version. Distinct from *Recuperar* (recover one value). |
| Rename | Cambiar nombre | — | Sentence case, no article, because it is a menu item. The aria form takes one: *Cambiar el nombre de {name}*. |
| Cover photo | foto de portada | — | "Set as cover" → *Establecer como portada*. |
| Completion | Avance | — | A percentage stat. *Completitud* is a mathematics word; *avance* is what a progress figure is called. |
| Saved | Guardado | — | The save-state indicator, masculine singular by the status-label rule. |
| Connected / Connecting… | Conectado / Conectando… | — | Collaboration presence. |
| inspector-added | agregado por el inspector | — | The badge on a defect the inspector wrote rather than the library. Lowercase, as in English. |
| Unrated | Sin calificar | — | |
| Batch mode | modo por lotes | — | Multi-select rating. Bulk create is *creación en lote*. |

## Commercial PCA (ASTM E2018)

Commercial report vocabulary. The section numbers are part of the string and
never change; the same headings appear in `editor-4.json` and `pca-report.json`
character for character, so the consistency check binds them together.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| PCA / PSQ / PCR / EUL / RUL | PCA / PSQ / PCR / EUL / RUL | — | Acronyms of the standard. Left as written — they are how the document names itself, and expanding them in Spanish would not match the report a client receives. |
| Transmittal Letter | Carta de remisión | — | The cover letter ASTM E2018 requires. *Remisión* is the term used for a document formally forwarded to a client. |
| Opinion of Cost | Opinión de Costo | — | The ASTM name for the cost tables. Capitalised because it names a document part. |
| 1.1 General Description | 1.1 Descripción general | — | |
| 1.2 General Physical Condition | 1.2 Condición física general | — | |
| 1.5 Recommendations | 1.5 Recomendaciones | — | See the Repair Items row: this is the legitimate use of the word. |
| 2.1 Purpose | 2.1 Propósito | — | |
| 2.3 Limitations & Exceptions | 2.3 Limitaciones y excepciones | — | |
| 2.4 General Property Reconnaissance | 2.4 Reconocimiento general de la propiedad | — | |
| Additional Considerations | Consideraciones adicionales | — | |
| Immediate / Short-term / Long-term | Inmediato / Corto plazo / Largo plazo | — | The three cost buckets. Masculine singular — they label a bucket, like a status. |
| Conforms / Does not conform | Conforme / No conforme | — | The ASTM conformance statement. |

## The client portal, invoices and verification

Fixed while translating `reports.json` (258 keys) and `pca-report.json` (130).
`reports.json` shares 58 English strings with `checkout`, `inspections`,
`communication`, `booking`, `components`, `misc` and `public` — more overlap
than any other module — so these are the rows the client-facing waves inherit.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Email / Email address | Correo electrónico | — | The full form both times. *Email* untranslated reads as a loanword the rest of the catalogue avoids, and *correo* alone is postal mail. |
| Phone | Teléfono | — | |
| Property | Propiedad | — | Also the noun in the Product nouns table; repeated here because it is a field label in six modules. |
| Amount | Monto | — | Not *cantidad*, which is a count. "Amount due" → *Monto adeudado*; "Amount paid" → *Monto pagado*. |
| Item | Elemento | — | A row in a list or a table. Same word as a template item — they never collide on one surface. |
| Section | Sección | — | |
| Document | Documento | — | |
| Note | Nota | — | Singular of *notas*. |
| Logo | Logotipo | — | *Logo* is understood but *logotipo* is the written form. |
| Overview | Vista general | — | Deliberately different from Summary → *Resumen*: the client portal shows both, as a nav tab and as a report filter. |
| Sign in (verb) / sign-in link | iniciar sesión / enlace de inicio de sesión | — | "Sign out" → *Cerrar sesión*. Distinct from *Firmar*, which signs a document — English uses "sign" for both and Spanish must not. |
| Please try again. | Inténtelo de nuevo. | — | The recovery sentence on roughly twenty error strings. One wording, *usted* imperative. "Please try again in a moment." → *Inténtelo de nuevo en unos instantes.* |
| Something went wrong | Algo salió mal | — | |
| Copied! | ¡Copiado! | — | Opening exclamation mark is not optional in Spanish. |
| Processing… | Procesando… | — | |
| Secured by Stripe | Protegido por Stripe | — | Not *Asegurado*, which means insured. |
| Privacy Policy | Política de privacidad | — | |
| Repair Request Builder | Generador de solicitudes de reparación | — | The client-facing tool. The document it produces is the *solicitud de reparación*. |
| Condition | Condición | — | The commercial systems-summary column. |
| Compliance | Cumplimiento | — | |
| Not applicable | No aplica | — | Spelled out where English spells it out; *N/A* stays *N/A*. |

## Settings, account and team

Fixed while translating `settings.json` (244 keys). These words are the chrome
of every settings surface and most of them recur in `settings-components`,
`settings-integrations`, `misc`, `nav` and `communication`, so they are decided
once here.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Settings | Configuración | ajustes | Singular. It is the page name, the breadcrumb and the nav entry; *Ajustes* is the other common rendering and picking one is the point. Only the **plural** is banned: the singular *ajuste* is the ordinary word for an adjustment and is already load-bearing elsewhere (*preajuste de estilo* = style preset), so banning it would false-fire. |
| Account | Cuenta | — | |
| Profile | Perfil | — | |
| Billing | Facturación | — | The area. The document is a *factura*. |
| Integrations | Integraciones | — | |
| Automations | Automatizaciones | — | |
| Communication | Comunicación | — | The settings section covering email and SMS delivery. |
| Advanced | Avanzado | — | Masculine singular: it names a settings section, like a status names a state. |
| Usage | Uso | — | |
| Data | Datos | — | |
| Connected applications | Aplicaciones conectadas | — | The authorized-MCP-client list. |
| Company name | Nombre de la empresa | — | With the article. *Nombre de empresa* reads as a form field on a government paper. |
| Timezone / Your timezone | Zona horaria / Su zona horaria | — | One word in English, two in Spanish; both halves of the pair are fixed so the company and personal settings match. |
| Locale | Configuración regional | — | The language-and-number-format setting. Not *localización*, which is a place. |
| Currency | Moneda | — | |
| Branding | Marca | — | |
| Role / Roles | Rol / Roles | — | The account role. *Rol* is the region-neutral form; *papel* is a theatre part. |
| Export (settings action) | Exportar | — | Infinitive, matching the sibling *Importar contactos*. Used for the heading and the button alike. |
| Import | Importar | — | |
| GDPR | RGPD | — | The regulation's own Spanish acronym. Used in the Data and Compliance sections. |
| Not set | Sin definir | — | The empty-value rendering of any account field. Invariant for gender, which is why it is not *No definido*. |
| Pending | Pendiente | — | Invite and member state. Invariant for gender, so the status-label rule needs no help here. |
| Signature | Firma | — | The drawn/uploaded mark. The email footer is the *firma de correo electrónico*; both are *firma* and they never share a surface. |
| Saved. | Guardado. | — | The flash message, masculine singular by the status-label rule. |
| Couldn't save that. Please try again. | No se pudo guardar. Inténtelo de nuevo. | — | Built from the two fixed halves: the impersonal failure and the one recovery sentence. |
| Unknown action | Acción desconocida | — | The form-action fallback error, shared by several settings routes. |
| Free plan limit reached | Límite del plan gratuito alcanzado | — | |

### The services / event-types catalogue

Fixed while translating `settings-catalog.json` (123 keys). These recur in
`settings-components`, `contacts` and `public`.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Slug | Identificador | — | The URL-safe key of an event type or a booking page. *Slug* is untranslatable jargon in Spanish and the column shows values like `radon_pickup`, which explain themselves. The placeholder that shows that value stays English — it is a format sample. |
| Duration | Duración | — | |
| Platform | Plataforma | — | The vendor-shipped tier of inspection types, against *Su organización*. |
| Enabled / Disabled | Habilitado / Deshabilitado | — | Paired with the verbs *Habilitar* / *Deshabilitar* so the chip and the button that flips it share a root. |
| Inactive | Inactivo | — | Masculine singular by the status-label rule. |
| My Schedule | Mi agenda | — | Uses the Schedule (noun) row: *agenda*, not *horario*, which is the weekly-hours grid inside it. |
| No access / View only / View and edit | Sin acceso / Solo lectura / Ver y editar | — | The three capability levels, shared by the workflow settings and the contact-role modal. *Solo lectura* is the recognised access level; the third stays a verb pair because English does. |
| Sort order | Orden de clasificación | — | |
| Report link expiry | Vencimiento del enlace del informe | — | *Vencimiento*, matching Expired → *Vencido*. The bulk actions are phrased as *Aplicar vencimiento a…* / *Quitar vencimiento de…*: Spanish *vencer* is intransitive, so "Expire N links" has no verb-for-verb rendering. |

### Scheduling, providers and integration panels

Fixed while translating `settings-components.json` (491 keys), the largest
module in the catalogue. It is where the product talks to Google, Stripe,
Twilio, Telnyx and four email vendors, so it also fixes how third-party text is
handled.

**Rule 7 applies heavily here, and extends to third-party navigation.** A menu
path into someone else's product (`Stripe → Developers → Webhooks`,
`Twilio Console → Account Info`, `Account → Customer subdomain`), the label of a
button the user must click *in that product* (`Send test event`), a credential
field name (`Twilio Account SID`, `Auth Token`), a key prefix (`pk_test_`,
`whsec_`, `SG.`), a format sample (`+15551234567`, `acct_1AbCdEfGhIjKlMnO`,
`customer.cloudflarestream.com`) and the SMS keywords carriers match on
(**STOP / START / HELP**) all stay English. Translate the prose around them. The
STOP/HELP case is not cosmetic: those are the words a consumer texts back, and a
translated one would be a compliance failure, not a typo.

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Holiday | feriado | festivo | *Festivo* is Castilian; `es-419` says *feriado*. "Company holidays" → *Feriados de la empresa*. |
| Time off | Ausencias | — | Plural, because the panel lists blocks. *Tiempo libre* is leisure, not a scheduled absence. |
| Tenant (the SaaS account) | cuenta | — | Deliberately **not** *inquilino*. In a product whose subject is somebody's house, *inquilino* is the person renting it — the same collision the Owner row avoids. Not machine-banned: a future English string about an actual occupant would need the word. |
| Failed (a test / a delivery) | Fallido | — | Masculine singular by the status-label rule; the verb *Falló* is used in sentences (*Falló la sincronización del calendario.*). |
| Not connected / Not configured | Sin conectar / Sin configurar | — | The *Sin …* shape, matching *Sin definir*. Reserve *No …* for sentences. |
| Qualified (inspectors) | autorizados | — | Not *calificados*: this catalogue already spends *calificación* on Rating, and "inspectores calificados" reads as *rated* inspectors to anyone who has seen the editor. *Autorizados* also states what the checkbox does — the help text below it says "allow all staff". |
| Light / Dark (theme) | Claro / Oscuro | — | |
| Live / Test (Stripe key mode) | Producción / Prueba | — | |
| Carrier | operador | — | The mobile carrier. |
| Concierge review | revisión previa | conserjería | *Conserjería* is a doorman's desk. The English is internal jargon for "the office approves it first", which is what the Spanish says. |
| Slot | horario | — | A bookable start time. "Slot rules" → *Reglas de horarios*, "Slot interval" → *Intervalo entre horarios*. |
| Weekday names | Domingo … Sábado | — | Capitalised, because each is a standalone row label and buttons/labels take sentence case. Spanish lowercases weekdays mid-sentence; nothing in this catalogue puts one mid-sentence. |

### Communication, billing and compliance settings

Fixed while translating `settings-integrations.json` (294 keys).

<!-- gate:terms -->

| English | es-419 | Never | Why |
|---|---|---|---|
| Subject (email) | Asunto | — | The subject line. Distinct from the GDPR data subject — see the declared divergence. |
| Data subject | Interesado | — | The GDPR term for the person a record is about. The regulation's own Spanish text uses *interesado*. |
| Seat | puesto | — | A licensed team member. Never *asiento*: that is a chair, an *asiento contable* is a ledger entry, and in this product's own domain *asiento* is foundation settlement. Deliberately not machine-banned for exactly that last reason. |
| Managed (SMS, provider, number) | gestionado | — | Run by the platform on the tenant's behalf. |
| Self-hosted | autoalojado | — | "Self-host docs" → *Documentación de autoalojamiento*. |
| Standalone mode | modo autónomo | — | The single-tenant deployment. |
| Deployment | instalación | despliegue | *Despliegue* is a military deployment; an operator reads *instalación*. |
| Opt-in / opt-out | consentimiento / baja | — | SMS compliance. The keywords themselves (STOP / START / HELP) stay English. |
| Erasure request | solicitud de eliminación | — | GDPR Art. 17. Uses *eliminar*, the Delete verb. |
| Anonymized / Retained | Anonimizado / Conservado | — | Erasure-log columns, masculine singular alongside *Eliminado*. |
| Built-in | Integrado | — | A platform-supplied template or referral source, against the tenant's own. |
| Estimated monthly cost | Costo mensual estimado | — | The one place *estimado* is the right word — see the Estimate row, which bans the noun and not this adjective. The figure itself is *un cálculo aproximado*, never *un estimado*. |

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

**Put every key sharing that English on the bullet's first line.** The parser
reads keys only from lines that begin with `-`, so keys wrapped onto a
continuation line are dropped, and a divergence missing one of its keys does not
apply at all.

<!-- gate:divergence -->

- `settings_team_resend_invite`, `settings_integrations_resend_name`, `settings_email_provider_resend` — English "Resend" is two unrelated things.
  On the team page it is the verb (send the invite again) and must be
  *Reenviar*. In the integrations catalogue and the email-provider select it is
  **Resend the company**, the transactional email vendor, and rule 3 forbids
  translating a product name — *Reenviar* there would name a provider that does
  not exist. The two readings never share a surface.

- `settings_comms_template_subject_label`, `settings_compliance_col_subject` — English "Subject" is a homograph, not a shared concept. On the email-template editor it is the subject line (*Asunto*); in the erasure log it is the GDPR **data subject**, a person (*Interesado*). No Spanish word covers both, and picking either would make one of the two screens nonsense.

*(Add further divergences as `- \`key_one\`, \`key_two\` — reason.)*

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
