import {
    isMiniseriesOverrideQuery,
    patchMiniseriesReleaseName,
} from '../../src/utils/miniseriesReleaseInterceptor';

/**
 * Jest equivalent of the Python BBCIndexerProxy unittest (interceptor + allowlist).
 */
describe('miniseriesReleaseInterceptor (BBC S00 → TVDB S01)', () => {
    describe('patchMiniseriesReleaseName', () => {
        it("Smiley's People: S00E01 release becomes S01E01 (Sonarr / TVDB parity)", () => {
            const rawRelease = 'Smileys.People.S00E01.Episode.1.WEBDL.1080p-BBC';
            const expected = 'Smileys.People.S01E01.Episode.1.WEBDL.1080p-BBC';
            expect(patchMiniseriesReleaseName(rawRelease)).toBe(expected);
        });

        it('Doctor Who: standard show left untouched', () => {
            const rawRelease = 'Doctor.Who.S14E01.Space.Babies.WEBDL.1080p-BBC';
            expect(patchMiniseriesReleaseName(rawRelease)).toBe(rawRelease);
        });

        it('is case-insensitive on S00 (episode part keeps captured casing)', () => {
            expect(patchMiniseriesReleaseName('Show.s00e02.foo')).toBe('Show.S01e02.foo');
        });
    });

    describe('isMiniseriesOverrideQuery', () => {
        it("matches Smiley's People (normalized)", () => {
            expect(isMiniseriesOverrideQuery("Smiley's People")).toBe(true);
        });

        it('does not match Doctor Who', () => {
            expect(isMiniseriesOverrideQuery('Doctor Who')).toBe(false);
        });
    });
});
