import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { AppError, ErrorCode } from '../errors';

export type ClientPlatform = 'ios' | 'android' | 'windows';
export const CLIENT_PLATFORMS = ['ios', 'android', 'windows'] as const satisfies readonly ClientPlatform[];
export const SERVER_CONTRACT_VERSION = 1;

export interface VersionPolicy {
  minSupported: string | null;
  recommended: string | null;
  downloadUrl: string | null;
}

/**
 * Operator-set version policy, one trio per platform. All optional: with none
 * set the server never asks any app to update.
 */
export interface NativeVersionEnv {
  /** Operator opt-in for native clients; declared here so AppEnv carries it for the flag helpers. */
  NATIVE_CLIENT_ENABLED?: string;
  NATIVE_MIN_VERSION_IOS?: string;
  NATIVE_MIN_VERSION_ANDROID?: string;
  NATIVE_MIN_VERSION_WINDOWS?: string;
  NATIVE_RECOMMENDED_VERSION_IOS?: string;
  NATIVE_RECOMMENDED_VERSION_ANDROID?: string;
  NATIVE_RECOMMENDED_VERSION_WINDOWS?: string;
  NATIVE_DOWNLOAD_URL_IOS?: string;
  NATIVE_DOWNLOAD_URL_ANDROID?: string;
  NATIVE_DOWNLOAD_URL_WINDOWS?: string;
}

const SEMVER = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

function parts(v: string): [number, number, number] | null {
  const m = SEMVER.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : null;
}

/** Numeric compare of up to three dotted components. Unparseable input compares equal. */
export function compareSemver(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const POLICY_KEYS: Record<ClientPlatform, Record<keyof VersionPolicy, keyof NativeVersionEnv>> = {
  ios: { minSupported: 'NATIVE_MIN_VERSION_IOS', recommended: 'NATIVE_RECOMMENDED_VERSION_IOS', downloadUrl: 'NATIVE_DOWNLOAD_URL_IOS' },
  android: { minSupported: 'NATIVE_MIN_VERSION_ANDROID', recommended: 'NATIVE_RECOMMENDED_VERSION_ANDROID', downloadUrl: 'NATIVE_DOWNLOAD_URL_ANDROID' },
  windows: { minSupported: 'NATIVE_MIN_VERSION_WINDOWS', recommended: 'NATIVE_RECOMMENDED_VERSION_WINDOWS', downloadUrl: 'NATIVE_DOWNLOAD_URL_WINDOWS' },
};

export function readVersionPolicy(env: NativeVersionEnv, platform: ClientPlatform): VersionPolicy {
  const keys = POLICY_KEYS[platform];
  const read = (k: keyof NativeVersionEnv) => env[k]?.trim() || null;
  return {
    minSupported: read(keys.minSupported),
    recommended: read(keys.recommended),
    downloadUrl: read(keys.downloadUrl),
  };
}

/** Unknown, missing or unparseable versions never block: the rule fails open. */
export function upgradeStatus(version: string | undefined, policy: VersionPolicy): 'required' | 'recommended' | null {
  if (!version || !parts(version)) return null;
  if (policy.minSupported && parts(policy.minSupported) && compareSemver(version, policy.minSupported) < 0) return 'required';
  if (policy.recommended && parts(policy.recommended) && compareSemver(version, policy.recommended) < 0) return 'recommended';
  return null;
}

/** One call a client below the minimum version may still make. No `method` means any method. */
interface NeverBlockRule {
  method?: string;
  pattern: RegExp;
}

/**
 * Calls a client below the minimum version may still make. Work captured on a
 * device must always be deliverable, so sync, upload and import never 426, and
 * neither do the three REST writes that hand over a captured inspection: create
 * (with the client's own id), update and complete. Those are listed by method,
 * because the same paths also serve reads, and an outdated app has no business
 * pulling current data.
 */
const NEVER_BLOCK_RULES: readonly NeverBlockRule[] = [
  { pattern: /^\/api\/inspections\/[^/]+\/collab\/(ws|import|ticket)$/ },
  { pattern: /^\/api\/inspections\/[^/]+\/presence\/ws$/ },
  { pattern: /^\/api\/inspections\/[^/]+\/media\/(upload-url|video\/(create-upload|finalize|r2-upload|r2-upload-poster))$/ },
  { pattern: /^\/api\/public\/uploads\// },
  { pattern: /^\/api\/client\/(session|import|compat)$/ },
  { method: 'POST', pattern: /^\/api\/inspections$/ },
  // `bulk` is a fixed route (PATCH /api/inspections/bulk), not an inspection id: a bulk update is not
  // work captured on a device, so an outdated app does not get it past the version rule.
  { method: 'PATCH', pattern: /^\/api\/inspections\/(?!bulk$)[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/inspections\/[^/]+\/complete$/ },
];

/** True when the call may proceed whatever the app version. */
export function isNeverBlocked(method: string, path: string): boolean {
  return NEVER_BLOCK_RULES.some((r) => (!r.method || r.method === method.toUpperCase()) && r.pattern.test(path));
}

/** Longest version string `normalizeClientVersion` accepts. */
const MAX_VERSION_LENGTH = 32;

/**
 * A client-sent version in its stored form, or null when it is not up to three
 * dotted numbers (or is absurdly long). `1.4` becomes `1.4.0`, so one release is
 * one row however the app spells it.
 */
export function normalizeClientVersion(v: string | undefined): string | null {
  if (!v || v.length > MAX_VERSION_LENGTH) return null;
  const p = parts(v);
  return p ? p.join('.') : null;
}

export function isClientPlatform(v: string | undefined): v is ClientPlatform {
  return !!v && (CLIENT_PLATFORMS as readonly string[]).includes(v);
}

/** Adds X-Client-Upgrade and, below the minimum, rejects non-sync calls with 426. */
export function enforceClientVersion(c: Context<HonoConfig>): void {
  const platform = c.req.header('X-Client-Platform');
  if (!isClientPlatform(platform)) return;
  const status = upgradeStatus(c.req.header('X-Client-Version'), readVersionPolicy(c.env, platform));
  if (!status) return;
  c.header('X-Client-Upgrade', status);
  if (status === 'required' && !isNeverBlocked(c.req.method, c.req.path)) {
    throw new AppError(426, ErrorCode.CLIENT_UPGRADE_REQUIRED, 'This app version is no longer supported. Please update.');
  }
}
