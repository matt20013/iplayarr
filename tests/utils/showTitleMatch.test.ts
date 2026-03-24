import { normalizeShowKey, titlesLikelySameShow } from '../../src/utils/showTitleMatch';

describe('showTitleMatch', () => {
    it('normalizeShowKey strips punctuation and case', () => {
        expect(normalizeShowKey("Smiley's People")).toBe('smileyspeople');
    });

    it('titlesLikelySameShow matches apostrophe variants', () => {
        expect(titlesLikelySameShow("Smiley's People", 'Smileys People')).toBe(true);
        expect(titlesLikelySameShow('Unrelated Show', "Smiley's People")).toBe(false);
    });
});
