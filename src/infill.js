import {
	isObj,
	isObject
} from "./is";
import { assign } from "./object";
import map from "./map";
import hasOwn from "./has-own";
import forEach from "./for-each";
import matchType from "./match-type";
import parseStr from "./parse-str";
import parseArgStr from "./parse-arg-str";

// TODO: check where null should be a valid default value
// TODO: fix lvl

// Note: this function mutates the target data
export default function infill(target, source, optionsOrRuntime) {
	if (source === undefined)
		return target;

	const runtime = tickRuntime(optionsOrRuntime);

	if (target == null) {
		if (isObj(source))
			target = Array.isArray(source) ? [] : {};
		else
			return source;
	}

	if (typeof target != "object" || typeof source != "object")
		return target;

	if (Array.isArray(target) != Array.isArray(source))
		return target;

	if (Array.isArray(source)) {
		for (let i = 0, l = source.length; i < l; i++)
			target[i] = infill(target[i], source[i], runtime);

		return target;
	}

	for (const k in source) {
		if (k[0] == "@") {
			const parsed = parseDFModifier(k),
				parsedName = parsed.name,
				parsedKey = parsed.params.arg || k;

			if (hasOwn(runtime.modifiers, parsedName)) {
				runtime.modifiers[parsedName](assign({
					target: target[parsedKey],
					parentTarget: target,
					source: source[k],
					parentSource: source,
					key: parsedKey,
					originalKey: k,
					runtime
				}, parsed.params));
			} else
				console.warn(`'${parsedName}' is not a known modifier`);
		} else if (hasOwn(source, k))
			target[k] = infill(target[k], source[k], runtime);
	}

	return target;
}

const PARSE_MODIFIER_REGEX = /^@([\w_$-]+?)(?:\s*?(?:::(.+))|:(.+))?$/,
	MODIFIER_PARAM_IDENTIFIER_REGEX = /([\w_$-]+?)\s*:\s*(.+)/g;

function parseDFModifier(modifier) {
	const modifierOut = {
		name: null,
		params: {}
	};

	const ex = PARSE_MODIFIER_REGEX.exec(modifier);

	if (!ex)
		return modifierOut;

	modifierOut.name = ex[1];

	if (ex[2]) {
		const paramStr = ex[2],
			args = parseArgStr(paramStr, /[,;]/);

		for (let i = 0, l = args.length; i < l; i++) {
			const arg = args[i],
				iEx = MODIFIER_PARAM_IDENTIFIER_REGEX.exec(arg);

			if (!iEx)
				console.error(`Invalid parameter identifier (at '${arg}')`);
			else
				modifierOut.params[iEx[0]] = parseStr(iEx[1]);
		}
	} else if (ex[3]) {
		modifierOut.params.strArg = ex[3].trim();
		modifierOut.params.arg = parseStr(modifierOut.params.strArg);
	}

	return modifierOut;
}

function tickRuntime(optionsOrRuntime) {
	if (optionsOrRuntime && optionsOrRuntime.isRuntime) {
		optionsOrRuntime.lvl++;
		return optionsOrRuntime;
	}

	const runtime = assign({
		isRuntime: true,
		lvl: 0
	}, optionsOrRuntime);

	if (isObject(runtime.modifiers))
		runtime.modifiers = assign({}, STOCK_INFILL_MODIFIERS, runtime.modifiers);
	else
		runtime.modifiers = STOCK_INFILL_MODIFIERS;

	return runtime;
}

// infill modifiers
// These modify the target based on default data properties (prefixed with @)
// Parameters can optionally be provided:
// @modifier :: param: value; param2: value4; param3: value3
const STOCK_INFILL_MODIFIERS = {
	every({ parentTarget, parentSource, runtime, key }) {
		forEach(parentTarget, t => {
			infill(t, parentSource[key], runtime);
		});
	},
	"any-type"({ parentTarget, parentSource, runtime, originalKey, strArg: type }) {
		forEach(parentTarget, t => {
			if (matchType(t, type))
				infill(t, parentSource[originalKey], runtime);
		});
	},
	"any-key"({ parentTarget, parentSource, runtime, originalKey, strArg: regex }) {
		regex = new RegExp(regex);

		forEach(parentTarget, (t, k) => {
			if (regex.test(String(k)))
				infill(t, parentSource[originalKey], runtime);
		});
	},
	"any-full-key"({ parentTarget, parentSource, runtime, originalKey, strArg: regex }) {
		regex = new RegExp(`^${regex}$`);

		forEach(parentTarget, (t, k) => {
			if (regex.test(String(k)))
				infill(t, parentSource[originalKey], runtime);
		});
	},
	lazy({ parentTarget, source, runtime, arg: key }) {
		if (!isObj(parentTarget) || !isObj(source))
			return;

		if (key) {
			parentTarget[key] = map(parentTarget[key], (t, k) => {
				return infill(t, source[k], runtime);
			});
		} else {
			forEach(parentTarget, ((t, k) => {
				parentTarget[k] = infill(t, source[k], runtime);
			}));
		}
	},
	format({ target, parentTarget, source: formatter, key }) {
		if (typeof formatter != "function")
			return console.warn(`Formatter is not a function (at ${key})`);

		const ret = formatter(target, key, parentTarget);

		if (ret !== undefined)
			parentTarget[key] = ret;
	},
	forEach({ target, source: callback, key }) {
		if (!target)
			return;

		if (typeof callback != "function")
			return console.warn(`Callback is not a function (at ${key})`);

		forEach(target, callback);
	},
	map({ target, parentTarget, source: mapper, key }) {
		if (!target)
			return;

		if (typeof mapper != "function")
			return console.warn(`Mapper is not a function (at ${key})`);

		parentTarget[key] = map(target, mapper);
	}
};