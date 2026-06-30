// Reference: apps/daemon/src/media-policy.ts
export function defaultMediaExecutionPolicy() { return { mode: 'enabled' }; }
export function normalizeMediaExecutionPolicyForRun(value: any) { return { mode: 'enabled' }; }
export function parseMediaExecutionPolicyInput(value: any) { return { ok: true, policy: { mode: 'enabled' } }; }
export function mediaPolicyDenial(policy: any, target: any) { return null; }
