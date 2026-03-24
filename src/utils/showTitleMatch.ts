/**
 * Loose show-title matching for search results (e.g. "Smiley's People" vs synonym / iPlayer variants).
 */

export function normalizeShowKey(title: string): string {
    return title
        .toLowerCase()
        .replace(/'/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
}

/**
 * True if a result row likely belongs to the same series as the search term.
 * Used when applying TVDB season-1 ↔ iPlayer series-0 miniseries bridging.
 */
export function titlesLikelySameShow(resultTitle: string, searchTerm: string): boolean {
    const a = normalizeShowKey(resultTitle);
    const b = normalizeShowKey(searchTerm);
    if (!a.length || !b.length) {
        return true;
    }
    return a.includes(b) || b.includes(a);
}
