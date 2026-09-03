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
		DefaultNamespaceBaseIRI:   cfg.DefaultNamespaceBaseIRI(),
		BackstageKindPredicateIRI: cfg.BackstageKindPredicateIRI(),
		SyncSourcePredicateIRI:    cfg.SyncSourcePredicateIRI(),
		SyncStatusPredicateIRI:    cfg.SyncStatusPredicateIRI(),
		NamespaceClassIRI:         cfg.NamespaceClassIRI(),
		NamespacePrefixIRI:        cfg.NamespacePrefixPredicateIRI(),
	})
	sourceHandler := handler.NewSourceHandler(sourceRegistry, gdbClient, cfg.BackstageKindPredicateIRI(), syncEngine)

	r := newRouter(cfg, healthHandler, sparqlHandler, sourceHandler)

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
// healthcheck can't attach a header, and the route discloses nothing sensitive), every other route
// requires a validly-signed, unexpired bearer JWT (STORY-002) verified against cfg.AuthJWTSecret.
// Extracted from main() so it's testable without starting a real listener.
func newRouter(cfg config.Config, healthHandler *handler.HealthHandler, sparqlHandler *handler.SparqlHandler, sourceHandler *handler.SourceHandler) chi.Router {
	r := chi.NewRouter()
	r.Use(chimiddleware.Logger)
	r.Use(chimiddleware.Recoverer)

	r.Get("/health", healthHandler.Check)

	r.Group(func(r chi.Router) {
		r.Use(handler.JWTAuth(cfg.AuthJWTSecret))
		r.Post("/sparql", sparqlHandler.Query)
		r.Post("/sparql/update", sparqlHandler.Update)
		r.Get("/sources/{source}/discover", sourceHandler.Discover)
		r.Post("/sources/{source}/sync", sourceHandler.Sync)
	})

	return r
}
