import { normalizeShowKey } from './showTitleMatch';

/**
 * Known BBC miniseries where TVDB uses **season 1** but get_iplayer / BBC metadata uses **series 0** (S00).
 * Keys are normalized like {@link normalizeShowKey} (lowercase, no punctuation).
 * Extend this set as you discover more mismatches.
 */
export const MINISERIES_TVDB_BRIDGE_KEYS = new Set<string>([
    'smileyspeople',
    'tinkertailorsoldierspy',
    'thenightmanager',
]);

/**
 * True when the Sonarr / *arr search query is a known miniseries (allowlist).
 * Regular shows (e.g. Doctor Who) are never matched.
 */
export function isMiniseriesOverrideQuery(searchQuery: string): boolean {
    const k = normalizeShowKey(searchQuery.trim());
    return k.length > 0 && MINISERIES_TVDB_BRIDGE_KEYS.has(k);
}

/**
 * Interceptor: rewrite **S00E##** → **S01E##** in the release / NZB title so Sonarr accepts the grab.
 * Case-insensitive on S00; preserves episode digits.
 */
export function patchMiniseriesReleaseName(releaseName: string): string {
    return releaseName.replace(/S00(E\d{2})/gi, 'S01$1');
}
