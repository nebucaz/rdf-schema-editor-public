package handler

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthHandler_Check(t *testing.T) {
	h := &HealthHandler{}
	req := httptest.NewRequest(http.MethodGet, "/health", nil)
	w := httptest.NewRecorder()

	h.Check(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if got := w.Body.String(); got != `{"status":"ok"}`+"\n" {
		t.Errorf("body = %q, want ok status payload", got)
	}
}
