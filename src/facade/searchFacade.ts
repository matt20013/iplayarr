import configService from '../service/configService';
import RedisCacheService from '../service/redis/redisCacheService';
import AbstractSearchService from '../service/search/AbstractSearchService';
import getIplayerSearchService from '../service/search/GetIplayerSearchService';
import nativeSearchService from '../service/search/NativeSearchService';
import synonymService from '../service/synonymService';
import { IplayarrParameter } from '../types/IplayarrParameters';
import { IPlayerSearchResult } from '../types/IPlayerSearchResult';
import { Synonym } from '../types/Synonym';
import {
    isMiniseriesOverrideQuery,
    patchMiniseriesReleaseName,
} from '../utils/miniseriesReleaseInterceptor';
import { createNZBName, removeLastFourDigitNumber } from '../utils/Utils';
import { titlesLikelySameShow } from '../utils/showTitleMatch';
import scheduleFacade from './scheduleFacade';

function parseQueryInt(value: number | string | undefined): number | undefined {
    if (value === undefined || value === '') {
        return undefined;
    }
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
}

interface SearchTerm {
    term: string;
    synonym?: Synonym;
}

class SearchFacade {
    searchCache: RedisCacheService<IPlayerSearchResult[]> = new RedisCacheService('search_cache', 300);

    async search(inputTerm: string, season?: number | string, episode?: number | string): Promise<IPlayerSearchResult[]> {
        if (inputTerm == '*') {
            return scheduleFacade.getFeed();
        }

        const service = await this.#getService();
        const { term, synonym } = await this.#getTerm(inputTerm, season);

        let results: IPlayerSearchResult[] | undefined = await this.searchCache.get(term);
        if (!results) {
            results = await service.search(term, synonym);
            this.searchCache.set(term, results as IPlayerSearchResult[]);
        } else {
            //Fix the results which are stored as string
            results.forEach((result) => {
                result.pubDate = result.pubDate ? new Date(result.pubDate as unknown as string) : undefined;
            });
        }

        const filteredResults = this.#filterForSeasonAndEpisode(
            inputTerm,
            term,
            results as IPlayerSearchResult[],
            season,
            episode
        );

        const processedResults: IPlayerSearchResult[] = await service.processCompletedSearch(filteredResults, inputTerm, synonym, season, episode);

        const remapped = await this.#remapMiniseriesTvdbSeason1(inputTerm, term, processedResults, season, episode, synonym);

        const intercepted = this.#applyMiniseriesReleaseInterceptor(inputTerm, term, remapped);

        return intercepted.filter(({ pubDate }) => !pubDate || pubDate < new Date());
    }

    async #getService(): Promise<AbstractSearchService> {
        const nativeSearchEnabled = await configService.getParameter(IplayarrParameter.NATIVE_SEARCH);
        return nativeSearchEnabled == 'true' ? nativeSearchService : getIplayerSearchService;
    }

    async #getTerm(inputTerm: string, season?: number | string): Promise<SearchTerm> {
        const term = !season ? removeLastFourDigitNumber(inputTerm) : inputTerm;
        const synonym = await synonymService.getSynonym(inputTerm);
        return {
            term: synonym ? synonym.target : term,
            synonym,
        };
    }

    /**
     * Sonarr/TVDB uses season 1 for many BBC miniseries; get_iplayer uses series 0.
     * When Sonarr searches S01Exx, also accept S00Exx for the same show (title-guarded).
     */
    #filterForSeasonAndEpisode(
        sonarrQuery: string,
        searchTerm: string,
        results: IPlayerSearchResult[],
        season?: number | string,
        episode?: number | string
    ): IPlayerSearchResult[] {
        const s = parseQueryInt(season);
        const e = parseQueryInt(episode);

        if (s === undefined && e === undefined) {
            return results;
        }

        return results.filter((result) => {
            const titleOk =
                titlesLikelySameShow(result.title, searchTerm) || titlesLikelySameShow(result.title, sonarrQuery);
            const strictSeason = s === undefined || result.series == s;
            const strictEp = e === undefined || result.episode == e;
            const strict = strictSeason && strictEp && titleOk;

            const allowlisted =
                isMiniseriesOverrideQuery(sonarrQuery) || isMiniseriesOverrideQuery(searchTerm);
            const miniseriesBridge =
                s === 1 &&
                result.series === 0 &&
                result.episode != null &&
                (e === undefined || result.episode === e) &&
                (titleOk || allowlisted);

            return strict || miniseriesBridge;
        });
    }

    async #remapMiniseriesTvdbSeason1(
        sonarrQuery: string,
        searchTerm: string,
        results: IPlayerSearchResult[],
        season?: number | string,
        episode?: number | string,
        synonym?: Synonym
    ): Promise<IPlayerSearchResult[]> {
        const s = parseQueryInt(season);
        const e = parseQueryInt(episode);
        const allowlisted =
            isMiniseriesOverrideQuery(sonarrQuery) || isMiniseriesOverrideQuery(searchTerm);

        if (s !== 1 && !allowlisted) {
            return results;
        }

        return Promise.all(
            results.map(async (r) => {
                if (r.series !== 0 || r.episode == null) {
                    return r;
                }
                if (e !== undefined && r.episode !== e) {
                    return r;
                }
                const sonarrWantsTvdbS1 = s === 1 && (allowlisted || titlesLikelySameShow(r.title, searchTerm));
                const allowlistBroadSearch = allowlisted && s === undefined;
                if (!sonarrWantsTvdbS1 && !allowlistBroadSearch) {
                    return r;
                }
                const remapped: IPlayerSearchResult = { ...r, series: 1 };
                remapped.nzbName = await createNZBName(remapped, synonym);
                return remapped;
            })
        );
    }

    /**
     * Regex interceptor (Python proxy parity): for allowlisted queries only, patch **S00E** → **S01E** in NZB title.
     * Leaves normal shows untouched.
     */
    #applyMiniseriesReleaseInterceptor(
        sonarrQuery: string,
        searchTerm: string,
        results: IPlayerSearchResult[]
    ): IPlayerSearchResult[] {
        if (!isMiniseriesOverrideQuery(sonarrQuery) && !isMiniseriesOverrideQuery(searchTerm)) {
            return results;
        }
        return results.map((r) => {
            if (!r.nzbName || !/S00E\d{2}/i.test(r.nzbName)) {
                return r;
            }
            const nzbName = patchMiniseriesReleaseName(r.nzbName);
            if (nzbName === r.nzbName) {
                return r;
            }
            const out: IPlayerSearchResult = { ...r, nzbName };
            if (out.series === 0) {
                out.series = 1;
            }
            return out;
        });
    }

    removeFromSearchCache(term: string) {
        this.searchCache.del(term);
    }

    clearSearchCache() {
        this.searchCache.clear();
    }
}

export default new SearchFacade();