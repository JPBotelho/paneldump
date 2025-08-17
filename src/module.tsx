import React, { Suspense, lazy } from 'react';
import { AppPlugin, type AppRootProps, PluginExtensionPoints } from '@grafana/data';
import { LoadingPlaceholder } from '@grafana/ui';

const LazyApp = lazy(() => import('./components/App/App'));
import pluginJson from './plugin.json';

const App = (props: AppRootProps) => (
  <Suspense fallback={<LoadingPlaceholder text="" />}>
    <LazyApp {...props} />
  </Suspense>
);

export const plugin = new AppPlugin<{}>().setRootPage(App).addLink({
  targets: [PluginExtensionPoints.DashboardPanelMenu],
  title: 'Test UI Extension',
  description: 'Run a custom action on this panel',
  path: `/a/${pluginJson.id}/foo`,
  // The `context` is coming from the extension point.
  // (Passed in to the `usePluginLinks({ context })` hook.)
  configure: (context:any) => {
    // Returning `undefined` will hide the link at the extension point.
    // (In this example we are NOT showing the link for "timeseries" panels.)
    return {
      path: `/a/${pluginJson.id}/parse?dashboard=${context.dashboard.uid}&panel=${context.id}&timerange=${JSON.stringify(context.timeRange)}`,
    };

    // Returning an empty object meanst that we don't update the link properties.
    return {};
  },
});;