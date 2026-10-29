# Validation Report View

A read-only SHACL constraint-violation report. Available inline and as the dedicated **Validation
Report** route, via the **Validation** tab in the navigation strip.

## What you see

Click **Run Validation** to fetch a fresh report — nothing is cached or persisted, so reopening this
view or clicking Run again always starts from a clean slate. Each violation shows:

- The **individual** that violates a constraint (linked to its Identities resource page).
- Its **type** (class).
- The **path** (property) and **constraint** that failed, plus a human-readable message.

Use the **namespace filter** in the header to show/hide violations by the violating individual's own
namespace.

## Related

- [SHACL/structural validation](shacl-validation) — what's actually being checked and when.
- [The `/identities` area](identities-area) — where a violation's individual link leads.
