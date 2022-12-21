import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import { PolySet } from "./internal/poly";
import {
	isObj,
	isArrayLike,
	isNativeSimpleObject
} from "./is";
import { coerceObj } from "./coerce";
import clone from "./clone";
import hasOwn from "./has-own";
import matchQuery from "./match-query";

/*
	OPTIONS = {
		cloneTarget: false		- clone the target object before injecting (boolean)
		cloneExtender: false	- clone the extender object before injecting
		clone: false			- clone both target and extender before injecting
		noUndef: false			- don't inject if extender property is undefined
		preserveInstances: true	- inject any instance variables that are not arrays or simple objects without cloning them
		root: null				- extract data from this object using the extender's keys/array values as keys for extension
		override: false			- override the target object data with data from the extender primitive by primitive
		shallow: false 			- shallow extend - not recursive
	}
*/

const REF_SET = new PolySet();

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	clone: true,
	cloneTarget: true,
	cloneExtender: true,
	injectDataset: {
		cloneExtender: true,
		override: true,
	},
	injectSymbols: true,
	override: true,
	overrideNullish: true,
	noUndef: true,
	shallow: true,
	preserveInstances: true,
	strictSchema: true,
	circular: true,
	restrictiveTarget: true
});

export default function inject(target, extender, options) {
	options = createOptionsObject(options, OPTIONS_TEMPLATES);

	if (options.clone || options.cloneTarget)
		target = clone(target, options);
	if (options.clone || options.cloneExtender)
		extender = clone(extender, options);

	if (options.root) {
		let newExtender = {},
			extenderIsArr = Array.isArray(extender);

		for (let k in extender) {
			let key = extenderIsArr ? extender[k] : k;

			if (hasOwn(extender, k, false))
				newExtender[key] = options.root[extender[k]];
		}

		extender = newExtender;
	}

	const inj = (targ, ext, runtime) => {
		const srcTarg = targ;
		targ = coerceObj(targ, ext);
		ext = coerceObj(ext);

		if (options.circular)
			REF_SET.add(ext);

		if (Array.isArray(ext)) {
			const len = options.restrictiveTarget ?
				(Array.isArray(srcTarg) ? targ.length : ext.length) :
				ext.length;

			for (let i = 0; i < len; i++)
				doInject(i, targ, ext, runtime, false);
		} else {
			for (let k in ext)
				doInject(k, targ, ext, runtime, options.injectSymbols);
		}

		if (options.injectSymbols && typeof Symbol != "undefined") {
			const symbols = Object.getOwnPropertySymbols(ext);

			for (let i = 0, l = symbols.length; i < l; i++)
				doInject(symbols[i], targ, ext, runtime, true);
		}

		if (options.circular) {
			REF_SET.delete(ext);
			REF_SET.delete(targ);
		}

		return targ;
	};

	const doInject = (key, targ, ext, runtime, allowSymbols) => {
		const {
			schema,
			ignore
		} = runtime;

		if (rt.useSchema && options.strictSchema && (isObj(schema) && !hasOwn(schema, key)))
			return;

		if (isObj(schema)) {
			if (schema[key] === false)
				return;

			if (isObj(schema[key]) && (!isObj(ext[key]) || Array.isArray(schema[key]) != isArrayLike(ext[key])))
				return;
		}

		if (isObj(ignore) && hasOwn(ignore, key) && !isObj(ignore[key])) {
			if (typeof ignore[key] == "function") {
				if (ignore[key](ext[key], key, ext))
					return;
			} else if (ignore[key])
				return;
		}

		if (hasOwn(ext, key, allowSymbols) && (!options.noUndef || ext[key] !== undefined)) {
			if (typeof options.preInject == "function")
				options.preInject(targ[key], key, targ, ext, runtime);

			let val = targ[key];

			if (isObj(ext[key]) && (options.preserveInstances || isNativeSimpleObject(ext[key])) && !options.shallow) {
				runtime.schema = schema && schema[key];
				runtime.ignore = ignore && ignore[key];

				if (options.circular) {
					if (REF_SET.has(ext[key]))
						val = ext[key];
					else
						val = inj(val, ext[key], runtime);
				} else
					val = inj(val, ext[key], runtime);

				runtime.schema = schema;
				runtime.ignore = ignore;
			} else if (!hasOwn(targ, key) || options.override || (val == null && options.overrideNullish))
				val = ext[key];
			else
				return;

			if (typeof options.inject == "function")
				targ[key] = options.inject(val, key, targ, ext, runtime);
			else
				targ[key] = val;
		}
	};

	const rt = {
		schema: options.schema ? matchQuery(
			extender,
			options.schema,
			[
				"deep|returnMatchMap|throwOnStrictMismatch",
				options.schemaOptions || "typed"
			]
		).matchMap : null,
		ignore: options.ignore,
		options
	};

	rt.useSchema = Boolean(rt.schema);

	return inj(
		target,
		extender,
		rt
	);
}