// Command server runs the rdf-schema-editor backend — a standalone Go service that starts as a
// SPARQL gateway passthrough in front of GraphDB and grows into the deployable substrate later
// stories attach Backstage-sync routes and a background worker to (see spec/report/plan.md).
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"

	"github.com/nebucaz/rdf-schema-editor/backend/internal/annotations"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/backstage"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/config"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/graphdb"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/handler"
	"github.com/nebucaz/rdf-schema-editor/backend/internal/sync"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, using environment variables")
	}

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	healthHandler := &handler.HealthHandler{}
	sparqlHandler := handler.NewSparqlHandler(cfg)

	gdbClient := graphdb.NewClient(cfg)
	sourceRegistry := sync.NewRegistry()
	backstageSource := backstage.NewClient(cfg.BackstageBaseURL, cfg.BackstageToken)
	sourceRegistry.Register(backstageSource)

	syncEngine := sync.NewEngine(gdbClient, sync.Vocabulary{
		DefaultNamespaceBaseIRI:       cfg.DefaultNamespaceBaseIRI(),
		BackstageKindPredicateIRI:     cfg.BackstageKindPredicateIRI(),
		SyncSourcePredicateIRI:        cfg.SyncSourcePredicateIRI(),
		SyncStatusPredicateIRI:        cfg.SyncStatusPredicateIRI(),
		NamespaceClassIRI:             cfg.NamespaceClassIRI(),
		NamespacePrefixIRI:            cfg.NamespacePrefixPredicateIRI(),
		NamespacePredicateIRI:         cfg.NamespacePredicateIRI(),
		SourceFieldPredicateIRI:       cfg.SourceFieldPredicateIRI(),
		AppSettingsIRI:                cfg.AppSettingsIRI(),
		RepresentsPredicateSettingIRI: cfg.RepresentsPredicateSettingIRI(),
		SourceRelationPredicateIRI:    cfg.SourceRelationPredicateIRI(),
		SyncSourceRefPredicateIRI:     cfg.SyncSourceRefPredicateIRI(),
	})
	sourceHandler := handler.NewSourceHandler(sourceRegistry, gdbClient, cfg.BackstageKindPredicateIRI(), syncEngine)
	validationHandler := handler.NewValidationHandler(gdbClient)
	sharedQueryHandler := handler.NewSharedQueryHandler(gdbClient, cfg.DefaultNamespaceBaseIRI())
	annotationHandler := handler.NewAnnotationHandler(annotations.New(gdbClient, cfg.DefaultNamespaceBaseIRI()))

	r := newRouter(cfg, healthHandler, sparqlHandler, sourceHandler, validationHandler, sharedQueryHandler, annotationHandler)

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	syncWorker := &sync.BackstageSyncWorker{
		Engine:   syncEngine,
		Source:   backstageSource,
		Interval: cfg.BackstageSyncInterval,
	}
	go syncWorker.Run(rootCtx)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: r,
	}

	go func() {
		log.Printf("rdf-schema-editor backend listening on :%s\n", cfg.Port)
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("server error: %v", err)
		}
	}()

	<-rootCtx.Done()
	stop()

	log.Println("shutting down…")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}

// newRouter builds the service's chi router: /health stays open (docker-compose.yml's `wget`
// healthcheck can't attach a header, and the route discloses nothing sensitive), every other route except
// the session routes below requires a validly-signed, unexpired bearer JWT (STORY-002) verified against cfg.AuthJWTSecret.
// Extracted from main() so it's testable without starting a real listener.
func newRouter(cfg config.Config, healthHandler *handler.HealthHandler, sparqlHandler *handler.SparqlHandler, sourceHandler *handler.SourceHandler, validationHandler *handler.ValidationHandler, sharedQueryHandler *handler.SharedQueryHandler, annotationHandler *handler.AnnotationHandler) chi.Router {
	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)

	r.Get("/health", healthHandler.Check)

	// Session routes: no service token. They carry nothing secret (public settings, the caller's own
	// cookie identity, a dev-only login that is refused in production), and the frontend needs them
	// before it can do anything else — including before a service token is configured in dev.
	// Browser-originated POSTs are still CSRF-guarded.
	r.Group(func(r chi.Router) {
		r.Use(handler.CSRFGuard(cfg.AllowedOrigins))
		r.Use(handler.UserIdentity(cfg.UserJWTSecret))
		r.Get("/me", handler.MeHandler{}.Get)
		r.Get("/config", handler.NewConfigHandler(cfg).Get)
		if cfg.DevLoginEnabled {
			devLogin := handler.NewDevLoginHandler(cfg.UserJWTSecret, cfg.CookieSecure)
			r.Post("/auth/dev-login", devLogin.Login)
			r.Post("/auth/logout", devLogin.Logout)
		}
	})

	r.Group(func(r chi.Router) {
		r.Use(handler.JWTAuth(cfg.AuthJWTSecret))
		r.Use(handler.CSRFGuard(cfg.AllowedOrigins))
		r.Use(handler.UserIdentity(cfg.UserJWTSecret))
		// Service-only: the Backstage sync worker and importctl act without a user.
		r.Get("/sources/{source}/discover", sourceHandler.Discover)
		r.Get("/sources/{source}/raw/{kind}", sourceHandler.Raw)
		r.Post("/sources/{source}/sync", sourceHandler.Sync)

		// Everything the app itself reads or writes needs a signed-in user as well.
		r.Group(func(r chi.Router) {
			r.Use(handler.RequireUser)
			r.Post("/sparql", sparqlHandler.Query)
			r.Post("/sparql/update", sparqlHandler.Update)
			r.Get("/validation/report", validationHandler.Report)
			r.Post("/shared-queries", sharedQueryHandler.Create)
			r.Get("/shared-queries/{id}", sharedQueryHandler.Get)
			r.Post("/annotations", annotationHandler.Create)
			r.Delete("/annotations", annotationHandler.Delete)
		})
	})

	return r
}
