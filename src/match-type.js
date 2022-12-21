import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import {
	isConstructor,
	isNativeFunction,
	isProbableConstructor
} from "./is";
import { getGlobalScope } from "./env";
import hasOwn from "./has-own";

const TYPES_CACHE = {
	// typeof keys
	undefined: "undefined",
	boolean: "boolean",
	number: "number",
	bigint: "bigint",
	string: "string",
	symbol: "symbol",
	function: "function",
	object: "object",
	// match standard functions
	int: val => typeof val == "number" && !isNaN(val) && isFinite(val) && val % 1 == 0,
	uint: val => typeof val == "number" && !isNaN(val) && isFinite(val) && val % 1 == 0 && val >= 0,
	nullish: val => val == null,
	constructor: isConstructor,
	any: val => true
};

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	strictConstructor: true,
	noStrictConstructor: {
		strictConstructor: false
	},
	falseDefault: {
		defaultMatch: false
	},
	trueDefault: {
		defaultMatch: true
	}
});

export default function matchType(val, type, options, forceFalseDefault = false) {
	options = createOptionsObject(options, OPTIONS_TEMPLATES);

	if (typeof type == "string") {
		if (hasOwn(TYPES_CACHE, type))
			type = TYPES_CACHE[type];
		else
			type = mkTypeChecker(type);

		if (typeof type == "function")
			return Boolean(type(val));
	}

	if (typeof type == "string")
		return typeof val == type;
	else if (typeof type == "function") {
		if (isProbableConstructor(type)) {
			if (options.strictConstructor !== false)
				return val != null && val.constructor == type;

			return typeof val == "object" ?
				val instanceof type :
				val != null && val.constructor == type;
		}

		// Catch rare cases where the type is a constructor
		try {
			return Boolean(type(val));
		} catch {
			if (options.strictConstructor !== false)
				return val != null && val.constructor == type;

			return typeof val == "object" ?
				val instanceof type :
				val != null && val.constructor == type;
		}
	} else if (Array.isArray(type)) {
		for (let i = type.length - 1; i >= 0; i--) {
			if (matchType(val, type[i], options, true))
				return true;
		}

		return false;
	}

	if (forceFalseDefault)
		return false;

	return hasOwn(options, "defaultMatch") ?
		options.defaultMatch :
		true;
}

function mkTypeChecker(signature) {
	const typeIds = signature
			.trim()
			.split(/\s*\|\s*/),
		globalScope = getGlobalScope(),
		expensiveTerms = [],
		expensiveParams = [],
		expensiveArgs = [],
		terms = [],
		params = [],
		args = [];

	for (let i = 0, l = typeIds.length; i < l; i++) {
		const typeId = typeIds[i],
			paramName = getParamName(i);

		if (hasOwn(TYPES_CACHE, typeId)) {
			if (typeof TYPES_CACHE[typeId] == "function") {
				expensiveTerms.push(`${paramName}(_val)`);
				expensiveParams.push(paramName);
				expensiveArgs.push(TYPES_CACHE[typeId]);
			} else
				terms.push(`typeof _val == "${typeId}"`);

			continue;
		}

		const type = globalScope[typeId];

		if (!type || !isConstructor(type) || !isNativeFunction(type))
			throw new Error(`Failed to find a valid typeof value, cached type, or global constructor by ID '${typeId}' (in type signature '${signature})'`);

		terms.push(`(_val != null && _val.constructor == ${paramName})`);
		params.push(paramName);
		args.push(type);
	}

	const body = `return ${terms.concat(expensiveTerms).join(" || ")};`,
		checker = Function(
			...params,
			...expensiveParams,
			"_val",
			body
		).bind(null, ...args, ...expensiveArgs);

	TYPES_CACHE[signature] = checker;
	return checker;
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