package validation

import (
	"crypto/sha256"
	"encoding/base32"
	"strings"
)

// findingIDLength is the number of base32 characters kept from the SHA-256 digest (80 bits).
const findingIDLength = 16

var findingIDEncoding = base32.StdEncoding.WithPadding(base32.NoPadding)

// FindingID is the stable identifier of a finding (spec/validation-issues-tracker): a short hash of
// individual, type, shape (the rule id when the shape IRI is empty), path and constraint, joined by
// NUL. The value, message and label are never part of it, so the same defect keeps its id across runs
// and edits of the wording. The type is part of it: one defect under two types is two findings.
// The frontend never re-derives it (testdata/golden/finding-id.json holds the vectors).
func FindingID(v Violation) string {
	shape := v.ShapeIri
	if shape == "" {
		shape = v.RuleId
	}
	key := strings.Join([]string{v.IndividualIri, v.TypeIri, shape, v.Path, v.Constraint}, "\x00")
	sum := sha256.Sum256([]byte(key))
	return strings.ToLower(findingIDEncoding.EncodeToString(sum[:]))[:findingIDLength]
}

// assignFindingIDs sets ID on every violation in place.
func assignFindingIDs(violations []Violation) {
	for i := range violations {
		violations[i].ID = FindingID(violations[i])
	}
}
