package plugin

import (
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/prometheus/prometheus/model/labels"
	"github.com/prometheus/prometheus/promql/parser"
)

var macroRegexp = regexp.MustCompile(`\$\w+`)

// replace macros like $node, $__rate_interval, etc.
func stripGrafanaMacros(expr string) string {
	return macroRegexp.ReplaceAllString(expr, "5m") // replace with dummy literal
}

// ExtractMetricNames parses a list of PromQL expressions and returns a deduped
// list of metric names referenced by any VectorSelector.
// - Handles both explicit metric names (e.g., up{...}) and name via __name__.
func ExtractMetricNames(exprs []string) (metrics []string, perExprErrors []string) {
	seen := make(map[string]struct{})
	perExprErrors = make([]string, len(exprs)) // empty string means no error

	add := func(name string) {
		if name == "" {
			return
		}
		if _, ok := seen[name]; !ok {
			seen[name] = struct{}{}
			metrics = append(metrics, name)
		}
	}

	for i, in := range exprs {
		expr, err := parser.ParseExpr(stripGrafanaMacros(in))
		if err != nil {
			perExprErrors[i] = err.Error()
			continue
		}
		parser.Inspect(expr, func(node parser.Node, _ []parser.Node) error {
			if vs, ok := node.(*parser.VectorSelector); ok {
				// Case 1: metric explicitly present (e.g., node_cpu_seconds_total{...})
				if vs.Name != "" {
					add(vs.Name)
					return nil
				}
				// Case 2: metric name set via __name__ label matcher
				for _, m := range vs.LabelMatchers {
					if m.Name == labels.MetricName && (m.Type == labels.MatchEqual || m.Type == labels.MatchRegexp) {
						// Only add on equality; regex can reference multiple metrics, so skip regex by default.
						if m.Type == labels.MatchEqual {
							add(m.Value)
						}
						break
					}
				}
			}
			return nil
		})
	}
	return metrics, perExprErrors
}

func (a *App) handleParseExprs(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Parse request body as JSON array of strings
	var exprs []string
	if err := json.NewDecoder(req.Body).Decode(&exprs); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return
	}

	metrics, perExprErrors := ExtractMetricNames(exprs)

	// Build response
	resp := map[string]interface{}{
		"ok":               true,
		"queriesReceived":  len(exprs),
		"exprs":            exprs,
		"metrics":          metrics,
		"metricsCount":     len(metrics),
		"parseErrorsByIdx": perExprErrors, // entries are "" if no error for that index
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
	}
}

// registerRoutes takes a *http.ServeMux and registers some HTTP handlers.
func (a *App) registerRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/parse", a.handleParseExprs)
}
