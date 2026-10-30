// W11-A U3 — the canonical Search Fold.
//
// Requirement : document.md R-U3-SEARCH-01, R-U3-SEARCH-08, R-U3-SEARCH-09
// Design      : solution.md §37.54.39.4, §37.54.40.3, §37.54.40.4
//
// ONE fold implementation exists. The Selector, the four production write
// paths, the additive migration and the verification pass all call this
// module; no second fold is allowed.
//
// The fold is:
//   1. Unicode NFKD decomposition;
//   2. a non-spacing mark is removed ONLY when its base is a Latin-script
//      letter, so a Latin diacritic folds while a Devanagari virama, a Thai
//      tone mark, a Hebrew niqqud, an Arabic harakat, a Greek tonos and a
//      Cyrillic breve keep their meaning;
//   3. the locale-independent Unicode uppercase mapping.
//
// The fold is stable across the Unicode normalization forms, so the composed
// and the decomposed form of one text produce one key.
//
// KNOWN AND DISCLOSED LOSS. Two texts that differ only by a Latin diacritic
// fold together. That includes the Vietnamese syllables that differ only by
// their tone, because the Vietnamese tone marks are the very same combining
// marks as the European accents and cannot be told apart by the mark. The
// loss is confined to the derived search key: no stored business text, no
// customer identity and no business value is changed by it.

export const SEARCH_FOLD_VERSION = 'W11-A-SEARCH-FOLD-V1';

// The LIKE escape character of the Selector search. It is chosen because it
// is not special in either engine and because the pattern escapes it, so a
// user input can never act as an escape operator.
export const SEARCH_FOLD_ESCAPE_CHARACTER = '!';

const NON_SPACING_MARK = /\p{Mn}/u;
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const LETTER = /\p{L}/u;

function isLatinBase(character) {
  return character !== '' && LATIN_SCRIPT.test(character) && LETTER.test(character);
}

/**
 * Fold a business text into its canonical search form.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function foldSearchText(value) {
  const text = value === null || value === undefined ? '' : String(value);
  if (!text) return '';
  const decomposed = text.normalize('NFKD');
  let folded = '';
  let base = '';
  for (const character of decomposed) {
    if (NON_SPACING_MARK.test(character)) {
      // A mark is dropped only when it decorates a Latin letter. The base
      // stays the last real character, so a run of marks is judged against
      // the same base.
      if (isLatinBase(base)) continue;
      folded += character;
      continue;
    }
    folded += character;
    base = character;
  }
  return folded.toUpperCase();
}

/**
 * Escape a folded text so that it acts as a literal LIKE pattern.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeSearchPattern(value) {
  const folded = foldSearchText(value);
  let escaped = '';
  for (const character of folded) {
    if (character === SEARCH_FOLD_ESCAPE_CHARACTER) {
      escaped += SEARCH_FOLD_ESCAPE_CHARACTER + SEARCH_FOLD_ESCAPE_CHARACTER;
    } else if (character === '%') {
      escaped += SEARCH_FOLD_ESCAPE_CHARACTER + '%';
    } else if (character === '_') {
      escaped += SEARCH_FOLD_ESCAPE_CHARACTER + '_';
    } else {
      escaped += character;
    }
  }
  return escaped;
}

/**
 * Build the two search patterns of the Selector. The fold happens first, the
 * escaping second and the prefix and the containment positions third, so a
 * user input can never act as a wildcard or as an escape operator.
 *
 * The customer code and the Credit Object type use the prefix position, the
 * customer name and the Credit Object identity use the containment position.
 *
 * @param {unknown} value
 * @returns {{ prefix: string, contains: string }}
 */
export function buildSearchPatterns(value) {
  const escaped = escapeSearchPattern(value);
  return { prefix: `${escaped}%`, contains: `%${escaped}%` };
}
