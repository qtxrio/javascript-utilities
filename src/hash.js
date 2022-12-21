import { LFUCache } from "./internal/cache";
import forEach from "./for-each";

const FN_TO_STR = Function.prototype.toString,
	NUM_TO_STR = Number.prototype.toString;

// Basic hashing function optimized for structure
// preservation and decent performance
export default function hash(value, reduce = false) {
	if (reduce)
		return hashString(runHash(value), reduce);

	return runHash(value);
}

function hashSafe(value, reduce = false) {
	try {
		if (reduce)
			return hashString(runHash(value), reduce);

		return runHash(value);
	} catch(e) {
		console.warn("Cyclic structure found", value);
		return null;
	}
}

function runHash(value) {
	switch (typeof value) {
		case "undefined":
			return "undefined";
		case "number":
			return `num:${value}`;
		case "bigint":
			return `big:${value}`;
		case "boolean":
			return `bool:${value}`;
		case "string":
			return `str:${hashString(value)}`;
		case "function":
			return `fun:${hashString(FN_TO_STR.call(value))}`;
		case "object":
			return hashObject(value);
	}
}

function hashObject(value) {
	if (value === null)
		return "null";

	switch (value.constructor) {
		case Array: {
			let out = `arr:[`;

			if (value.length > 0)
				out += runHash(value[0]);

			for (let i = 1, l = value.length; i < l; i++)
				out += `,${runHash(value[i])}`;

			return out + "]";
		}

		case Object: {
			let out = "obj:{";

			const keys = Object.keys(value).sort();

			if (keys.length > 0)
				out += `${runHash(value[keys[0]])}@${hashString(keys[0])}`;

			for (let i = 1, l = keys.length; i < l; i++)
				out += `,${runHash(value[keys[i]])}@${hashString(keys[i])}`;

			return out + "}";
		}

		default: {
			let out = "inst:{",
				count = 0;

			forEach(value, (val, key) => {
				if (count++ > 0)
					out += ",";

				out += `${runHash(val)}@${runHash(key)}`;
			});

			return out + "}";
		}
	}
}

// Very basic rolling hash implementation
const P = 1721,
	M = 137438953447;

// The maximum size of a UTF-16 code unit is 16 bits, 65535,
// which means that the maximum value the modulo variable may
// have is given by the following:
// hash + codePoint * power < 2**53 - 1
// Assume hash, codePoint, and power have the maximum size...
// M + codePoint * M < 2**53 - 1
// (codePoint + 1) * M < 2**53 - 1
// 2**16 * M < 2**53 - 1
// M = 137438953471
// Then find the closest prime smaller than M, and this is
// the biggest safe number that will never yield a number larger
// than 2**53 - 1 in the hashing process
// 137438953447 is the largest prime less than 137438953471
// Note that this assumes that P is never larger than 2**16 - 1

// Caching is done to save processing on long strings,
// and as JS's hashing for string keys is much more performant,
// the performance benefits are significant:
// Without caching:	~203598ms (3m 23s)
// With caching		~25ms
// for the first chapter of Moby Dick (12310) characters
const HASH_CACHE = new LFUCache(),
	REDUCED_HASH_CACHE = new LFUCache();

function hashString(str, reduce) {
	return reduce ?
		REDUCED_HASH_CACHE.get(str) || hashStringHelper(str, true, REDUCED_HASH_CACHE) :
		HASH_CACHE.get(str) || hashStringHelper(str, false, HASH_CACHE);
}

function hashStringHelper(str, reduce, cache) {
	let hash = 0,
		power = 1;

	for (let i = 0, l = str.length; i < l; i++) {
		hash = (hash + str.charCodeAt(i) * power) % M;
		power = (power * P) % M;
	}

	const outHash = reduce ?
		`${NUM_TO_STR.call(hash, 36)}/${str.length}` :
		`${hash}/${str.length}`;

	cache.set(str, outHash);
	return outHash;
}

/*
Testing code for collisions - in testing,
hashString has an even distribution

function test(iter = 1e6, strLen = 20, saveAllCollisions = false) {
	const testedRand = {},
		hashed = {};
	let uniques = 0,
		collisions = 0;

	for (let i = 0; i < iter; i++) {
		const randStr = randUTF16Str(strLen);

		if (testedRand[randStr])
			continue;
		testedRand[randStr] = true;

		uniques++;

		const hash = hashString(randStr);

		if (saveAllCollisions) {
			if (!hasOwn(hashed, hash))
				hashed[hash] = [];

			hashed[hash].push(randStr);

			if (hashed[hash].length > 1) {
				console.log(hashed[hash], i / iter);
				collisions++;
			}
		} else {
			if (hasOwn(hashed, hash)) {
				console.log(hashed[hash], randStr, i / iter);
				collisions++;
			}

			hashed[hash] = randStr;
		}
	}

	console.log(
`Uniques: ${uniques}
Collisions: ${collisions}
Expected collisions: ${(uniques**2 / M) / 2}`);
}

function randUTF16Str(length) {
	let out = "";

	while (length--)
		out += String.fromCharCode(Math.random() * 2**16);

	return out;
}*/

export {
	hashSafe,
	hashObject,
	hashString
};