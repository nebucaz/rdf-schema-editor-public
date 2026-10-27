// Package userjwt verifies the end-user access token the corporate SSO (or the dev login) places in
// the `Oglala` cookie. It is distinct from internal/jwtauth, which handles the service-to-service
// token: the two use separate secrets so a leaked user key cannot mint service tokens.
package userjwt

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// CookieName is the cookie the access token travels in.
const CookieName = "Oglala"

// maxTokenLength rejects absurdly large tokens before any parsing, carried over from the
// SvelteKit server's former `user-identity.ts`.
const maxTokenLength = 8192

// ErrInvalidToken is the only error Verify returns, so a caller cannot tell *why* a token failed.
var ErrInvalidToken = errors.New("invalid token")

// User is the verified identity extracted from an access token — only the claims this app uses.
type User struct {
	Sub               string
	Email             string
	PreferredUsername string
	GivenName         string
	FamilyName        string
	Name              string
	Department        string
	Groups            []string
}

// DisplayName is `name`, else `given_name family_name`, else `preferred_username`, else `sub`.
func (u User) DisplayName() string {
	if name := strings.TrimSpace(u.Name); name != "" {
		return name
	}
	if full := strings.TrimSpace(u.GivenName + " " + u.FamilyName); full != "" {
		return full
	}
	if u.PreferredUsername != "" {
		return u.PreferredUsername
	}
	return u.Sub
}

// Verify checks tokenString's HS256 signature against secret and its expiry (when present) and
// returns the user it identifies. `alg: none`, other algorithms, a missing/empty/non-string `sub`,
// an empty secret and oversized tokens are all rejected.
func Verify(tokenString, secret string) (User, error) {
	if secret == "" || tokenString == "" || len(tokenString) > maxTokenLength {
		return User{}, ErrInvalidToken
	}

	claims := jwt.MapClaims{}
	token, err := jwt.NewParser(jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()})).
		ParseWithClaims(tokenString, claims, func(*jwt.Token) (any, error) { return []byte(secret), nil })
	if err != nil || !token.Valid {
		return User{}, ErrInvalidToken
	}

	sub := stringClaim(claims, "sub")
	if sub == "" {
		return User{}, ErrInvalidToken
	}

	groups := []string{}
	if raw, ok := claims["groups"].([]any); ok {
		for _, g := range raw {
			if s, ok := g.(string); ok {
				groups = append(groups, s)
			}
		}
	}

	return User{
		Sub:               sub,
		Email:             stringClaim(claims, "email"),
		PreferredUsername: stringClaim(claims, "preferred_username"),
		GivenName:         stringClaim(claims, "given_name"),
		FamilyName:        stringClaim(claims, "family_name"),
		Name:              stringClaim(claims, "name"),
		Department:        stringClaim(claims, "department"),
		Groups:            groups,
	}, nil
}

func stringClaim(claims jwt.MapClaims, key string) string {
	s, _ := claims[key].(string)
	return s
}

// Mint signs an access token for u, valid for ttl. It sets `loginid` equal to `sub` and always
// emits `groups` as an array, so a minted token looks like one the corporate SSO issues. Only the
// dev login uses it; production tokens come from the SSO.
func Mint(secret string, u User, ttl time.Duration) (string, error) {
	if secret == "" {
		return "", errors.New("userjwt: empty secret")
	}
	groups := u.Groups
	if groups == nil {
		groups = []string{}
	}
	now := time.Now()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub":                u.Sub,
		"loginid":            u.Sub,
		"email":              u.Email,
		"preferred_username": u.PreferredUsername,
		"family_name":        u.FamilyName,
		"given_name":         u.GivenName,
		"name":               u.Name,
		"department":         u.Department,
		"groups":             groups,
		"iat":                now.Unix(),
		"exp":                now.Add(ttl).Unix(),
	})
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}
