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

// TestVerify_RejectsNonHS512Algorithm confirms Verify pins to exactly HS512 rather than accepting
// any HMAC-family algorithm — a token signed HS256 or HS384 with the *same* secret must be rejected
// (spec/deployment-req ADR: HS512 only, hard cut), closing the algorithm-confusion gap.
func TestVerify_RejectsNonHS512Algorithm(t *testing.T) {
	claims := jwt.RegisteredClaims{
		Subject:   "frontend-app",
		IssuedAt:  jwt.NewNumericDate(time.Now()),
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
	}
	for name, method := range map[string]jwt.SigningMethod{
		"HS256": jwt.SigningMethodHS256,
		"HS384": jwt.SigningMethodHS384,
	} {
		signed, err := jwt.NewWithClaims(method, claims).SignedString([]byte(testSecret))
		if err != nil {
			t.Fatalf("%s SignedString() error: %v", name, err)
		}
		if _, err := Verify(signed, testSecret); err == nil {
			t.Errorf("Verify() accepted an %s-signed token, want it rejected as not HS512", name)
		}
	}

	noneToken := "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJmcm9udGVuZC1hcHAifQ."
	if _, err := Verify(noneToken, testSecret); err == nil {
		t.Error("Verify() accepted an alg:none token")
	}
}

// TestMint_SignsHS512 confirms Mint emits an HS512 token (the header alg is what importctl
// mint-token hands to operators).
func TestMint_SignsHS512(t *testing.T) {
	signed, err := Mint(testSecret, "frontend-app", time.Hour)
	if err != nil {
		t.Fatalf("Mint() error: %v", err)
	}
	token, _, err := jwt.NewParser().ParseUnverified(signed, &jwt.RegisteredClaims{})
	if err != nil {
		t.Fatalf("ParseUnverified() error: %v", err)
	}
	if got := token.Method.Alg(); got != "HS512" {
		t.Errorf("alg = %q, want HS512", got)
	}
	if Algorithm != "HS512" {
		t.Errorf("Algorithm = %q, want HS512", Algorithm)
	}
}
