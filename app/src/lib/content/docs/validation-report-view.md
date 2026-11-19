# Validation Report View

A read-only SHACL constraint-violation report. Available inline and as the dedicated **Validation
Report** route, via the **Validation** tab in the navigation strip.

Validation checks the **data** against the SHACL shapes. Whether the **model** is well built is a separate question, answered by the **Model checks** tab on the Pipeline page; the two never share counts.

## What you see

The page opens with the findings of the **last run**, so a finding link works without running anything; the
toolbar says "Last run <time>". Click **Run Validation** to check again: the run replaces the list and also
creates, resolves and re-opens the [issues](validation-issues) of the findings. The list stays in the page while you follow a
link and come back with the browser's Back button, with the same Group by choice and folded blocks. Before the
very first run the page only shows the hint. A summary line above the result reads
"N findings in M identities" and counts only what the namespace filter leaves visible. After a run it adds
"X new · Y tracked · Z resolved since the last run".

The **Group by** control chooses how the findings are arranged:

- **Identity** (the default): one block per identity, with its label (linked to its Identities resource
  page), its type and its finding count, most findings first. Each block's header has a fold button;
  **Collapse all** and **Expand all** next to the summary line fold every block. Folding only hides rows
  on screen — counts, exports and printing are not affected.
- **Rule**: one heading per rule id (the shape's `arm-s:id`) with a count; the summary also lists the count
  per rule.
- **Quality dimension**: one heading per dimension (from the shape's `arm-s:qualityDimension`) with a count;
  findings without a dimension sit under "Unspecified", last.
- **None**: one flat table.

Each finding shows its **rule** (the shape's IRI as tooltip), the **path** and **constraint** that failed,
the **value** that broke the rule and the message: the shape's own `sh:message` when it has one (shown as
written, for example in German), else a generated text. The value is quoted when it is text, so an empty
value (`""`) and a blank one (`"  "`) are visible; it is a short name for a datatype or class finding, and
empty when the rule has no single offending value (for example a missing required property).

Each row ends with its **issue**: the issue id (a link to the [Issues page](validation-issues)), the assignee, a
link to the ticket in the workflow tool when one is set, and a "new issue created" tag on the run that created it.
Under the message, **Copy link** copies a link to this one finding (`/validation?finding=<id>`). Opening such a link
highlights the finding and unfolds its identity. If the finding is not in the last run (for example because it was
fixed) the page says so and links to its issue; a malformed id only shows a notice.

A banner above the result appears when the run could not check some constraints: "N constraints in M
shapes are not checked by this report", with a list of the rule, the construct and the reason. No banner
means every constraint the shapes declare was checked.

## Export

The **Export** menu is available after a run and exports what is on screen: the findings left visible by
the namespace filter, plus the list of constraints that were not checked, the run time and the app version.

- **CSV** and **JSON** are always flat, one row or entry per finding, whatever the Group by setting. In
  the CSV the not-checked constraints follow as rows with `kind` = `notChecked`. Cells that a spreadsheet
  would run as a formula are neutralised with a leading apostrophe.
- **Markdown** follows the chosen Group by view and lists the not-checked constraints first.
- **PDF** opens the browser's print dialog; choose "Save as PDF". The printed page hides the controls,
  starts with the title, run time, version and summary, and prints every identity block expanded.

Use the **namespace filter** in the header to show/hide violations by the violating individual's own
namespace.

## Related

- [Validation issues](validation-issues) — the persistent issue per finding, its lifecycle and the Issues page.
- [SHACL/structural validation](shacl-validation) — what's actually being checked and when.
- [The `/identities` area](identities-area) — where a violation's individual link leads.
