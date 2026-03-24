/**
 * TVDB season 1 vs get_iplayer series 0 (BBC miniseries): Sonarr S01En search must match S00En
 * and Torznab/NZB names must report S01En so *arr can grab releases.
 */
import SearchEndpoint from '../../src/endpoints/newznab/SearchEndpoint';
import searchFacade from '../../src/facade/searchFacade';
import configService from '../../src/service/configService';
import RedisCacheService from '../../src/service/redis/redisCacheService';
import nativeSearchService from '../../src/service/search/NativeSearchService';
import synonymService from '../../src/service/synonymService';
import statisticsService from '../../src/service/stats/StatisticsService';
import { VideoType } from '../../src/types/IPlayerSearchResult';
import * as Utils from '../../src/utils/Utils';
import { parseStringPromise } from 'xml2js';

jest.mock('../../src/service/configService');
jest.mock('../../src/service/redis/redisCacheService');
jest.mock('../../src/service/synonymService');
jest.mock('../../src/service/search/NativeSearchService');
jest.mock('../../src/service/stats/StatisticsService');

const mockedConfig = jest.mocked(configService);
const mockedSynonym = jest.mocked(synonymService);

describe('TVDB miniseries bridge (S00 → S01 for Sonarr)', () => {
    const smileyUpstreamRow = {
        number: 0,
        title: "Smiley's People",
        channel: 'BBC Two',
        pid: 'm000smiley01',
        request: { term: "Smiley's People", line: "Smiley's People" },
        type: VideoType.TV,
        series: 0,
        episode: 1,
        episodeTitle: 'Episode 1',
        nzbName: 'Smileys.People.S00E01.Episode.1.WEBDL.1080p-BBC',
        size: 2000,
        pubDate: new Date('1982-09-20T12:00:00Z'),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockedConfig.getParameter.mockImplementation((param: string) => {
            const map = mockedConfig.defaultConfigMap as Record<string, string>;
            if (param === 'NATIVE_SEARCH') {
                return Promise.resolve('true');
            }
            return Promise.resolve(map[param] ?? 'hd');
        });
        mockedSynonym.getSynonym.mockResolvedValue(undefined);
        (RedisCacheService.prototype.get as jest.Mock).mockResolvedValue(undefined);
        (RedisCacheService.prototype.set as jest.Mock).mockResolvedValue(undefined);
        (nativeSearchService.processCompletedSearch as jest.Mock).mockImplementation((r: unknown[]) => r);
        (statisticsService.addSearch as jest.Mock).mockImplementation(() => undefined);
    });

    it('searchFacade: Sonarr S01E01 query includes get_iplayer S00E01 and remaps NZB to S01E01', async () => {
        (nativeSearchService.search as jest.Mock).mockResolvedValue([smileyUpstreamRow]);

        const results = await searchFacade.search("Smiley's People", 1, 1);

        expect(results).toHaveLength(1);
        expect(results[0].series).toBe(1);
        expect(results[0].episode).toBe(1);
        expect(results[0].nzbName).toMatch(/S01E01/i);
        expect(results[0].nzbName).not.toMatch(/S00E01/i);
        expect(results[0].pid).toBe('m000smiley01');
    });

    it('SearchEndpoint: Torznab item title uses remapped S01E01 NZB name for Smiley miniseries', async () => {
        jest.spyOn(Utils, 'getBaseUrl').mockReturnValue('http://localhost:4404');
        jest.spyOn(Utils, 'createNZBDownloadLink').mockResolvedValue('/api?nzb');

        (nativeSearchService.search as jest.Mock).mockResolvedValue([smileyUpstreamRow]);

        const req = {
            query: {
                q: "Smiley's People",
                season: '1',
                ep: '1',
                apikey: 'k',
            },
        } as any;
        const sendMock = jest.fn();
        const setMock = jest.fn();
        const res = { set: setMock, send: sendMock } as any;

        await SearchEndpoint(req, res);

        const xml = sendMock.mock.calls[0][0] as string;
        const parsed = await parseStringPromise(xml);
        const item = parsed.rss.channel[0].item[0];
        const title = item.title[0] as string;
        expect(title).toMatch(/S01E01/i);
        expect(title).not.toMatch(/S00E01/i);
    });
});
