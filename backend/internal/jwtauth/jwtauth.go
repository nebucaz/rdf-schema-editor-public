// Package jwtauth holds the HS256 JWT signing/verification logic shared between the backend's
// request-auth middleware (internal/handler/auth.go, STORY-002) and importctl's minting subcommand
// (cmd/cli/main.go's mint-token, STORY-003) — both sides must agree on exactly the same claim shape.
package jwtauth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// ErrInvalidToken is returned by Verify for any failure — missing/malformed/bad-signature/expired
// tokens are deliberately collapsed into one generic error so callers don't leak *why* verification
// failed (a signature/format oracle) to whoever presented the token.
var ErrInvalidToken = errors.New("invalid token")

// Mint signs a JWT for sub, with iat set to now and exp set to now+ttl.
func Mint(secret, sub string, ttl time.Duration) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   sub,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(ttl)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		return "", fmt.Errorf("sign token: %w", err)
	}
	return signed, nil
}

// Verify checks tokenString's HS256 signature against secret and its expiry, returning the
// verified `sub` claim on success. Any failure — missing signature, wrong algorithm, bad
// signature, expired token — returns ErrInvalidToken with no further detail.
func Verify(tokenString, secret string) (string, error) {
	token, err := jwt.ParseWithClaims(tokenString, &jwt.RegisteredClaims{}, func(t *jwt.Token) (any, error) {
		// Pin to exactly HS256 (not just "any HMAC variant") — matches plan.md's ADR ("HS256, one
		// shared secret") exactly, and is the standard defense against algorithm-confusion attacks
		// (accepting whatever alg the token itself claims, e.g. "none" or a mismatched family).
		if t.Method != jwt.SigningMethodHS256 {
			return nil, ErrInvalidToken
		}
		return []byte(secret), nil
	})
	if err != nil || !token.Valid {
		return "", ErrInvalidToken
	}

	claims, ok := token.Claims.(*jwt.RegisteredClaims)
	if !ok || claims.Subject == "" {
		return "", ErrInvalidToken
	}
	return claims.Subject, nil
}
