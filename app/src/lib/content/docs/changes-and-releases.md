# Changes, Requests and Releases

The **Governance** area keeps the accountability of the core vocabulary and ontology: who owns it, what changed, why, and which version is current.

## Owners and version

On the Governance page, name the **steward** and the **authority**, pick a **maturity** (POC, pilot or production) and set the **version**. These are recorded, not enforced. The [Gate Report](gate-report) warns when the core namespace has no steward, authority or version.

## The change log

Every change to a concept, a class or a relation made in the app adds an entry to the change log: what was done, a rationale if you typed one, the term, the competency question when there is one, the kind of change, and the version it was made in. The entry is written by the server, which also records who and when; whatever the browser sends for those two is ignored. The log can be filtered by term, question and version. Changes made by the Backstage sync are data, not model, and are not logged here.

## Change requests

When a change needs a decision first, file a **change request**: the proposed term, definition or relations, the rationale, the kind of change and the **competency question** that justifies it. A request without a question is flagged, and can then only be returned for one or marked as a scope change on purpose. Take a request into review, then run **Assess impact**: it runs the whole question suite and the gates and lists the questions whose result changed and the gate findings that appeared or went away since the request was made. There is no reasoner involved; it shows what the questions and gates say now. Approving, rejecting, returning or marking a scope change needs a rationale, and an approved request adds a change log entry.

## Releases and semantic versions

**Release** on the Governance page reads the change log since the last release and suggests how the version should move, following semantic versioning (see pp. 236-237 of the book):

- **major**: a class removed or renamed, a changed domain or range, a new disjointness;
- **minor**: something added;
- **patch**: labels, comments and other small edits.

You can override the suggestion and edit the generated notes. Confirming writes the new `owl:versionInfo` and a release entry in one step. With nothing in the log since the last release, the dialog says there is nothing to release.

## Keeping an eye on quality

The **semantic debt** list on the [Pipeline View](pipeline-view) page gathers the known quality debts: undefined terms, concepts not reviewed for a while, concepts without an authority, drifted definitions, classes without a shape or without a question, failing questions, and questions whose review is overdue. The question review period (quarterly by default) and the staleness threshold are settings on that list, kept in your browser.
