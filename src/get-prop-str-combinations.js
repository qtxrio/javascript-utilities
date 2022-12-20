// Important: keep up to date with parse-prop-str
import { LFUCache } from "./internal/cache";
import combine from "./combine";

const AFFIXES = combine([
	["", "@"],		// prefix: typing
	["", "!", "?"]	// postfix: strict, lazy
]);

const VARIATIONS_CACHE = new LFUCache();

export default function getPropStrVariations(key) {
	if (VARIATIONS_CACHE.has(key))
		return VARIATIONS_CACHE.get(key);

	const variations = [];

	for (let i = 0, l = AFFIXES.length; i < l; i++)
		variations.push(AFFIXES[i][0] + key + AFFIXES[i][1]);

	VARIATIONS_CACHE.set(key, variations);
	return variations;
}