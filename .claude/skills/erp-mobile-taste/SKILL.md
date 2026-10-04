---
name: erp-mobile-taste
description: Audit and modernize the mobile-first layout of an existing manufacturing ERP. Use for mobile layout, hierarchy, density, navigation, lists, details, forms, filters, sheets, actions, responsive behavior, and workflow surfaces. Preserve business logic, APIs, routes, permissions, terminology, state machines, and approval semantics.
---

# ERP Mobile Taste

Lightweight UI judgment for a modern mobile-first manufacturing ERP.

## 1. Product Read

Treat the product as:

- enterprise manufacturing ERP
- task-driven and workflow-driven
- high-density operational software
- frequently used one-handed on phones
- optimized for clarity, speed, trust, and error prevention

Default dials:

- `DESIGN_VARIANCE: 3`
- `MOTION_INTENSITY: 2`
- `VISUAL_DENSITY: 8`

Never make the ERP resemble a marketing site, lifestyle app, or Dribbble concept.

## 2. Preserve Business Semantics

UI work must not change:

- routes or route meaning
- business terminology
- APIs or payload contracts
- database behavior
- permissions or role boundaries
- approval/confirmation semantics
- status lifecycles
- upstream/downstream process relationships
- validated business rules
- destructive-action safeguards

If visual simplicity conflicts with business correctness, business correctness wins.

## 3. Audit Before Editing

Before changing an existing surface, inspect:

- app shell and navigation
- information hierarchy
- spacing and typography
- lists/tables and row density
- action hierarchy
- forms and filters
- status visibility
- loading/empty/error/disabled states
- sticky/fixed elements
- overflow and viewport behavior
- repeated cards, labels, controls, or containers
- inconsistency across related modules

Classify findings:

- `P0`: blocks work or risks business error
- `P1`: major mobile usability/layout issue
- `P2`: hierarchy/consistency/efficiency issue
- `P3`: cosmetic polish

Fix structure before decoration.

## 4. Mobile Baseline

Primary viewport: `390px`.

Mandatory checks:

- `320px`
- `390px`
- `430px`
- `680px`

Rules:

- mobile-first, then enhance upward
- no horizontal page scrolling
- use `100dvh` when full-height behavior is needed
- account for safe-area insets on fixed top/bottom UI
- fixed/sticky UI must never cover content
- allow horizontal scrolling only where two-dimensional data requires it
- preserve information and functionality at 320px

## 5. Layout Rhythm

Recommended gutters:

- 320-430px: `16px`
- compact tablet: `20-24px`

Preferred spacing scale:

`4 / 8 / 12 / 16 / 24 / 32`

Typical relationships:

- icon ↔ label: `8px`
- label ↔ value: `4-8px`
- related controls: `8-12px`
- form fields: `12-16px`
- content groups: `20-24px`
- major sections: `24-32px`

Use existing tokens when available. Avoid random one-off spacing.

Whitespace communicates hierarchy; it is not decoration.

## 6. Page Hierarchy

A user should quickly know:

1. where they are
2. which object/task is open
3. its status
4. the most important facts
5. the next valid action

Preferred hierarchy:

`context → object/task → status → key facts → detail → actions`

Avoid repeated page titles, module names, object types, and statuses in stacked containers.

Use one dominant heading per mobile page.

## 7. Navigation and Shell

Preserve established information architecture unless redesign is explicitly requested.

- keep top bars compact
- avoid oversized headers
- keep primary navigation stable
- make current location obvious
- move low-frequency destinations into menus/sheets
- do not add navigation layers without workflow need
- do not add bottom navigation merely because the app is mobile

## 8. Lists and Work Queues

ERP lists are working surfaces, not card galleries.

Prefer:

- continuous list surfaces
- dividers or grouped rows
- compact metadata
- strong primary identifiers
- clear status markers
- predictable row actions

A row should usually expose:

- primary identifier/name
- primary status
- 2-4 high-value facts
- exception/warning only when relevant
- clear detail target

Do not display every database field in the list.

Use progressive disclosure:

`LIST → DETAIL → EDITOR / WORKFLOW`

Avoid wrapping every row in a floating card.

## 9. Dense Data and Tables

Do not blindly convert tables into cards.

Choose by task:

- record scanning → mobile list
- cross-record comparison → compact table
- many unequal-priority columns → priority fields + detail drill-down
- inherently 2D business data → intentional horizontal table scrolling

Align numeric values consistently.

Use tabular numerals when supported.

Do not force monospace for all numbers.

## 10. Detail Surfaces

Recommended order:

1. compact object header
2. status + critical exception
3. key facts
4. next valid actions
5. business sections
6. history/audit/supporting detail

Prefer sections, dividers, and spacing before cards.

Use cards only for real surface boundaries, summary objects, or elevated action regions.

Avoid nested cards.

## 11. Forms and Editors

Default to one-column mobile forms.

- labels above inputs
- helper text only when useful
- units adjacent to values
- clear required/optional treatment
- group fields by business meaning
- use appropriate input types
- validate inline near the field
- never use placeholder text as the only label

For long editors:

- divide into logical sections
- preserve entered data
- show unsaved state when relevant
- use sticky bottom actions only when helpful
- ensure sticky actions never cover fields/errors

Separate destructive actions from ordinary save actions.

## 12. Actions

Aim for:

- one primary action
- quieter secondary actions
- separated destructive actions
- overflow for rare actions

Avoid multiple equal-weight primary buttons on narrow screens.

Preserve established ERP action terminology.

Never rename workflow actions just to sound modern.

## 13. Search, Filters, and Selection

Prefer:

- visible search when frequently used
- compact filter trigger with active state/count
- bottom sheet or full-screen filters on mobile
- easy-to-clear applied filter summary
- persistent selection during batch operations

Avoid permanent rows of many filter chips.

Use chips only for real statuses, categories, selections, or active filters.

## 14. Sheets and Dialogs

Use bottom sheets for:

- short selections
- filters
- quick actions
- compact context

Use full pages/full-screen editors for:

- complex forms
- multi-section work
- high-risk workflows
- tasks requiring substantial context

Use dialogs for short blocking decisions or confirmation.

Never stack modal over modal.

## 15. Typography, Color, and Shape

Typography:

- use the existing project font unless change is justified
- keep roles limited: page title, section title, body/value, metadata, label
- avoid giant marketing type, decorative serif switching, excessive uppercase, and excessive tracking

Color:

- use accent for primary action, active navigation, selection, and meaningful emphasis
- keep status colors consistent across modules
- never communicate status by color alone
- no decorative gradients, neon, or glassmorphism

Shape:

- use one coherent radius system
- modest radius for controls
- slightly larger radius for sheets/dialogs
- pills only for compact semantic states
- prefer border/divider/surface tone before shadow

Avoid pill-everything, card-everything, and shadow-everything.

## 16. Touch and Accessibility

Design for touch first.

- primary targets should normally provide ~`44x44px` comfortable hit area
- avoid tightly packed tiny icon buttons
- keep visible keyboard focus
- associate errors with fields
- maintain readable contrast
- preserve semantic HTML
- provide accessible names for icon-only controls
- dragging must not be the only way to complete an action
- respect `prefers-reduced-motion`

## 17. Motion

Default `MOTION_INTENSITY: 2`.

Allowed:

- short state transitions
- sheet/dialog transitions
- expand/collapse
- pressed/selected feedback
- subtle loading transitions

Avoid:

- scroll hijacking
- parallax
- animated backgrounds
- continuous decorative animation
- physics effects
- long page-entry sequences

Motion must never delay task completion.

## 18. UI States

Consider where relevant:

- loading
- empty
- error
- offline/network failure
- disabled
- read-only
- permission denied
- partial data
- selected
- saving/submitting
- success
- business warning
- destructive confirmation

Skeletons should resemble final layout.

Empty states should explain the next useful action, not become decorative illustrations.

## 19. Anti-Slop

Reject these defaults unless the existing product genuinely requires them:

- card-everywhere layouts
- giant hero headers
- marketing-style dashboard intros
- decorative purple/blue gradients
- glass panels and excessive blur
- excessive pills
- huge whitespace that harms working density
- centered operational text
- decorative floating icons
- unnecessary charts
- repeated section labels
- identical three-card layouts
- excessive shadows
- mixed icon families
- decorative animation
- renamed business terminology

A modern ERP should feel intentionally engineered, not AI-generated.

## 20. Responsive Transformation

Do not merely shrink desktop UI.

For every region explicitly choose:

- keep
- reorder
- collapse
- summarize
- move to sheet
- move to detail
- make sticky
- hide only if truly non-essential

Desktop side-by-side regions usually become ordered vertical regions.

Mobile priority follows the user's task, not DOM convenience.

## 21. Implementation Discipline

Work with the existing stack.

Before adding dependencies:

- inspect current components and tokens
- reuse sound primitives
- never introduce a second design system
- do not replace stable components only for aesthetics

Prefer existing primitives + CSS Grid/Flex over new dependencies.

Create shared layout primitives only after the pattern is proven across multiple screens.

## 22. Whole-Mobile Modernization

When the scope is the whole mobile product:

### A. Inventory
Map shell, launcher, module entries, lists, details, editors, workflows, reports, sheets/dialogs, and UI states.

### B. Cross-Product Audit
Find inconsistencies in gutters, headers, spacing, density, status display, cards, buttons, forms, sticky actions, navigation, and safe areas.

### C. Foundation
Normalize spacing, type roles, radii, semantic colors, gutters, app bars, row rhythm, action hierarchy, and elevation.

### D. Representative Surfaces
Modernize and validate first:

1. launcher/home
2. one dense list
3. one detail page
4. one editor
5. one workflow/approval page

Do not propagate a visual language before these representatives work.

### E. Rollout
Apply proven patterns across modules without changing business behavior.

### F. Acceptance
Check `320 / 390 / 430 / 680`, then run existing functional, contract, and regression tests.

## 23. Required Work Pattern

Before code, state one compact line:

`ERP Design Read: <scope>; primary task: <task>; density: <level>; main layout issues: <issues>; preserve: <constraints>.`

Then:

1. audit current layout
2. propose the smallest coherent design-system/layout changes
3. identify reusable existing components/tokens
4. implement
5. visually verify target widths
6. run affected tests
7. report remaining issues

Do not write long aesthetic essays.

## 24. Pre-Flight

Do not declare finished until:

- [ ] business logic/workflow semantics unchanged
- [ ] 390px is intentionally designed
- [ ] 320/390/430/680 verified
- [ ] no unintended horizontal page scroll
- [ ] safe areas and sticky/fixed UI are correct
- [ ] hierarchy and primary action are obvious
- [ ] status is clear without color alone
- [ ] lists are dense but readable
- [ ] cards are justified
- [ ] forms work with validation and keyboard
- [ ] touch targets are comfortable
- [ ] loading/empty/error states are handled
- [ ] no gradient/glass/hero/AI-slop pattern introduced
- [ ] no unnecessary dependency/design system introduced
- [ ] established terminology is preserved
- [ ] relevant existing tests pass

If any applicable item fails, the layout is not finished.
