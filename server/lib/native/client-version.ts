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

/**
 * Paths a client below the minimum version may still call. Work captured on a
 * device must always be deliverable, so sync, upload and import never 426.
 */
export const NEVER_BLOCK_PATHS: readonly RegExp[] = [
  /^\/api\/inspections\/[^/]+\/collab\/(ws|import|ticket)$/,
  /^\/api\/inspections\/[^/]+\/presence\/ws$/,
  /^\/api\/tenant\/presence\/ws$/,
  /^\/api\/inspections\/[^/]+\/media\/(upload-url|video\/(create-upload|finalize|r2-upload|r2-upload-poster))$/,
  /^\/api\/public\/uploads\//,
  /^\/api\/client\/(session|import|compat)$/,
];

function isClientPlatform(v: string | undefined): v is ClientPlatform {
  return !!v && (CLIENT_PLATFORMS as readonly string[]).includes(v);
}

/** Adds X-Client-Upgrade and, below the minimum, rejects non-sync calls with 426. */
export function enforceClientVersion(c: Context<HonoConfig>): void {
  const platform = c.req.header('X-Client-Platform');
  if (!isClientPlatform(platform)) return;
  const status = upgradeStatus(c.req.header('X-Client-Version'), readVersionPolicy(c.env, platform));
  if (!status) return;
  c.header('X-Client-Upgrade', status);
  if (status === 'required' && !NEVER_BLOCK_PATHS.some((r) => r.test(c.req.path))) {
    throw new AppError(426, ErrorCode.CLIENT_UPGRADE_REQUIRED, 'This app version is no longer supported. Please update.');
  }
}
