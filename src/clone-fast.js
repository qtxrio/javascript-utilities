import {
	isNativeSimpleObject,
	isArrayLike
} from "./is";
import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import hasOwn from "./has-own";

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	cloneInstances: true,
	shallow: true,
	cloneSymbols: true
});

// Faster but slightly less feature rich clone function
export default function cloneFast(obj, options) {
	options = createOptionsObject(options, OPTIONS_TEMPLATES);
	const depth = options.shallow ?
		0 :
		(hasOwn(options, "depth") ? options.depth : Infinity);

	const cl = (o, d) => {
		if (typeof o == "object" && o != null) {
			// Check if the object is a direct instance of anything else than Object
			// or Array, in which case we don't want to copy over the object naively,
			// as the prototypes aren't transferred and we probably don't wish to deep copy
			// an instance anyway
			if (!isNativeSimpleObject(o) && !options.cloneInstances)
				return o;

			let objOut;

			if (isArrayLike(o)) {
				objOut = [];

				for (let i = 0, l = o.length; i < l; i++)
					objOut.push(d < depth ? cl(o[i], d + 1) : o[i]);
			} else {
				objOut = {};

				for (let k in o) {
					if (hasOwn(o, k, options.cloneSymbols))
						objOut[k] = d < depth ? cl(o[k], d + 1) : o[k];
				}
			}

			if (options.cloneSymbols && typeof Symbol != "undefined") {
				const symbols = Object.getOwnPropertySymbols(o);

				for (let i = 0, l = symbols.length; i < l; i++) {
					const sym = symbols[i];
					objOut[sym] = d < depth ? cl(o[sym], d + 1) : o[sym];
				}
			}

			return objOut;
		}

		return o;
	};

	return cl(obj, 0);
}