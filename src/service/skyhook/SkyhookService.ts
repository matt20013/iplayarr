import axios from 'axios';

import RedisCacheService from '../redis/redisCacheService';

/** Minimum token-overlap score (0–1) to accept a non-exact TVDB episode title match. */
const MIN_EPISODE_TITLE_SIMILARITY = 0.35;

const TITLE_STOP_WORDS = new Set([
    'a', 'an', 'and', 'the', 'episode', 'part', 'special', 'show', 'bbc', '1', '2', '3', '4', '5',
]);

function normalizeForTokens(value: string): string {
    return value
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function titleTokens(value: string): Set<string> {
    return new Set(
        normalizeForTokens(value)
            .split(' ')
            .filter((t) => t.length > 1 && !TITLE_STOP_WORDS.has(t))
    );
}

/**
 * Token-overlap similarity between iPlayer / release text and a TVDB episode title.
 * Same idea as Sonarr-style fuzzy episode matching in *arr stacks.
 */
export function episodeTitleSimilarity(a: string, b: string): number {
    const ta = titleTokens(a);
    const tb = titleTokens(b);
    if (!ta.size || !tb.size) {
        return 0;
    }
    let overlap = 0;
    for (const t of ta) {
        if (tb.has(t)) {
            overlap += 1;
        }
    }
    return overlap / Math.max(ta.size, tb.size);
}

class SkyhookService {
    skyhookSeriesCache: RedisCacheService<{ tvdbId: string }[]>
    skyhookEpisodeCache: RedisCacheService<{ episodes: any[] } | undefined>

    constructor() {
        this.skyhookSeriesCache = new RedisCacheService('skyhook_series_cache', 2700);
        this.skyhookEpisodeCache = new RedisCacheService('skyhook_episode_cache', 86400);
    }

    async lookupSeriesDetails(seriesName: string, episodeTitle: string): Promise<{ series?: number, episode?: number } | undefined> {
        const searchResults = await this.searchSeries(seriesName);
        for (const result of searchResults) {
            const episode = await this.findEpisode(parseInt(result.tvdbId), episodeTitle);
            if (episode) {
                return { series: episode.seasonNumber, episode: episode.episodeNumber };
            }
        }
        return;
    }

    async searchSeries(seriesName: string): Promise<{ tvdbId: string }[]> {
        try {
            const cached = await this.skyhookSeriesCache.get(seriesName);
            if (cached) {
                return cached;
            }
        } catch {
            // Cache retrieval failed, continue to API lookup
        }

        try {
            const url = `https://skyhook.sonarr.tv/v1/tvdb/search/en?term=${encodeURIComponent(seriesName)}`;
            const { data } = await axios.get(url);
            if (data && Array.isArray(data)) {
                await this.skyhookSeriesCache.set(seriesName, data);
            }
            return data;
        } catch {
            return [];
        }
    }

    async findEpisode(tvdbId: number, episodeName: string): Promise<{ title: string, seasonNumber: number, episodeNumber: number } | undefined> {
        const url = `https://skyhook.sonarr.tv/v1/tvdb/shows/en/${tvdbId}`;
        let data;

        try {
            data = await this.skyhookEpisodeCache.get(String(tvdbId));
        } catch {
            // Cache retrieval failed, continue to API lookup
        }

        if (!data) {
            try {
                const response = await axios.get(url);
                data = response.data;
                await this.skyhookEpisodeCache.set(String(tvdbId), data);
            } catch {
                return undefined;
            }
        }

        const episodes: any[] = data?.episodes ?? [];

        const exact = episodes.find((ep: any) => ep.title?.toLowerCase() === episodeName?.toLowerCase());
        if (exact) {
            return {
                title: exact.title,
                seasonNumber: exact.seasonNumber,
                episodeNumber: exact.episodeNumber,
            };
        }

        let best: { title: string; seasonNumber: number; episodeNumber: number } | undefined;
        let bestScore = 0;
        for (const ep of episodes) {
            const tvdbTitle = ep.title ?? '';
            const s1 = episodeTitleSimilarity(episodeName, tvdbTitle);
            const strippedTvdb = tvdbTitle.replace(/^episode\s*\d+\s*[-–:]\s*/i, '');
            const s2 = strippedTvdb !== tvdbTitle ? episodeTitleSimilarity(episodeName, strippedTvdb) : 0;
            const score = Math.max(s1, s2);
            if (score > bestScore) {
                bestScore = score;
                best = {
                    title: tvdbTitle,
                    seasonNumber: ep.seasonNumber,
                    episodeNumber: ep.episodeNumber,
                };
            }
        }

        if (best && bestScore >= MIN_EPISODE_TITLE_SIMILARITY) {
            return best;
        }
        return undefined;
    }
}

export default new SkyhookService();