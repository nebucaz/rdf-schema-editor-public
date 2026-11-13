# ITAM shapes runbook: do the six data quality rules find every error?

Checks the six ITAM SHACL shapes against a small synthetic dataset with known defects. The question it
answers: **does the Validation report point out every planted error, and nothing else?** Seven of the 22
expected findings come from the in-memory rules and are also covered by automated tests; the other 15 come
from the `sh:sparql` rules, whose SPARQL text only GraphDB can run. That part is what this runbook proves.

Everything is invented and safe to share. Namespace base: `https://lida.pnet.ch/arm`.

## What is covered by what

| Findings | Count | Automated test | This runbook |
|---|---|---|---|
| In memory (`minCount`, `minLength`, `datatype`, `pattern`) | 7 | Yes: exact-set Go test over the real files (`backend/internal/validation/itam_golden_test.go`) | Confirms |
| `sh:sparql` | 15 | Only the code path: guard, `$this` binding, row mapping and coverage with canned rows (`itam_sparql_contract_test.go`) | **Only here**: whether the SPARQL texts return the right rows |

If a SPARQL finding is missing or extra, the cause is the SPARQL text or its escaping, not the engine's
mapping; see [If the numbers differ](#if-the-numbers-differ).

## 1. Load the sample

Needs the app, the backend and GraphDB running (see the repository `README.md`).

> **Use an empty GraphDB repository.** The sample's IRIs (`https://lida.pnet.ch/arm/schema#…`) are the
> real ITAM vocabulary's IRIs. Import looks up each subject in *every* graph of the repository, not only
> in registered namespaces. If the repository already holds ITAM data (for example the
> `pf-knowledge-sets/itam` graph), the import is re-homed to that graph and fails with hundreds of
> `which is not declared as owl:Class` errors about terms that are not in the sample. The report would
> also mix in findings from the real data. Create a new repository for this runbook; an empty `arm`
> namespace in a repository with ITAM data is not enough.

1. Hamburger menu → **Namespaces** → **Add**. Prefix `arm`, base IRI `https://lida.pnet.ch/arm`. Save, and
   make it the **Active namespace**.
2. Hamburger menu → **Import Turtle…**, **in this order** (an import is validated against what is already
   stored), choosing `arm` as the **Target graph** each time:
   1. `examples/itam-shapes/itam-schema.ttl`
   2. the six shape files, in any order: `AC-NAME-FORMAT-MODUL.ttl`, `AC-NAME-UNIQUE.ttl`,
      `AC-SPEC-ACCEPTED.ttl`, `AC-TECHID-EXISTS.ttl`, `AC-TECHID-FORMAT.ttl`, `AC-TECHID-UNIQUE.ttl`
   3. `examples/itam-shapes/itam-data.ttl`

**Expected:** each import reports its inserted triples with no validation errors. The shapes are imported
unchanged; the `sh:sparql` blocks are kept with their shapes.

## 2. The records

23 records: 22 of `Applikationskomponente`, one of `Infrastrukturkomponente`. This table has **one row per
record**, with all of its findings in the last column; the report and section 4 have **one row per
finding**, so R11 is one row here and three rows there. A record with no finding fails nothing.

| Record | What it is | Expected findings |
|---|---|---|
| R01 | clean | none |
| R02 | clean (module, abbreviation 3 characters) | none |
| R03 | clean (SPEC-ACCEPTED applies to Freigegeben only) | none |
| R04 | clean (module, 16-character abbreviation: upper boundary) | none |
| R10 | no A_TECHNICAL_ID | TECHID-EXIST (minCount) |
| R11 | id "" (empty) | TECHID-EXIST (minLength), TECHID-EXIST (sparql), TECHID-FORMAT (pattern) |
| R12 | id "  " (two spaces; minLength 1 passes) | TECHID-EXIST (sparql), TECHID-FORMAT (pattern) |
| R13 | id 1005 typed xsd:integer (lexical form is numeric) | TECHID-EXIST (datatype) |
| R14 | id A-77 | TECHID-FORMAT (pattern) |
| R15 | id 2001, same as R16 | TECHID-UNIQUE (sparql) |
| R16 | id 2001, same as R15 | TECHID-UNIQUE (sparql) |
| R17 | name Doppelt, same as R18 | NAME-UNIQUE (sparql) |
| R18 | name Doppelt, same as R17 | NAME-UNIQUE (sparql) |
| R19 | module, name without a dot | NAME-FORMAT-MODUL (sparql) |
| R20 | module, lower-case start | NAME-FORMAT-MODUL (sparql) |
| R21 | module, 17-character abbreviation (over the boundary) | NAME-FORMAT-MODUL (sparql) |
| R22 | module, module part of 40 characters | NAME-FORMAT-MODUL (sparql) |
| R23 | module, module part of 2 characters | NAME-FORMAT-MODUL (sparql) |
| R24 | Freigegeben, no type | SPEC-ACCEPTED (sparql) |
| R25 | Freigegeben, type Dienst | SPEC-ACCEPTED (sparql) |
| R26 | Freigegeben, type Dienst, id ABC | SPEC-ACCEPTED (sparql), TECHID-FORMAT (pattern) |
| R28 | module whose NAME is an IRI, not a literal | NAME-FORMAT-MODUL (sparql) |
| R29 | clean (Infrastrukturkomponente: same name and id as R01, the uniqueness rules look at Applikationskomponente only) | none |

## 3. Run the report

Open **Validation** (`/validation`) and press **Run Validation**. Tick **Group by quality dimension** to read
it like the catalogue.

**Banner:** none expected. If a banner reading "N constraints in M shapes are not checked by this report"
appears, copy its list into `spec/shacl-test/shape-findings.md`; it names a construct or a rejected query.

## 4. Expected findings (22)

| Record | Rule | Constraint | Path | Produced by |
|---|---|---|---|---|
| R10 | AC-TECHID-EXIST | minCount | A_TECHNICAL_ID | in memory (automated) |
| R11 | AC-TECHID-EXIST | minLength | A_TECHNICAL_ID | in memory (automated) |
| R11 | AC-TECHID-EXIST | sparql | A_TECHNICAL_ID | SPARQL (human run) |
| R11 | AC-TECHID-FORMAT | pattern | A_TECHNICAL_ID | in memory (automated) |
| R12 | AC-TECHID-EXIST | sparql | A_TECHNICAL_ID | SPARQL (human run) |
| R12 | AC-TECHID-FORMAT | pattern | A_TECHNICAL_ID | in memory (automated) |
| R13 | AC-TECHID-EXIST | datatype | A_TECHNICAL_ID | in memory (automated) |
| R14 | AC-TECHID-FORMAT | pattern | A_TECHNICAL_ID | in memory (automated) |
| R15 | AC-TECHID-UNIQUE | sparql | A_TECHNICAL_ID | SPARQL (human run) |
| R16 | AC-TECHID-UNIQUE | sparql | A_TECHNICAL_ID | SPARQL (human run) |
| R17 | AC-NAME-UNIQUE | sparql | NAME | SPARQL (human run) |
| R18 | AC-NAME-UNIQUE | sparql | NAME | SPARQL (human run) |
| R19 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |
| R20 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |
| R21 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |
| R22 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |
| R23 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |
| R24 | AC-SPEC-ACCEPTED | sparql | A_APP_CMP_TYPE | SPARQL (human run) |
| R25 | AC-SPEC-ACCEPTED | sparql | A_APP_CMP_TYPE | SPARQL (human run) |
| R26 | AC-SPEC-ACCEPTED | sparql | A_APP_CMP_TYPE | SPARQL (human run) |
| R26 | AC-TECHID-FORMAT | pattern | A_TECHNICAL_ID | in memory (automated) |
| R28 | AC-NAME-FORMAT-MODUL | sparql | NAME | SPARQL (human run) |

**Expected:** exactly these 22 rows and no others (compare with this table, not with the record table in
section 2). Rule ids are the `arm-s:id` of each shape as written
(including `AC-TECHID-EXIST`, which has no trailing S in the shape file). Tick each row as you see it.

Quick counts to check first: 22 findings in total; `AC-NAME-FORMAT-MODUL` 6, `AC-TECHID-EXIST` 5,
`AC-TECHID-FORMAT` 4, `AC-SPEC-ACCEPTED` 3, `AC-TECHID-UNIQUE` 2, `AC-NAME-UNIQUE` 2.

## If the numbers differ

- **Zero SPARQL findings, banner empty.** The `sh:sparql` blocks were not imported or not found. Check that
  all six shape files were imported into the `arm` shapes graph.
- **Banner lists a `sh:select` as rejected.** The guard refused a query. The reason names the rule; copy it
  to the shape findings.
- **Too few `AC-NAME-FORMAT-MODUL` findings (R19 to R23, R28).** Look at R20 and R21 first, then R22 and
  R23: they sit on the regex bounds. A missing R19 to R23 finding points at the regex escaping
  (`\\\\.` in the shape file); see section 2 of `spec/shacl-test/shape-findings.md`.
- **Extra findings on clean records (R01 to R04, R29).** R02 and R04 are modules and exercise the regex
  from the other side; R29 is the other class and must stay clean (the uniqueness rules only look at
  `Applikationskomponente`).
- **R11 shows one `AC-TECHID-EXIST` finding instead of two.** The `minLength` and `sh:sparql` checks both
  report an empty id; the report keeps both because they are different constraints. See section 4 of the
  shape findings.
- **R12 shows nothing for `AC-TECHID-EXIST`.** The blank-value check is the SPARQL one; `minLength 1` passes
  for two spaces. Look at the escaping of `\\\\s` in `AC-TECHID-EXISTS.ttl`.
- **Order or grouping looks odd.** The report sorts by identity, then rule id; grouping only regroups the same
  rows.

## 5. Clean up

Delete the `arm` namespace with the force option. Imports only ever add triples; nothing else is touched.
