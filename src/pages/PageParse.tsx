import React from 'react';
import { testIds } from '../components/testIds';
import { PluginPage, locationService, getBackendSrv, getDataSourceSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';
import { DataSourceRef } from '@grafana/schema';
import { DataQueryRequest } from '@grafana/data';

export type DashboardApiResponse = {
  dashboard: any; // full dashboard JSON model
  meta: any;      // metadata (can include canSave, folderId, etc.)
};

export type PanelInfo = {
  id: number;
  title?: string;
  datasource?: any; // could be string (legacy), object {uid,type}, or null
  targets?: any[];
  rawPanel: any;    // full panel JSON
};

/**
 * Recursively search through panels (handles rows/nested panels)
 */
function findPanelById(panels: any[], id: number): any | undefined {
  for (const p of panels || []) {
    if (p?.id === id) {
      return p;
    }
    if (Array.isArray(p?.panels)) {
      const found = findPanelById(p.panels, id);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * Fetch a panel definition from a dashboard by UID + panel ID.
 */
export async function fetchPanelInfo(dashboardUid: string, panelId: number): Promise<PanelInfo> {
  const { dashboard } = await fetchDashboardByUid(dashboardUid);

  const panel = findPanelById(dashboard.panels || [], panelId);
  if (!panel) {
    throw new Error(`Panel ${panelId} not found in dashboard ${dashboardUid}`);
  }

  return {
    id: panel.id,
    title: panel.title,
    datasource: panel.datasource ?? null,
    targets: Array.isArray(panel.targets) ? panel.targets : [],
    rawPanel: panel,
  };
}
/**
 * Fetch the dashboard JSON (and meta) by UID, using the current user's session.
 * Throws on 401/403 or if the UID doesn't exist.
 */
export async function fetchDashboardByUid(uid: string): Promise<DashboardApiResponse> {
  const resp = await lastValueFrom(
    getBackendSrv().fetch<DashboardApiResponse>({
      method: 'GET',
      url: `/api/dashboards/uid/${encodeURIComponent(uid)}`,
    })
  );
  if (!resp?.data?.dashboard) {
    throw new Error('Dashboard not found or invalid response shape');
  }
  return resp.data;
}


function extractQueries(panel: PanelInfo): string[] {
  const out: string[] = [];
  for (const target of panel.targets!) {
    out.push(target.expr);
  }
  return out;
}
export type ParseResponse = {
  ok: boolean;
  queriesReceived: number;
  exprs: string[];
  metrics: string[];
  metricsCount: number;
  parseErrorsByIdx: string[]; // empty string means no error at that index
};

function toPrometheusText(resp: any) {
  let lines = [];

  // loop over all results
  for (const result of Object.values(resp.results) as any) {
    if (!result.frames) continue;

    for (const frame of result.frames) {
      const fields = frame.schema.fields;
      const timeField = fields.find((f: { type: string; }) => f.type === "time");
      const valueField = fields.find((f: { type: string; }) => f.type === "number");

      if (!timeField || !valueField) continue;

      const metricName = valueField.labels.__name__ || valueField.name;
      const labels = { ...valueField.labels };
      delete labels.__name__;

      // build labels string
      const labelsStr =
        Object.keys(labels).length > 0
          ? "{" +
            Object.entries(labels)
              .map(([k, v]) => `${k}="${v}"`)
              .join(",") +
            "}"
          : "";

      // values: [timeArray, valueArray]
      const [times, values] = frame.data.values;
      for (let i = 0; i < times.length; i++) {
        const ts = times[i]; // already ms epoch
        const val = values[i];
        lines.push(`${metricName}${labelsStr} ${val} ${ts}`);
      }
    }
  }

  return lines.join("\n");
}

export function downloadText(filename: string, text: string): void {
  const safeName = sanitizeFilename(filename);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });

  // IE/Edge (legacy) fallback
  const navAny = navigator as any;
  if (navAny && typeof navAny.msSaveOrOpenBlob === "function") {
    navAny.msSaveOrOpenBlob(blob, safeName);
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  // Feature-detect the download attribute
  if ("download" in a) {
    a.style.display = "none";
    a.href = url;
    a.download = safeName;
    // Some SPA routers are less likely to intercept if we stop propagation
    a.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    document.body.appendChild(a);
    a.click();
    // Cleanup in a microtask to avoid revoking too early
    setTimeout((): void => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  } else {
    // Safari fallback: open a data URL in a new tab
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      const w = window.open(dataUrl, "_blank");
      if (!w) {
        // If popups are blocked, navigate current tab as a last resort
        window.location.href = dataUrl;
      }
    };
    reader.readAsDataURL(blob);
  }
}

function sanitizeFilename(name: string): string {
  const cleaned = (name || "").replace(/[\/\\:*?"<>|]+/g, "_").trim();
  return cleaned || "download.txt";
}



 

function PageParse() {
  const pluginId = "jcosta-paneldump-app"
  const [queries, setQueries] = React.useState<string[]>([])
  // Read query param "query"
  const dashboardId = locationService.getSearchObject().dashboard as string | "";
  const panelId = locationService.getSearchObject().panel as string | "";
  const timerange = locationService.getSearchObject().timerange as string | "";
  const [dataSource, setDatasource] = React.useState<string>("")
  if (dashboardId === "" || panelId === "" || timerange === "") {
    alert("Failed to load panel.")
    return
  }
  const refIdFor = (i:number) => {
    const A = 'A'.charCodeAt(0);
    return i < 26 ? String.fromCharCode(A + i) : `Q${i}`;
  };
  async function handleQueryNow() {
    if(dataSource == "") {
      return;
    }
    const body = {
      queries: queries.map((expr, i) => ({
        format: 'time_series',
        refId: refIdFor(i),
        expr,
        datasource: { uid: dataSource },
        // keep your choice of query type; use 'time_series' or remove queryType
        // for range queries, or 'instant' for a single timestamp.
        queryType: 'instant',
      })),
      from: JSON.parse(timerange).from,
      to: JSON.parse(timerange).to,
    };
    
    const resp = await getBackendSrv().post('/api/ds/query', body);
    const metric_format = toPrometheusText(resp)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `metrics-${stamp}.prom`;
    downloadText(filename, metric_format);
    //console.log(resp);
    //console.log(metric_format)
  
    //console.log('Response frames:', resp.data);
  }

  React.useEffect(() => {
    //if (!dashboardId || Number.isNaN(panelId)) return;
    let cancelled = false;

    (async () => {
      try {
        const panel = await fetchPanelInfo(dashboardId, Number(panelId));
        //console.log('Panel title:', panel.title);
        //console.log('Datasource:', panel.datasource);
        setDatasource(panel.datasource.uid);
        //console.log('Targets:', panel.targets);
        //console.log('Full panel JSON:', panel.rawPanel);

        const payload = extractQueries(panel); // { exprs: string[] }
        //console.log('Extracted queries:', payload);

        const res = await lastValueFrom(
          getBackendSrv().fetch<ParseResponse>({
            method: 'POST',
            url: `/api/plugins/${pluginId}/resources/parse`,
            data: payload,
          })
        );
        ////console.log(res!.data)
        if (!cancelled) {
          setQueries(res.data?.metrics ?? []);
        }
      } catch (e) {
        console.error('Error fetching panel:', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [dashboardId, panelId, pluginId]);
  return (
    
    <PluginPage>
      <div data-testid={testIds.pageTwo.container}>
        
        {panelId && (
          <p>
            Dashboard: <code>{dashboardId}</code>
          </p>
        )}
        {panelId && (
          <p>
            Panel: <code>{panelId}</code>
          </p>
        )}
        {panelId && (
          <p>
            Time range: <code>{timerange}</code>
          </p>
        )}
          {/* Render queries here */}
    {queries.length > 0 && (
      <div>
        <h3>Metrics:</h3>
        <ul>
          {queries.map((q, i) => (
            <li key={i}>
              <code>{q}</code>
            </li>
          ))}
        </ul>
      </div>
    )}
    {/* Query button at the end */}
    <div style={{ marginTop: 16 }}>
          <button onClick={handleQueryNow}>Download metrics</button>
        </div>
      </div>
    </PluginPage>
  );
}

export default PageParse;
