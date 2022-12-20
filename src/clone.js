import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import { PolyMap } from "./internal/poly";
import {
	getRegexFlags,
	getRegexSource
} from "./regex";
import {
	attachReference,
	mountReferences,
	mkReferenceCollector,
	isReferenceCollector
} from "./reference";
import { isObj } from "./is";
import { setEntry } from "./collection";
import map from "./map";
import type from "./lazy/type";
import hasOwn from "./has-own";

const REF_MAP = new PolyMap();

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	cloneInstances: true,
	shallow: true,
	cloneSymbols: true,
	circular: true,
	full: {
		circular: true,
		cloneMethod: "clone",
		cloneSymbols: true,
		cloneInstances: true
	}
});

export default function clone(value, options) {
	options = createOptionsObject(options, OPTIONS_TEMPLATES);
	const depth = options.shallow ?
		0 :
		(hasOwn(options, "depth") ?
			options.depth :
			Infinity
		);

	let hasReferences = false;

	const cl = (val, d, ignore) => {
		if (!isObj(val))
			return val;

		// Check if the object is a direct instance of anything else than a native
		// data type, in which case we don't want to copy over the object naively,
		// as the prototypes aren't transferred and we probably don't wish to deep copy
		// instances anyway
		if (!options.cloneInstances && !type.isNative(val))
			return val;

		// If the target object exposes a clone method with a name specified by the
		// cloneMethod field on an options object, defer to it
		if (options.cloneMethod && typeof val[options.cloneMethod] == "function") {
			const collector = mkReferenceCollector();

			const item = REF_MAP.get(val);

			if (item)
				return item;

			hasReferences = true;
			REF_MAP.set(val, collector);

			const out = val[options.cloneMethod](
				mkCloneArgs(cl, {
					value: val,
					depth: d,
					ignore,
					options,
					collector
				})
			);

			REF_MAP.delete(val);
			mountReferences(collector, out);
			return out;
		}

		// Hard-coded specific clones for built-ins
		if (val instanceof RegExp) {
			const out = new RegExp(
				getRegexSource(val),
				getRegexFlags(val)
			);

			out.lastIndex = val.lastIndex;
			return out;
		}
		
		const cloned = new val.constructor();

		if (options.circular || hasReferences)
			REF_MAP.set(val, cloned);

		const out = map(
			val,
			(v, k) => {
				if (isObj(ignore) && hasOwn(ignore, k) && !isObj(ignore[k])) {
					if (typeof ignore[k] == "function") {
						if (ignore[k](v, k, val))
							return map.SKIP;
					} else if (ignore[k])
						return map.SKIP;
				}

				if (!isObj(v) || d >= depth)
					return v;

				if (options.circular || hasReferences) {
					const item = REF_MAP.get(v);

					if (item) {
						if (isReferenceCollector(item))
							return attachReference(item, cloned, k);
						
						return item;
					}
				}

				return cl(v, d + 1, ignore && ignore[k]);
			}, {
				overSymbols: options.cloneSymbols
			},
			cloned
		);

		if (options.circular || hasReferences)
			REF_MAP.delete(val);

		return out;
	};

	return cl(value, 0, options.ignore);
}

function mkCloneArgs(cl, args) {
	const out = {
		...args,
		clone: (value, key) => {
			const ign = key ?
				args.ignore && args.ignore[key] :
				args.ignore;

			return cl(value, args.depth + 1, ign);
		},
		map: (outputOrCallback, callback) => {
			const output = typeof callback == "function" ?
					outputOrCallback :
					new args.value.constructor(),
				cb = typeof callback == "function" ?
					callback :
					outputOrCallback;

			return map(
				args.value, (v, k, o) => {
					const out = cb(v, k, o);

					if (isReferenceCollector(out))
						return attachReference(out, output, k);

					return out;
				}, {
					overSymbols: args.options.cloneSymbols
				},
				output
			);
		},
		set: (target, key, value) => {
			if (isReferenceCollector(value))
				return attachReference(value, target, key);

			return setEntry(target, key, value);
		},
		isCloneArgs: true
	};

	out.map.SKIP = map.SKIP;
	return out;
}