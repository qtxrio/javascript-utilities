import {
	isNativeSimpleObject,
	isArrayLike
} from "./is";
import forEach from "./for-each";
import mkAccessor from "./mk-accessor";

// Creates a static proxy object from data
// Proxies are deeply frozen and warnings are
// dispatched when mutation is attempted
export default function immutate(obj, path = ["(proxy)"]) {
	if (!isNativeSimpleObject(obj))
		return obj;

	const retObj = isArrayLike(obj) ? [] : {},
		getset = {};

	forEach(obj, (val, key) => {
		val = immutate(val, path.concat(key));

		getset[key] = {
			enumerable: true,
			configurable: false,
			get: _ => val,
			set: _ => {
				throw new TypeError(`Cannot set value for "${key}" at ${mkAccessor(path)} because the object is immutable`);
			}
		};
	});

	Object.defineProperties(retObj, getset);
	return Object.freeze(retObj);
}