// Reference: apps/daemon/src/connectors/composio-config.ts
export function configureComposioConfigStore() {}
export function readPublicComposioConfig() { return {}; }
export function readComposioConfig(projectRoot?: string): any { return { apiKey: undefined }; }
export function writeComposioConfig(input?: any): any { return { configured: false }; }
