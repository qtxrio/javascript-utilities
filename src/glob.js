import {
	createOptionsObject,
	composeOptionsTemplates
} from "./internal/options";
import { LFUCache } from "./internal/cache";
import {
	cleanRegex,
	mkDisallowedWordsRegex
} from "./regex";
import { unescape } from "./string";
import hasOwn from "./has-own";

const GLOB_REGEX = /\\([^\\/])|(\?|\*{1,2})|\[(?!])(!)?((?:[^\\/]|\\.)*?)\]|([$^()[\]/\\{}.*+?|])/g,
	GLOB_COMPONENT_REGEX = /(?:[^\\]|^)(?:\?|\*{1,2}|\[(?!])(?:[^\\/]|\\.)*?\])/,
	GLOB_CACHE = new LFUCache(),
	BOUNDARY_CACHE = new LFUCache();
	
const OPTIONS_TEMPLATES = composeOptionsTemplates({
	noMatchStart: true,
	noMatchEnd: true,
	noMatchFull: true,
	noGlobstar: true,
	noCharset: true,
	g: {
		flags: "g"
	},
	i: {
		flags: "i"
	},
	gi: {
		flags: "gi"
	}
});

function compileGlob(glob, options) {
	if (typeof glob != "string")
		return null;

	options = createOptionsObject(options, OPTIONS_TEMPLATES);

	const matchStart = !options.noMatchStart && !options.noMatchFull,
		matchEnd = !options.noMatchEnd && !options.noMatchFull,
		useGlobstar = !options.noGlobstar,
		useCharset = !options.noCharset,
		boundaryPrecursor = typeof options.boundary == "string" || Array.isArray(options.boundary) ?
			options.boundary :
			"/",
		boundaryKey = Array.isArray(boundaryPrecursor) ?
			boundaryPrecursor.join("//") :
			boundaryPrecursor,
		flags = options.flags || "",
		cacheKey = `${glob}@${flags}/${Number(matchStart)}${Number(matchEnd)}${Number(useGlobstar)}${Number(useCharset)}@@${boundaryKey}`;

	if (GLOB_CACHE.has(cacheKey))
		return GLOB_CACHE.get(cacheKey);

	if (!hasOwn(BOUNDARY_CACHE, boundaryKey))
		BOUNDARY_CACHE.set(boundaryKey, mkDisallowedWordsRegex(boundaryPrecursor, true));

	const boundary = BOUNDARY_CACHE.get(boundaryPrecursor),
		boundarySequence = `(?:${boundary}|\\\\.)*`;

	let isGlob = false,
		regex = glob.replace(GLOB_REGEX, (
			match,
			escaped,
			wildcard,
			negate,
			charset,
			special
		) => {
			if (escaped)
				return match;

			if (wildcard) {
				isGlob = true;

				switch (wildcard) {
					case "?":
						return boundary;
					case "*":
						return boundarySequence;
					case "**":
						return useGlobstar ?
							".*" :
							boundarySequence;
				}
			}

			if (charset) {
				if (!useCharset)
					return `\\[${cleanRegex(charset)}\\]`;

				isGlob = true;

				if (charset[0] == "^")
					charset = "\\" + unescape(charset);
				else
					charset = unescape(charset);

				charset = charset.replace(/]/, "\\]");

				return `[${negate ? "^" : ""}${charset}]`;
			}

			return "\\" + special;
		});

	if (matchStart)
		regex = "^" + regex;
	if (matchEnd)
		regex = regex + "$";

	const parsed = {
		regex: new RegExp(regex, flags),
		isGlob,
		isGlobCompileResult: true
	};
	GLOB_CACHE.set(cacheKey, parsed);
	return parsed;
}

function matchGlob(str, glob, options) {
	if (typeof str != "string")
		return false;
	
	if (glob && glob.isGlobCompileResult && glob.regex instanceof RegExp)
		return glob.regex.test(str);

	if (typeof glob != "string")
		return false;

	return compileGlob(glob, options).regex.test(str);
}

function isGlob(candidate) {
	if (typeof candidate != "string")
		return false;

	return GLOB_COMPONENT_REGEX.test(candidate);
}

function globToRegex(glob, options) {
	const compiled = compileGlob(glob, options);
	return compiled && compiled.regex;
}

export {
	compileGlob,
	matchGlob,
	isGlob,
	globToRegex
};