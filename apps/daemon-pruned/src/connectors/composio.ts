// Reference: apps/daemon/src/connectors/composio.ts
export const composioConnectorProvider: any = {
  configureCatalogCache() {},
  startCatalogRefreshLoop() {},
  stopCatalogRefreshLoop() {},
  clearDiscoveryCache() {},
  refreshCatalog(signal?: any): Promise<any[]> { return Promise.resolve([]); },
  listDefinitions(signal?: any, options?: any): Promise<any[]> { return Promise.resolve([]); },
  getFastDefinitions(signal?: any): any[] { return []; },
  getDefinition(id?: string, signal?: any) { return null; },
  getHydratedDefinition(id?: string, signal?: any) { return null; },
  getPreviewDefinition(id?: string, signal?: any) { return null; },
  prepareAuthConfig(id?: string, options?: any) { return null; },
  connect(id?: string, options?: any) { return Promise.resolve({ kind: 'oauth', redirectUrl: '', providerConnectionId: '', expiresAt: 0, credentials: undefined, accountLabel: undefined } as any); },
  disconnect(id?: string, options?: any) { return Promise.resolve(true); },
  cancelPendingConnections(options?: any) {},
  completeConnection(options?: any) { return Promise.resolve({}); },
  execute(options?: any) { return Promise.resolve({}); },
  isConfigured() { return false; },
};
export function getStaticComposioCatalogDefinitions() { return []; }
export type ComposioAuthConfigPrepareResult = any;
export interface ComposioConnectionStart {
  kind: any;
  redirectUrl?: any;
  providerConnectionId?: any;
  expiresAt?: any;
  credentials?: any;
  accountLabel?: any;
}
