import {
	SYM_ITER_KEY,
	POLYFILL_PREFIXES
} from "./data/constants";
import {
	KEYWORDS,
	RESERVED_WORDS,
	BAD_IDENTIFIERS
} from "./data/lookups";
import type from "./lazy/type";
import hasOwn from "./has-own";
import getFunctionName from "./get-function-name";

const DOC_ALL = typeof document == "undefined" ?
		[] :
		document.all,
	FN_TO_STR = Function.prototype.toString,
	OBJ_TO_STR = Object.prototype.toString;

function isDirectInstanceof(obj, constr) {
	return obj !== null && obj !== undefined && obj.constructor == constr;
}

// Checks if a value is a native simple object,
// i.e. a direct instance of Object or Array,
// or a null prototype object
function isNativeSimpleObject(candidate) {
	if (typeof candidate != "object" || candidate == null)
		return false;

	const proto = Object.getPrototypeOf(candidate);
	if (!proto)
		return true;

	const constr = proto.constructor;
	return constr == Object || constr == Array;
}

function isObj(candidate) {
	return candidate !== null && typeof candidate == "object";
}

function isObject(candidate) {
	if (!candidate || typeof candidate != "object")
		return false;

	const proto = Object.getPrototypeOf(candidate);
	return proto == null || proto == Object.prototype;
}

function isObjectLike(candidate) {
	return OBJ_TO_STR.call(candidate) == "[object Object]";
}

function isInstance(candidate) {
	return candidate !== null && candidate !== undefined && Object.getPrototypeOf(candidate) != Function.prototype;
}

function isConstructor(candidate) {
	return candidate !== null && candidate !== undefined && candidate.prototype != null && candidate.prototype.constructor == candidate;
}

// Basic and highly speculative measure of whether a supplied value
// is a constructor. Because normal functions are technically constructible,
// this function attempts to apply some heuristics to provided functions:
// 1. must not be defined using arrow notation
// 2. should not return anything
// 3. name must begin with a capital letter
const HANDLER = { construct: _ => ({}) },
	NON_CONSTRUCTIBLE_REGEX = /^(?:\([^)]*\)|[\w\s]+)=>|return[^\n;]+;[\s\n]*}/,
	CONSTRUCTIBLE_REGEX = /^\s*class/;

function isProbableConstructor(candidate) {
	// Remove any definite false values
	if (!isConstructor(candidate) || isNonConstructible(candidate))
		return false;

	// Definitely true if the provided function is native
	if (isNativeConstructor(candidate))
		return true;

	if (typeof Proxy != "undefined") {
		try {
			new (new Proxy(candidate, HANDLER))();
		} catch {
			// Definitely not constructible if there's no [[Construct]] internal method
			return false;
		}
	}

	const constrStr = FN_TO_STR.call(candidate);

	// Test for functions that are definitely constructible
	if (CONSTRUCTIBLE_REGEX.test(constrStr))
		return true;

	// If the function is defined using fat arrow notation
	// or returns anything, it's most likely not a constructor
	if (NON_CONSTRUCTIBLE_REGEX.test(constrStr))
		return false;

	return isUpperCase(getFunctionName(candidate)[0]);
}

function isNativeConstructor(candidate) {
	if (type.getNativeCode(candidate))
		return true;

	return isConstructor(candidate) && isNativeFunction(candidate) && isUpperCase(getFunctionName(candidate)[0]);
}

function isNonConstructible(candidate) {
	return typeof Symbol != "undefined" && candidate == Symbol;
}

function isPrimitive(candidate) {
	if (!candidate && candidate !== DOC_ALL)
		return true;

	switch (typeof candidate) {
		case "object":
		case "function":
			return false;
	}

	return true;
}

function isValidObjectKey(key) {
	switch (typeof key) {
		case "string":
		case "symbol":
			return true;
	}

	return false;
}

const isSymbol = typeof Symbol == "undefined" ?
	candidate => typeof candidate == "string" && candidate.indexOf(POLYFILL_PREFIXES.symbol) == 0 :
	candidate => typeof candidate == "symbol";

const isIterable = typeof Symbol == "undefined" ?
	candidate => {
		if (candidate === DOC_ALL || typeof candidate == "string")
			return true;

		if (candidate == null || typeof candidate != "object")
			return false;

		return SYM_ITER_KEY in candidate;
	} :
	candidate => {
		if (candidate === DOC_ALL || typeof candidate == "string")
			return true;

		if (candidate == null || typeof candidate != "object")
			return false;

		return Symbol.iterator in candidate;
	};

function isLoopable(candidate) {
	return isIterable(candidate) || isObject(candidate) || isArrayLike(candidate);
}

function isArrayLike(candidate) {
	// Common array-likes
	if (Array.isArray(candidate) || typeof candidate == "string" || candidate === DOC_ALL)
		return true;

	// Non-objects or objects without a numerical length property
	if (!candidate || typeof candidate != "object" || typeof candidate.length != "number")
		return false;

	// Object instances or the window object (Arguments objects are not included)
	if ((candidate.constructor == Object && String(candidate) != "[object Arguments]") || (typeof window == "object" && candidate == window))
		return false;

	// If the object is syntactically an array, see if Array.prototype.slice
	// can slice a single element from the supposedly array-like object.
	if ([].slice.call(candidate, 0, 1).length == 1)
		return true;

	// If the array-like candidate has a length of 0, make sure the object is
	// empty. Array-like objects normally don't contain such fluff, and
	// the length property should be unenumerable or a prototype prop.
	return candidate.length == 0 && Object.keys(candidate).length == 0;
}

const isTypedArray = typeof Int8Array == "undefined" ?
	_ => false :
	(_ => {
		const TypedArray = Object.getPrototypeOf(Object.getPrototypeOf(new Int8Array())).constructor;
		return candidate => candidate instanceof TypedArray;
	})();

const isBigIntArray = (_ => {
	const BigInt64ArrayConstructor = typeof BigInt64Array != "undefined" ?
			BigInt64Array :
			class Null {},
		BigUint64ArrayConstructor = typeof BigUint64Array != "undefined" ?
			BigUint64Array :
			class Null {};

	return candidate => {
		return candidate instanceof BigInt64ArrayConstructor ||
			candidate instanceof BigUint64ArrayConstructor;
	};
})();

function isArrResolvable(candidate) {
	if (isArrayLike(candidate))
		return true;

	if (typeof Set != "undefined" && candidate instanceof Set)
		return true;

	return false;
}

function isEnv(env, def = "production") {
	if (typeof process == "undefined")
		return env == def;

	return process.env.NODE_ENV == env;
}

function isNativeFunction(candidate) {
	if (typeof candidate != "function")
		return false;

	const funcStr = FN_TO_STR.call(candidate);
	let foundOpenBrace = false;

	if (funcStr.length > 500)
		return false;

	for (let i = 0, l = funcStr.length; i < l; i++) {
		const c = funcStr[i];

		if (foundOpenBrace) {
			if (c == "[")
				return funcStr.substring(i, i + 13) == "[native code]";

			if (!isWhitespace(c))
				return false;
		} else if (c == "{")
			foundOpenBrace = true;
	}

	return false;
}

// Whitespace characters (as recognized by the standard of String.prototype.trim)
function isWhitespace(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	const code = char.charCodeAt(0);
	return code > 8 && code < 14 || code == 32 || code == 0xa0 || code == 0x2028 || code == 0x2029 || code == 0xfeff;
}

function isDigit(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	const code = char.charCodeAt(0);
	return code >= 48 && code <= 57;
}

function isHexDigit(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	const code = char.charCodeAt(0);
	return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) || (code >= 65 && code <= 70);
}

function isAlpha(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	const code = char.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}

function isAlphanumeric(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	const code = char.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 || code <= 122) || code >= 48 && code <= 57;
}

function isNewline(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	return char == "\n" || char == "\r";
}

function isQuote(char) {
	if (typeof char != "string" || char.length != 1)
		return false;

	return char == "\"" || char == "'" || char == "`";
}

function isLowerCase(char) {
	return char.toLowerCase() == char;
}

function isUpperCase(char) {
	return char.toUpperCase() == char;
}

function isEmptyString(str) {
	if (typeof str != "string")
		return false;

	return !str.trim();
}

function isArrayKey(candidate) {
	if (typeof candidate == "number")
		return !isNaN(candidate) && isFinite(candidate) && candidate >= 0 && candidate % 1 == 0;

	if (typeof candidate != "string")
		return false;

	const num = Number(candidate);
	if (isNaN(num) || !isFinite(num))
		return false;

	return num >= 0 && num % 1 == 0 && !/[boxe.]/.test(candidate);
}

function isThenable(candidate) {
	if (!candidate)
		return false;

	return typeof candidate.then == "function";
}

function isTaggedTemplateArgs(args) {
	if (!Array.isArray(args))
		return false;

	const firstArg = args[0];

	return Boolean(firstArg && firstArg.raw) && Array.isArray(firstArg) && Array.isArray(firstArg.raw);
}

// Returns true if the provided data is a semantically valid
// property descriptor that either contains a valid getter and/or setter,
// or a value property
function isDescriptor(candidate) {
	if (!isObject(candidate))
		return false;

	const hasGetter = hasOwn(candidate, "get"),
		hasSetter = hasOwn(candidate, "set"),
		hasValue = hasOwn(candidate, "value");

	if ((hasOwn(candidate, "writable") || hasValue) && (hasGetter || hasSetter))
		return false;

	if (hasGetter && typeof candidate.get != "function")
		return false;
	if (hasSetter && typeof candidate.set != "function")
		return false;

	return hasGetter || hasSetter || hasValue;
}

const VALID_DESCRIPTOR_PROPERTIES = {
	// Common keys
	configurable: "boolean",
	enumerable: "boolean",
	// data descrptor keys
	value: null,
	writable: "boolean",
	// accessor descriptor keys
	get: "function",
	set: "function"
};

// Same as isDescriptor, but with the provision that all keys
// must be known keys as per the descriptor specification
function isDescriptorStrict(candidate) {
	if (!isDescriptor(candidate))
		return false;

	for (const k in candidate) {
		if (!hasOwn(candidate, k))
			continue;

		if (!hasOwn(VALID_DESCRIPTOR_PROPERTIES, k))
			return false;

		if (VALID_DESCRIPTOR_PROPERTIES[k] && typeof candidate[k] != VALID_DESCRIPTOR_PROPERTIES[k])
			return false;
	}

	return true;
}

function isStandardPropertyDescriptor(candidate) {
	if (!candidate || !hasOwn(candidate, "value"))
		return false;

	return candidate.writable && candidate.enumerable && candidate.configurable;
}

function isValidIdentifier(candidate) {
	if (typeof candidate != "string")
		return false;

	if (KEYWORDS.has(candidate) || RESERVED_WORDS.has(candidate) || BAD_IDENTIFIERS.has(candidate))
		return false;

	return /^[a-z$_][\w$_]*$/i.test(candidate);
}

function isValidIdentifierDetailed(candidate) {
	const response = {
		valid: false,
		error: null
	};
	
	if (typeof candidate != "string") {
		response.error = "not-string";
		return response;
	}

	if (KEYWORDS.has(candidate)) {
		response.error = "keyword";
		return response;
	}

	if (RESERVED_WORDS.has(candidate)) {
		response.error = "reserved-word";
		return response;
	}
	
	if (BAD_IDENTIFIERS.has(candidate)) {
		response.error = "bad-identifier";
		return response;
	}
	
	if (!/^[a-z$_][\w$_]*$/i.test(candidate)) {
		response.error = "syntax-error";
		return response;
	}
	
	response.valid = true;
	return response;
}

export {
	isDirectInstanceof,
	isNativeSimpleObject,
	isObj,
	isObject,
	isObjectLike,
	isInstance,
	isConstructor,
	isProbableConstructor,
	isNativeConstructor,
	isNonConstructible,
	isPrimitive,
	isValidObjectKey,
	isSymbol,
	isIterable,
	isLoopable,
	isArrayLike,
	isTypedArray,
	isBigIntArray,
	isArrResolvable,
	isEnv,
	isNativeFunction,
	isWhitespace,
	isDigit,
	isHexDigit,
	isAlpha,
	isAlphanumeric,
	isNewline,
	isQuote,
	isLowerCase,
	isUpperCase,
	isEmptyString,
	isArrayKey,
	isThenable,
	isTaggedTemplateArgs,
	isDescriptor,
	isDescriptorStrict,
	isStandardPropertyDescriptor,
	isValidIdentifier,
	isValidIdentifierDetailed
};