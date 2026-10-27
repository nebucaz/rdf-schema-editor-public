package userjwt

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const secret = "user-secret"

func sign(t *testing.T, claims jwt.MapClaims, key string) string {
	t.Helper()
	s, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(key))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func future() int64 { return time.Now().Add(time.Hour).Unix() }

func TestVerify_ValidToken(t *testing.T) {
	tok := sign(t, jwt.MapClaims{
		"sub": "u123", "loginid": "u123", "email": "a@x.example", "preferred_username": "alice",
		"family_name": "Example", "given_name": "Alice", "name": "Alice Example", "department": "R&D",
		"groups": []string{"g1", "g2"}, "exp": future(),
	}, secret)

	u, err := Verify(tok, secret)
	if err != nil {
		t.Fatalf("Verify() error: %v", err)
	}
	if u.Sub != "u123" || u.Email != "a@x.example" || u.Department != "R&D" || len(u.Groups) != 2 || u.Groups[1] != "g2" {
		t.Errorf("claims = %+v", u)
	}
	if u.DisplayName() != "Alice Example" {
		t.Errorf("DisplayName() = %q", u.DisplayName())
	}
}

func TestVerify_DisplayNameFallbackChain(t *testing.T) {
	cases := []struct {
		name   string
		claims jwt.MapClaims
		want   string
	}{
		{"name", jwt.MapClaims{"sub": "s", "name": "N N", "given_name": "G", "family_name": "F", "preferred_username": "p"}, "N N"},
		{"given + family", jwt.MapClaims{"sub": "s", "name": "  ", "given_name": "G", "family_name": "F", "preferred_username": "p"}, "G F"},
		{"only given", jwt.MapClaims{"sub": "s", "given_name": "G"}, "G"},
		{"only family", jwt.MapClaims{"sub": "s", "family_name": "F"}, "F"},
		{"preferred_username", jwt.MapClaims{"sub": "s", "preferred_username": "p"}, "p"},
		{"sub", jwt.MapClaims{"sub": "s"}, "s"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.claims["exp"] = future()
			u, err := Verify(sign(t, tc.claims, secret), secret)
			if err != nil {
				t.Fatal(err)
			}
			if got := u.DisplayName(); got != tc.want {
				t.Errorf("DisplayName() = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestVerify_GroupsEmptyOrAbsentIsNonNil(t *testing.T) {
	u, err := Verify(sign(t, jwt.MapClaims{"sub": "s", "exp": future()}, secret), secret)
	if err != nil || u.Groups == nil || len(u.Groups) != 0 {
		t.Errorf("Groups = %#v, err %v; want empty non-nil slice", u.Groups, err)
	}
}

func TestVerify_Rejects(t *testing.T) {
	b64 := func(s string) string { return base64.RawURLEncoding.EncodeToString([]byte(s)) }
	noneToken := b64(`{"alg":"none","typ":"JWT"}`) + "." + b64(`{"sub":"s"}`) + "."
	hs512, _ := jwt.NewWithClaims(jwt.SigningMethodHS512, jwt.MapClaims{"sub": "s", "exp": future()}).SignedString([]byte(secret))

	cases := map[string]string{
		"bad signature":  sign(t, jwt.MapClaims{"sub": "s", "exp": future()}, "other"),
		"alg none":       noneToken,
		"hs512":          hs512,
		"expired":        sign(t, jwt.MapClaims{"sub": "s", "exp": time.Now().Add(-time.Hour).Unix()}, secret),
		"missing sub":    sign(t, jwt.MapClaims{"name": "x", "exp": future()}, secret),
		"empty sub":      sign(t, jwt.MapClaims{"sub": "", "exp": future()}, secret),
		"non-string sub": sign(t, jwt.MapClaims{"sub": 5, "exp": future()}, secret),
		"malformed":      "not.a.jwt",
		"empty":          "",
		"oversized":      sign(t, jwt.MapClaims{"sub": "s", "exp": future(), "pad": strings.Repeat("x", 9000)}, secret),
	}
	for name, tok := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Verify(tok, secret); err == nil {
				t.Error("Verify() accepted the token, want an error")
			}
		})
	}
}

func TestVerify_EmptySecretRejectsEverything(t *testing.T) {
	if _, err := Verify(sign(t, jwt.MapClaims{"sub": "s", "exp": future()}, ""), ""); err == nil {
		t.Error("Verify() with empty secret accepted a token")
	}
}

func TestMint_RoundTripsAndSetsLoginID(t *testing.T) {
	in := User{Sub: "u", Email: "e@x", PreferredUsername: "p", GivenName: "G", FamilyName: "F", Name: "G F", Department: "D", Groups: []string{}}
	tok, err := Mint(secret, in, time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	out, err := Verify(tok, secret)
	if err != nil || out.Sub != "u" || out.Email != "e@x" || out.Department != "D" || out.Groups == nil {
		t.Fatalf("out = %+v, err %v", out, err)
	}
	payload, _ := base64.RawURLEncoding.DecodeString(strings.Split(tok, ".")[1])
	if !strings.Contains(string(payload), `"loginid":"u"`) || !strings.Contains(string(payload), `"groups":[]`) {
		t.Errorf("payload = %s", payload)
	}
	if _, err := Mint("", in, time.Hour); err == nil {
		t.Error("Mint with empty secret succeeded")
	}
}
