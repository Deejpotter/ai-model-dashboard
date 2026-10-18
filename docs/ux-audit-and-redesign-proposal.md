# AI Model Dashboard: UX Audit & Redesign Proposal

**Prepared for:** Deej
**Prepared:** 18 October 2026 (Australia/Sydney)
**Status:** Proposed - approval required before implementation

## Executive summary

The AI Model Dashboard has a sound data foundation and three useful product capabilities: a model catalogue, a workload-cost calculator, and a comparison view. It does not yet turn those capabilities into a fast decision-making workflow.

The central problem is not visual polish. It is that the current primary screen asks a user to interpret a 12-column spreadsheet before they can answer the questions the product exists to answer: **which model should I use, why, and what will it cost?** In the current seeded dataset, all 25 rows lack the four derived category scores shown in the table, so a third of the visible decision columns are empty. The interface is therefore dense without being correspondingly informative ([AI Model Dashboard source, 2026](../src/components/Dashboard.tsx#L141-L179)).

This proposal recommends a decision-first redesign, delivered in two phases:

1. **Decision foundation:** a responsive catalogue, task/capability filters, model detail drawer, comparison tray, transparent data states, and accessibility repairs.
2. **Decision tools:** scenario-based cost planning, guided comparison, saved/shareable state, and recommendation rules.

The recommended outcome is a dashboard that makes a shortlist in minutes, makes costs understandable before use, and retains the full underlying data for deeper investigation.

## Approval requested

Approve the following before implementation:

- The decision-first product direction and two-phase scope in this document.
- A compact catalogue/card default, with raw model metadata and benchmark detail moved into an on-demand drawer.
- A persistent comparison tray available from every primary workflow.
- A data-integrity rule: a missing price is **unknown**, never `$0` or “cheapest.”
- URL-persisted filters, scenario inputs, and comparison selections.
- The stated non-goals and accessibility baseline.

## Audit scope & method

The audit covered the live production application, the client component, the API route, schema, sync script, local seeded SQLite data, and lint output. The live review was completed on 18 October 2026.

### Evidence snapshot

| Evidence | Observation | Implication |
|---|---|---|
| Live app | The primary view presents 25 models in a 12-column table, with catalogue, projections, and compare as pill buttons ([AI Model Dashboard, 2026](https://ai.deejpotter.com/)). | The interface begins with data scanning rather than task selection. |
| Local data | All 25 records have `NULL` for coding, thinking, maths, and overall category scores; all 25 do have input and output prices. | Four highly visible decision columns render as `—` throughout the catalogue. |
| Component | The catalogue always renders scores, notes, model IDs, modes, and prices in the same table ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L141-L179)). | Important information cannot be distinguished from secondary diagnostic data. |
| Cost calculation | Null prices are coalesced to zero in the projection formula ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L95-L102)). | A missing price can create a false “cheapest” result. |
| API & state | The API accepts search, provider, favourites, sort, and direction, but the client keeps all of this state in memory ([models route, 2026](../src/app/api/models/route.ts); [Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L57-L84)). | A useful view cannot be bookmarked, shared, or safely resumed. |
| Data freshness | The database schema stores `last_seen`, `last_updated`, `source_url`, and availability, yet none is surfaced in the user interface ([schema, 2026](../src/db/schema.sql); [Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L162-L175)). | Users cannot judge whether a price, model, or benchmark is current or trace it to a source. |
| Interaction/accessibility | The search and provider controls have no programmatic labels; sortable headers are clickable `<th>` elements; favourite stars have no accessible name ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L130-L161)). | Keyboard and assistive-technology users cannot reliably identify or operate key controls. |
| Visual system | There are no explicit `:focus-visible` styles ([globals.css, 2026](../src/app/globals.css#L16-L62)). | Keyboard focus is not assured to remain visible, contrary to WCAG’s focus-visible criterion ([World Wide Web Consortium, 2026a](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)). |

## Product diagnosis

### What works today

- The product has a clean dark visual base and a restrained palette.
- The three existing capabilities are appropriate for the problem space.
- The catalogue already supports server-side search, provider filtering, sorting, and persisted favourites.
- The data model has useful latent fields: modality, reasoning, context, cache pricing, availability, sources, last seen, and notes.
- The sync architecture preserves manually curated notes, benchmarks, and favourites ([sync script, 2026](../scripts/sync-models.mjs)).

### Where the experience breaks down

#### P0 - Cost recommendations can be wrong

The projection calculation treats `null` input, cache, and output prices as zero. A result can therefore look financially optimal when its pricing is unavailable, rather than genuinely low cost ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L95-L104)). This is a decision-quality defect, not merely a presentation issue.

**Required change:** represent incomplete pricing as `Unknown`; exclude it from “lowest cost” claims; show which part of the pricing is unavailable; retain it in the list only when the user explicitly includes unavailable pricing.

#### P0 - The catalogue provides too much low-confidence information at once

The table has 12 columns, including four empty score columns and a wide notes field ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L141-L179)). On a narrow screen this becomes a horizontally scrolling desktop table rather than a mobile decision interface ([globals.css, 2026](../src/app/globals.css#L41-L65)).

**Required change:** show only decision-critical content in the catalogue: model name/provider, recommendation or use case, capability tags, input/output price, context, source freshness, favourite, and compare action. Move model IDs, raw metrics, source detail, cache rates, and notes into a detail drawer.

#### P0 - The product lacks a direct route from task to shortlist

Current filters cover only free-text search, provider, and favourites ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L130-L137)). The user must infer suitability from raw columns and prose notes.

**Required change:** add capability/task filters: coding, reasoning, vision, audio/video, long context, preferred providers, available lane, maximum input price, maximum output price, and favourites. Include quick starts such as **Cheapest Coding**, **Vision Under $1/M**, **Long Context**, and **My Available Models**.

#### P1 - Comparison is awkward and begins too late

Comparison requires switching tabs and finding models in a long native select menu. The selection cap is silent and selected names double as remove buttons ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L221-L274)).

**Required change:** add a global compare tray. Every model card should expose a labelled **Add to Compare** action. The tray should show the count, permit quick removal, and open the comparison view. The comparison view should highlight the winner per metric and explain missing data rather than presenting only raw cells.

#### P1 - State, trust, and feedback are invisible

The UI does not expose its existing freshness/source fields, provides no loading or error state around data fetches, and does not preserve decisions in the URL ([Dashboard.tsx, 2026](../src/components/Dashboard.tsx#L69-L88)). Favourites update only after a round-trip fetch with no success/error announcement.

**Required change:** show **Updated [relative time]**, provider/source links, data-completeness status, loading skeletons, a retry action, and an `aria-live` confirmation after favourite changes. Persist selection state in query parameters.

#### P1 - Accessibility semantics need a baseline repair

Form labels identify controls and create a larger activation target; W3C recommends labels for text fields, checkboxes, and drop-downs ([World Wide Web Consortium, 2024](https://www.w3.org/WAI/tutorials/forms/labels/)). The app’s search input and provider selector have neither visible labels nor accessible names. Its content-switching buttons do not implement the tab semantics and keyboard model expected of a true tab interface ([World Wide Web Consortium, 2026b](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)).

**Required change:** label every control, make favourite/compare buttons descriptive, use buttons inside sortable table headers with `aria-sort`, add `:focus-visible` styling, use `aria-live` feedback, and either implement correct tabs or redesign the controls as ordinary navigation links/segmented views.

## Recommended information architecture

```text
Dashboard
├── Discover Models (default)
│   ├── Quick starts: task and budget
│   ├── Filters: capability, price, provider, availability, context
│   ├── Result cards/list
│   └── Model detail drawer
├── Compare (persistent tray opens this)
│   ├── Decision summary
│   ├── Cost/capability/quality matrix
│   └── Source and freshness detail
├── Cost Planner
│   ├── Workload scenario
│   ├── Budget and baseline
│   └── Ranked viable options
└── Saved Views (phase 2, optional)
```

### Primary screen: Discover Models

The default experience should begin with one question: **What are you choosing a model for?** The answer creates an initial filter and ranking, not a hard recommendation. For example:

- **Coding** - prioritises coding evidence, reasoning, context, and cost.
- **General agent** - prioritises reasoning, context, tool/API availability, and cost.
- **Vision** - requires image input and exposes image-specific context/cost constraints.
- **Lowest cost** - ranks only fully priced models by the active scenario.
- **Premium fallback** - ranks reliability/quality signals, then shows the cost delta.

Each result should provide a one-line reason: “Lowest fully priced vision option in this workload” or “Higher coding evidence than your baseline, +$4.20/month.” This makes the rationale inspectable rather than hiding it behind a score.

### Model detail drawer

The drawer keeps the compact list useful while protecting advanced information:

- Price breakdown: input, output, cache read/write, estimated scenario cost.
- Capabilities: reasoning, modalities, context, maximum output, availability lanes.
- Evidence: individual benchmarks, category calculation source, data freshness, and source link.
- Decision notes: existing notes and optional personal note editing in a later phase.
- Actions: favourite, add/remove compare, use as cost baseline.

### Compare

Comparison should answer “which trade-off is worth it?” rather than simply mirror fields. It should contain:

- A concise recommendation strip for the active workload.
- Visual emphasis for lowest cost, largest context, and strongest available relevant evidence.
- A “not comparable” treatment when the supporting data is absent; never imply equality from two missing values.
- Direct links to source and a timestamp for every data-dependent conclusion.

### Cost Planner

The cost screen should use an explicit scenario:

- Named scenario: “Default agent workload,” “Heavy coding,” or custom.
- Input tokens, output tokens, cache hit rate, and optional monthly budget.
- A selected baseline model for savings/overage comparisons.
- Viable results: only models with complete relevant pricing.
- Separate **Pricing unavailable** section, not a fabricated $0 result.

## Implementation scope

### Phase 1 - Decision foundation

| Area | Included work | Done when |
|---|---|---|
| Catalogue | Responsive card/list view; compact decision fields; capability and price filters; quick-start filters; clear empty state. | A user can produce a short list without horizontal table scanning. |
| Detail | Accessible drawer with price, context, modality, source, freshness, notes, and raw evidence. | Advanced data is available without crowding the default view. |
| Compare | Global compare tray; labelled add/remove actions; comparison layout with missing-data treatment. | A user can compare 2-4 models from any main screen. |
| Pricing integrity | `Unknown` pricing state; no zero fallback; incomplete prices excluded from lowest-cost claims. | No missing price can be ranked as cheapest. |
| Feedback | Loading, empty, error, retry, and favourite success/failure states. | Every asynchronous result is intelligible. |
| State | URL query parameters for filters, sort, active view, compare IDs, and cost inputs. | Relevant views can be re-opened and shared. |
| Accessibility | Labels, names, focus styles, semantic sorting, keyboard support, live feedback, reduced-motion-safe transitions. | Keyboard-only completion is practical and controls expose useful names. |

### Phase 2 - Decision tools

| Area | Included work | Done when |
|---|---|---|
| Cost planner | Named scenarios, baseline comparison, budget thresholds, scenario summary. | A user can tell whether a shortlist fits a monthly budget. |
| Ranking | Transparent client-side ranking/rule explanations based on explicit criteria. | Every suggestion says why it appears and what data supports it. |
| Saved views | Save named filters/scenarios locally or in the database, subject to a separate product decision. | Frequently used decisions are one click away. |
| Data confidence | Coverage badges, stale-data indicator, and source provenance. | Users can distinguish missing, stale, and verified information. |

## Explicit non-goals

- No automated model recommendation that silently decides production model usage.
- No claim that benchmark data predicts all real-world task performance.
- No redesign of the existing synchronisation sources in Phase 1, except surfacing their current metadata and preventing misleading missing-price calculations.
- No authentication, multi-user collaboration, or external provider purchase/usage actions.
- No visual rebrand; retain the current dark visual language while improving hierarchy and usability.

## Data & decision rules

| Rule | Product behaviour |
|---|---|
| Missing input/output/cache price | Display **Pricing unavailable**; omit from total and lowest-cost rank. |
| Missing benchmark | Display **No comparable evidence**; do not show `0`, blank score, or winner styling. |
| Stale model record | Show a visible stale/data-age badge and source link. |
| Category score | Display only when at least one disclosed source contributes; reveal the source composition in details. |
| Recommendation | Phrase as “best match for selected criteria,” with criteria and exclusions visible. |
| Provider availability | Use existing availability metadata as a filter/badge; do not imply an account entitlement without validation. |

### Deployment credential policy

If a later approved integration needs a provider key, it will run server-side and receive its secret through Coolify environment variables. Existing credentials may be sourced from the Krasus environment file, but keys will never be committed to this repository, shown in the UI, copied into this report, or sent to the browser. Adding or changing production environment variables is deliberately deferred until the specific integration and deployment are approved.

## Acceptance criteria

### User outcomes

1. A user can find fully priced vision-capable models under an output-price ceiling in no more than two filter interactions.
2. A user can add two models to comparison directly from the discovery screen and open a useful comparison without manually re-finding either model.
3. A user can identify the cheapest **fully priced** viable model for a saved workload, and see the calculation inputs.
4. A user can open a copied URL and recover the selected view, filters, comparison selections, and cost inputs.
5. A user can identify when a number is unavailable, stale, or sourced from a particular provider.

### Quality & accessibility

1. Search, provider, capability, budget, and cost fields have visible labels or correct accessible names.
2. Every interactive control has a visible keyboard focus indicator. WCAG requires a visible focus indication for keyboard-operable UI ([World Wide Web Consortium, 2026a](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)).
3. Favourites, compare actions, sort buttons, drawers, and tabs/navigation are keyboard-operable and announce their state appropriately.
4. Sort controls expose their current sort direction and do not rely on clicking a table header cell.
5. All asynchronous operations have loading, error, and success feedback.
6. Desktop and mobile layouts have no essential horizontal page scrolling; dense tabular detail may scroll within an explicitly labelled comparison region.
7. `npm run lint` passes before deployment. The current baseline does not pass because of a dashboard React effect warning plus existing database/type lint rules.

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Scores remain sparse | Do not give them primary visual real estate. Show coverage and raw evidence only where available. |
| Ranking is mistaken for objective truth | Make selection criteria editable and recommendation rationale visible. |
| Pricing source differs by route/provider | Keep provider and source visible on model detail and cost results. |
| Too many filters recreate the spreadsheet problem | Start with task quick starts and compact progressive filters; keep rare filters behind “More filters.” |
| URL state becomes unwieldy | Keep only decision state in query parameters; persist large scenario metadata separately only if saved views are approved. |
| Mobile card layout loses precision | Reserve full-metric tables for comparison/detail, where users intentionally enter a deep-analysis mode. |

## Implementation sequence after approval

1. Define the new data-view model and pricing/unknown rules, then add test cases for incomplete data.
2. Build the shared shell, filter model, URL-state layer, loading/error states, and accessibility primitives.
3. Replace the catalogue table with responsive result cards/list plus a detail drawer.
4. Add the persistent compare tray and redesigned comparison screen.
5. Rebuild projections as the Cost Planner and validate calculations against selected source data.
6. Run keyboard, responsive, lint, and production-build verification; then deploy only after review.

## References

AI Model Dashboard. (2026). *Live production application*. https://ai.deejpotter.com/

AI Model Dashboard source. (2026). *Dashboard component, model API route, database schema, and synchronisation script*. Internal repository.

World Wide Web Consortium. (2024). *Labeling controls*. Web Accessibility Initiative. https://www.w3.org/WAI/tutorials/forms/labels/

World Wide Web Consortium. (2026a). *Understanding Success Criterion 2.4.7: Focus visible*. Web Accessibility Initiative. https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html

World Wide Web Consortium. (2026b). *Tabs pattern*. WAI-ARIA Authoring Practices Guide. https://www.w3.org/WAI/ARIA/apg/patterns/tabs/
