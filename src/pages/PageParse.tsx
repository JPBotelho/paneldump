import React from 'react';
import { testIds } from '../components/testIds';
import { PluginPage, locationService, getBackendSrv } from '@grafana/runtime';
import { lastValueFrom } from 'rxjs';

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

function PageParse() {
  const pluginId = "jcosta-paneldump-app"
  const [queries, setQueries] = React.useState<string[]>([])
  // Read query param "query"
  const dashboardId = locationService.getSearchObject().dashboard as string | "";
  const panelId = locationService.getSearchObject().panel as string | "";
  const timerange = locationService.getSearchObject().timerange as string | "";

  if (dashboardId === "" || panelId === "" || timerange === "") {
    alert("Failed to load panel.")
    return
  }

  React.useEffect(() => {
    //if (!dashboardId || Number.isNaN(panelId)) return;
    let cancelled = false;

    (async () => {
      try {
        const panel = await fetchPanelInfo(dashboardId, Number(panelId));
        console.log('Panel title:', panel.title);
        console.log('Datasource:', panel.datasource);
        console.log('Targets:', panel.targets);
        console.log('Full panel JSON:', panel.rawPanel);

        const payload = extractQueries(panel); // { exprs: string[] }
        console.log('Extracted queries:', payload);

        const res = await lastValueFrom(
          getBackendSrv().fetch<ParseResponse>({
            method: 'POST',
            url: `/api/plugins/${pluginId}/resources/parse`,
            data: payload,
          })
        );
        console.log(res!.data)
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
        <p>If this page is empty, access it through a panel.</p>
        {panelId && (
          <p>
            URL param <code>dashboard</code>: <b>{dashboardId}</b>
          </p>
        )}
        {panelId && (
          <p>
            URL param <code>panel</code>: <b>{panelId}</b>
          </p>
        )}
        {panelId && (
          <p>
            URL param <code>timerange</code>: <b>{timerange}</b>
          </p>
        )}
          {/* Render queries here */}
    {queries.length > 0 && (
      <div>
        <h3>Queries:</h3>
        <ul>
          {queries.map((q, i) => (
            <li key={i}>
              <code>{q}</code>
            </li>
          ))}
        </ul>
      </div>
    )}
      </div>
    </PluginPage>
  );
}

export default PageParse;
