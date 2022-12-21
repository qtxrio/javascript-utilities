import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import {
	isObj,
	isPrimitive,
	isArrayLike,
	isTypedArray,
	isBigIntArray,
	isConstructor,
	isArrResolvable
} from "./is";
import { isMapLike } from "./lazy/is";
import { mkEntrySetter } from "./collection";
import forEach from "./for-each";

class ArrayDataBuffer extends Array {}

const EXPAND_OBJECT_OPTIONS_TEMPLATES = composeOptionsTemplates({
	nativeSimple: true
});

export default function map(source, callback, options, target) {
	if (isPrimitive(source) && typeof source != "string")
		return source;

	callback = typeof callback == "function" ?
		callback :
		v => v;

	options = createOptionsObject(options, EXPAND_OBJECT_OPTIONS_TEMPLATES, true);

	let out = target;

	if (!isObj(target)) {
		if (options && options.nativeSimple)
			out = isArrResolvable(source) ? [] : {};
		else if (typeof source == "string")
			out = source;
		else if (isArrayLike(source))
			out = [];
		else
			out = new (source.constructor || Object)();
	} else if (isTypedArray(out) || isOfString(out))
		out = new ArrayDataBuffer();

	const set = mkEntrySetter(
		out,
		isArrayLike(out),
		isMapLike(source)
	);

	forEach(source, (v, k, o) => {
		const value = callback(v, k, o);

		if (typeof value != "object" || value != map.SKIP)
			out = set(k, value, v);
	}, options);

	if (out instanceof ArrayDataBuffer) {
		const buffer = out;

		if (isOfString(target)) {
			out = "";

			for (let i = 0, l = buffer.length; i < l; i++)
				out += buffer[i];
		} else if (isBigIntArray(target)) {
			out = new target.constructor(buffer.length);

			for (let i = 0, l = buffer.length; i < l; i++)
				out[i] = BigInt(buffer[i]);
		} else {
			out = new target.constructor(buffer.length);

			for (let i = 0, l = buffer.length; i < l; i++)
				out[i] = buffer[i];
		}
	}

	return out;
}

map.from = (source, callback, options, target) => {
	const cb = callback,
		opts = options,
		targ = target,
		fn = (callback, options, target) => map(source, callback || cb, options || opts, target || targ);

	fn.to = (target, callback, options) => {
		if (isConstructor(target))
			target = new target();

		return map(source, callback || cb, options || opts, target);
	};

	return fn;
};

map.to = (target, callback, options) => {
	if (isConstructor(target))
		target = new target();

	const cb = callback,
		opts = options,
		fn = (source, callback, options) => map(source, callback || cb, options || opts, target);

	fn.from = fn;

	return fn;
};

map.SKIP = Object.freeze({ description: "tells map function to skip property" });

function isOfString(candidate) {
	return typeof candidate == "string" || candidate == String || candidate instanceof String;
}