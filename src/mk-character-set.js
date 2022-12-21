import {
	codePointAt,
	fromCodePoint
} from "./string";
import { isObject } from "./is";
import { binarySearch } from "./binary-search";
import hasOwn from "./has-own";
import parseSurrogatePair from "./parse-surrogate-pair";
import parseEscapeSequence from "./parse-escape-sequence";

const CASE_MAPS = {
		hash: {},
		list: [],
		initialized: false
	},
	NEGATE_FUNCTIONS = {};

const CONTROL_CHARACTERS = {
	"\n": "\\n",
	"\r": "\\r",
	"\t": "\\t",
	"\f": "\\f",
	"\v": "\\v",
	"\b": "\\b"
};

const SET_TOKENS = {
	s: "\r\n\t\f\v ",
	d: "0-9",
	w: "a-zA-Z0-9_"
};

export default function mkCharacterSet(source, insensitive = false, err = throwError) {
	const {
		src,
		negate
	} = normalizeSourceInput(source);

	if (typeof insensitive == "function") {
		err = insensitive;
		insensitive = false;
	}

	const usedChars = {};

	const use = charOrCodePoint => {
		const cc = typeof charOrCodePoint == "string" ?
			codePointAt(charOrCodePoint, 0) :
			charOrCodePoint;

		if (hasOwn(usedChars, cc))
			return false;

		d.characters.push(cc);
		usedChars[cc] = true;
		return true;
	};

	const d = {
		characters: [],
		ranges: [],
		functions: [],
		parameters: [],
		hasRangeSurrogates: false
	};

	const args = {
		d,
		source: src,
		negate,
		insensitive,
		err,
		use
	};

	// Parse / consume set
	if (isObject(src))
		consumeSet(args);
	else
		parseSet(args);

	// Apply alternative casing
	if (insensitive)
		applyCasing(args);

	// Collapse overlapping ranges
	collapseRanges(args);

	// Remove characters covered in ranges
	cleanRanges(args);

	// Codegen
	const ccOptimize = d.ranges.length > 5 && !d.hasRangeSurrogates,
		charactersCode = getCharactersCode(d.characters),
		rangesCode = getRangesCode(d.ranges, ccOptimize),
		functionsCode = getFunctionsCode(d.parameters),
		codes = [];
	let code = "";

	if (charactersCode)
		codes.push(charactersCode);
	if (rangesCode)
		codes.push(rangesCode);
	if (functionsCode)
		codes.push(functionsCode);

	if (!codes.length)
		return _ => negate;

	// One-liner
	if (codes.length == 1)
		code = genSLReturn(codes[0], negate);
	else {
		for (let i = 0, l = codes.length; i < l; i++) {
			if (ccOptimize && rangesCode && codes[i] == rangesCode)
				code += "var cc = _v.charCodeAt(0);\n";

			if (i < l - 1)
				code += `if (${codes[i]}) return ${!negate};\n`;
			else
				code += genSLReturn(codes[i], negate);
		}
	}

	if (d.parameters.length)
		return Function(...d.parameters, "_v", code).bind(null, ...d.functions);

	return Function("_v", code);
}

function normalizeSourceInput(source) {
	if (typeof source == "string") {
		return {
			src: source
				.replace(/^\^/, "")
				.replace(/\\([sdw])/g, (_, c) => SET_TOKENS[c]),
			negate: source[0] == "^"
		};
	}

	if (isObject(source)) {
		return {
			src: source,
			negate: hasOwn(source, "negate") ?
				Boolean(source.negate) :
				false
		};
	}

	if (Array.isArray(source)) {
		return {
			src: source,
			negate: false
		};
	}

	return {
		src: "",
		negate: false
	};
}

function parseSet(args = {}) {
	const {
		d,
		source,
		err,
		use
	} = args;

	const usedFunctions = {};
	let rangeStart = null;

	for (let i = 0, l = source.length; i < l; i++) {
		const surrogate = parseSurrogatePair(source, i);
		let char = surrogate.character;
		i += surrogate.length - 1;

		if (char == "\\") {
			const nextChar = source[i + 1];

			if (hasOwn(NEGATE_FUNCTIONS, nextChar)) {
				if (hasOwn(usedFunctions, nextChar))
					continue;

				d.parameters.push(getParamName(d.functions.length));
				d.functions.push(NEGATE_FUNCTIONS[nextChar]);
				usedFunctions[nextChar] = true;
				i++;
				continue;
			}

			const parsed = parseEscapeSequence(source, i);
			char = parsed.character;
			i += parsed.length - 1;
		}

		if (rangeStart) {
			const start = rangeStart;
			rangeStart = null;

			if (start != char) {
				const from = codePointAt(start, 0),
					to = codePointAt(char, 0);

				if (from > to) {
					err(`Range [${printChar(start)}-${printChar(char)}] is out of order`);
					return null;
				}

				if (surrogate.length > 1)
					d.hasRangeSurrogates = true;

				d.ranges.push([from, to]);
				continue;
			}
		} else if (source[i + 1] == "-" && i < l - 2) {
			rangeStart = char;
			i++;
			continue;
		}

		use(char);
	}

	return d;
}

function consumeSet(args = {}) {
	const {
		d,
		source,
		use
	} = args;

	const characters = source.characters || [],
		ranges = source.ranges || [];

	for (let i = 0, l = characters.length; i < l; i++)
		use(characters[i]);

	for (let i = 0, l = ranges.length; i < l; i++) {
		const range = ranges[i],
			start = range[0],
			end = range[1];

		if (start >= 0xffff || end >= 0xffff)
			d.hasRangeSurrogates = true;

		d.ranges.push([start, end]);
	}
}

function applyCasing(args = {}) {
	const {
		d,
		use
	} = args;

	const cm = getCaseMaps();

	for (let i = 0, l = d.characters.length; i < l; i++) {
		if (hasOwn(cm.hash, d.characters[i]))
			use(cm.hash[d.characters[i]]);
	}

	for (let i = d.ranges.length - 1; i >= 0; i--) {
		const range = d.ranges[i];
		let idx = Math.max(
			binarySearch(cm.list, v => v[0] - range[0]),
			0
		);

		for (let l = cm.list.length; idx < l; idx) {
			if (cm.list[idx][0] < range[0]) {
				idx++;
				continue;
			}

			let start = -1,
				end = -1,
				diff = -1;

			while (idx < l) {
				const item = cm.list[idx];

				if (item[0] > range[1])
					break;

				if (diff == -1)
					diff = item[1] - item[0];

				if (item[1] - item[0] != diff)
					break;

				end = item[1];
				if (start == -1)
					start = end;

				idx++;
			}

			if (end == -1) {
				idx++;
				continue;
			}

			if (start == end)
				use(start);
			else if (start > end)
				d.ranges.push([end, start]);
			else
				d.ranges.push([start, end]);
		}
	}

	return d;
}

function collapseRanges(args = {}) {
	const { d } = args;

	for (let i = 0; i < d.ranges.length; i++) {
		let shift = 0;

		for (let j = i + 1, l = d.ranges.length; j < l; j++) {
			const r = d.ranges[i],
				r2 = d.ranges[j],
				start = Math.min(r[0], r2[0]),
				end = Math.max(r[1], r2[1]),
				extent = end - start,
				length = Math.abs(r[1] - r[0] + r2[1] - r2[0]) + 2;

			d.ranges[j - shift] = r2;

			if (extent < length) {
				r[0] = start;
				r[1] = end;
				shift++;
			}
		}

		d.ranges.length -= shift;
	}

	return d;
}

function cleanRanges(args = {}) {
	const { d } = args;

	for (let i = 0; i < d.ranges.length; i++) {
		let shift = 0;
		const range = d.ranges[i];

		for (let j = 0, l = d.characters.length; j < l; j++) {
			const char = d.characters[j];

			if (char >= range[0] && char <= range[1]) {
				shift++;
				continue;
			}

			d.characters[j - shift] = char;
		}

		d.characters.length -= shift;
	}
	
	return d;
}

function getCharactersCode(characters) {
	return characters
		.map(c => `_v == "${printChar(c)}"`)
		.join(" || ");
}

function getRangesCode(ranges, ccOptimize = false) {
	if (ranges.length == 1)
		return `_v >= "${printChar(ranges[0][0])}" && _v <= "${printChar(ranges[0][1])}"`;

	if (ccOptimize) {
		return ranges
			.map(r => `(cc >= ${r[0]} && cc <= ${r[1]})`)
			.join(" || ");
	}

	return ranges
		.map(r => `(_v >= "${printChar(r[0])}" && _v <= "${printChar(r[1])}")`)
		.join(" || ");
}

function getFunctionsCode(parameters) {
	return parameters
		.map(p => `${p}(_v)`)
		.join(" || ");
}

function genSLReturn(code, negate) {
	return `return ${negate ? "!(" : ""}${code}${negate ? ")" : ""};`;
}

function printChar(char) {
	if (typeof char == "number")
		char = fromCodePoint(char);

	if (hasOwn(CONTROL_CHARACTERS, char))
		return CONTROL_CHARACTERS[char];

	if (char == "\"" || char == "\\")
		return "\\" + char;

	return char;
}

function getParamName(idx) {
	let name = "";

	while (true) {
		name = String.fromCharCode(97 + idx % 26) + name;

		if (idx < 26)
			break;

		idx = Math.floor(idx / 26) - 1;
	}

	return name;
}

function throwError(msg) {
	throw new SyntaxError(msg);
}

function getCaseMaps() {
	if (CASE_MAPS.initialized)
		return CASE_MAPS;

	// Lowest and highest known code points
	// that have case mapping
	for (let i = 65; i < 125251; i++) {
		if (hasOwn(CASE_MAPS.hash, i)) {
			CASE_MAPS.list.push([i, CASE_MAPS.hash[i]]);
			continue;
		}

		const char = fromCodePoint(i);
		let cased = char.toLowerCase();

		if (cased == char)
			cased = char.toUpperCase();

		if (cased == char || cased.length > 1)
			continue;

		const point = codePointAt(cased, 0);
		CASE_MAPS.hash[i] = point;
		CASE_MAPS.hash[point] = i;
		CASE_MAPS.list.push([i, point]);
	}

	CASE_MAPS.initialized = true;
	return CASE_MAPS;
}

for (const k in SET_TOKENS) {
	if (hasOwn(SET_TOKENS, k))
		NEGATE_FUNCTIONS[k.toUpperCase()] = mkCharacterSet(`^${SET_TOKENS[k]}`);
}