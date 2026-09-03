package jwtauth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-signing-secret"

func TestMintVerify_RoundTrip(t *testing.T) {
	token, err := Mint(testSecret, "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}

	sub, err := Verify(token, testSecret)
	if err != nil {
		t.Fatalf("Verify() error: %v", err)
	}
	if sub != "frontend-app" {
		t.Errorf("sub = %q, want frontend-app", sub)
	}
}

func TestVerify_WrongSecret(t *testing.T) {
	token, err := Mint(testSecret, "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}

	if _, err := Verify(token, "wrong-secret"); err == nil {
		t.Error("Verify() succeeded with the wrong secret, want an error")
	}
}

func TestVerify_Expired(t *testing.T) {
	token, err := Mint(testSecret, "frontend-app", -time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}

	if _, err := Verify(token, testSecret); err == nil {
		t.Error("Verify() succeeded with an expired token, want an error")
	}
}

// TestVerify_RejectsNonHS256Algorithm confirms Verify pins to exactly HS256 rather than accepting
// any HMAC-family algorithm — a token signed HS384 with the *same* secret must still be rejected,
// matching plan.md's ADR ("HS256, one shared secret") and closing an algorithm-confusion gap a
// delta security review flagged after Sprint 1 shipped.
func TestVerify_RejectsNonHS256Algorithm(t *testing.T) {
	claims := jwt.RegisteredClaims{
		Subject:   "frontend-app",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS384, claims)
	signed, err := token.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("SignedString() error: %v", err)
	}

	if _, err := Verify(signed, testSecret); err == nil {
		t.Error("Verify() accepted an HS384-signed token, want it rejected as not HS256")
	}
}
