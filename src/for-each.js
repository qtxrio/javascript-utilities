import VolatileMap from "./internal/volatile-map";
import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";

import { SYM_ITER_KEY } from "./data/constants";
import {
	isObj,
	isArrayLike
} from "./is";
import {
	isSetLike,
	isMapLike
} from "./lazy/is";
import {
	keys,
	assign
} from "./object";
import hasOwn from "./has-own";

// Polymorphic forEach
// It efficiently handles the following:
// 1. iteration over array-likes
// 2. iteration over own object keys (with support for symbol polyfill; see sym())
// 3. iteration over iterables (with support for polyfilled iterables; see Map, Set)
// 4. iteration over strings, with correct handling of surrogate pairs
// Array-likes that implement the iteration prototcol are iterated over using a standard
// for loop by default. Use the iterable flag to prefer iterators
//
// It also supports reverse iteration over the same
// Note that this function won't iterate over properties added during iteration if:
// a. they have been added to an array-like before the index pointer (forwards)
// b. they have been added to an array-like after the index pointer (reverse)
// c. the target object is a non-iterable object
// d. the target object is an iterable and the reverse flag is truthy
//
// forEach returns itself, except if a loop has been broken or deeply continued
// However, it will always return itself at the root level
//
// forEach supports breaking, continuing, and labels. The syntax is meant
// to be similar to native loops. The general syntax is this:
//
// BREAK		- to break a loop you return forEach.BREAK from the callback function.
//				  this will generate a BREAK token that:
//					1. indicates that you wish to break from the loop
//					2. carries data for which loops to break beyond the first one
//				  You may modify this token by calling it instead on return:
//					forEach.BREAK("label")	- will break every loop until one with the label "label" is found
//					forEach.BREAK(2)		- will break 2 loops
//				  Returning this token will break the internal loop and the same token
//				  will by returning the enclosing forEach witin another forEach will
//				  pass the token on up the chain. Once the token expires, passing it
//				  on will yield no effect
//				  By default, the depth is set to 1 and label is null
// BREAK_ALL	- exactly the same as BREAK, but with a depth set to Infinity
//
// CONTINUE		- to continue a loop you can simply return from it, but if you wish
// 				  to continue an outer loop you may use forEach.CONTINUE instead
//				  Syntactically, forEach.CONTINUE is identical to forEach.BREAK
//				  and uses most of the infrastructure of the latter
//				  by default, the depth is set to 1 and label is null
// CONTINUE_ALL	- exactly the same as CONTINUE, but with a depth set to Infinity
//
// labels		- labels may be used to identify loops. Any non-numerical not-null
//				  value may be used as a label
//
// Options:
// reverse		- iterate in reverse
// iterable		- use iterator if object is iterable over native loop constructs
// isSetLike	- hint that object behaves like a set during iteration, in that
//				  the the returned value at each iteration step represents both
//				  the key and value. It will automatically treat Set instances as set-like
// isMapLike	- hint that object behaves like a map during iteration, in that
//				  if an array is returned at each iteration step, it
//				  will assume that it represents a key-value pair. It will
//				  automatically treat Map instances as map-like. Furthermore,
//				  it will automatically flip the key and value (since forEach
//				  calls callbacks with (value, key, source)). This can be disabled
//				  by explicitly setting flipKV to false
// flipKV		- flip key and value in set-like iteration values. True by default
// sparse		- indicates that the provided object may be sparse, so forEach
//				  should not call the callback on empty properties
// label		- label that can be used to break (nested) forEach
//
// Prefix options:
// options		- forEach.o(options) -> forEach
//				  Pass a valid createOptionsObject data to set the options for forEach
//				  These options are only valid for the next call of forEach and will be overridden
//				  if a new options object is provided in the next forEach invocation
// label		- forEach.l("label") -> forEach
//				  Pass a valid label value (see above) to set in a new options object.
//				  As with forEach.o, it will be overridden if a new options object is provided
//
// Postfix operations
// done			- specify a callback to invoke after the loop has fully finished
//				  no arguments are passed and 'this' is null
// exit			- specify a callback to invoke after the loop has been broken
//				  no arguments are passed and 'this' is null
//				  Note that this will not be called if the loop that was broken was
//				  the last one, as in this case the returned value is forEach itself
//				  and as such it cannot propagate as a token would

const CACHE_STORE = new VolatileMap();

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	reverse: true,
	iterable: true,
	isMapLike: true,
	isSetLike: true,
	flipKV: true,
	noFlipKV: {
		flipKV: false
	},
	sparse: true,
	symbols: true,
	overSymbols: true,
	cacheKeys: 100
});

export default function forEach(src, callback, options) {
	if (!JMP_OBJ.callDepth) {
		JMP_OBJ.aborted = false;
		// Resetting this should only be needed when
		// a BREAK / CONTINUE getter has been invoked
		JMP_OBJ.active = false;
	}

	if (src === null || src === undefined || typeof callback != "function" || JMP_OBJ.active)
		return forEach;

	options = createOptionsObject(options || forEach._options, OPTIONS_TEMPLATES);
	JMP_OBJ.callDepth++;
	forEach._options = null;

	const {
		iterable,
		reverse,
		sparse,
		symbols = options.overSymbols,
		cacheKeys
	} = options;

	if (!iterable && isArrayLike(src)) {
		if (typeof src == "string") {
			if (reverse) {
				for (let i = src.length - 1; i >= 0; i--) {
					let char = src[i];

					if (i > 0) {
						const cc = src.charCodeAt(i - 1);

						if (cc >= 0xd800 && cc <= 0xdbff) {
							char = src[i - 1] + char;
							i--;
						}
					}

					if (invokeCallbackChar(callback, src, i, char)) {
						if (shouldContinue(options))
							continue;
						return brk(options);
					}
				}
			} else {
				for (let i = 0; i < src.length; i++) {
					const idx = i,
						cc = src.charCodeAt(i);
					let char = src[i];

					if (cc >= 0xd800 && cc <= 0xdbff)
						char += src[++i];

					if (invokeCallbackChar(callback, src, idx, char)) {
						if (shouldContinue(options))
							continue;
						return brk(options);
					}
				}
			}
		} else if (reverse) {
			for (let i = src.length - 1; i >= 0; i--) {
				if (invokeCallback(callback, src, i, false, sparse)) {
					if (shouldContinue(options))
						continue;
					return brk(options);
				}
			}
		} else {
			for (let i = 0; i < src.length; i++) {
				if (invokeCallback(callback, src, i, false, sparse)) {
					if (shouldContinue(options))
						continue;
					return brk(options);
				}
			}
		}
	} else if (typeof src[SYM_ITER_KEY] == "function") {
		const iterator = src[SYM_ITER_KEY](),
			setLike = options.isSetLike || isSetLike(src),
			mapLike = options.isMapLike || isMapLike(src),
			stack = [];
		let item = null,
			idx = -1;

		while (++idx >= 0) {
			item = iterator.next();
			if (item.done)
				break;

			let vk;

			if (setLike)
				vk = [item.value, item.value];
			else if (mapLike && Array.isArray(item.value)) {
				if (options.flipKV === false)
					vk = item.value;
				else
					vk = [item.value[1], item.value[0]];
			} else // assume number index as key
				vk = [item.value, idx];

			if (reverse)
				stack.push(vk);
			else if (invokeCallbackVK(callback, src, vk)) {
				if (shouldContinue(options))
					continue;
				return brk(options);
			}
		}

		// options.reverse
		let i = stack.length;
		while (i--) {
			if (invokeCallbackVK(callback, src, stack[i])) {
				if (shouldContinue(options))
					continue;
				return brk(options);
			}
		}
	} else if (isObj(src)) {
		// In V8, the speed difference/memory usage
		// between Object.keys/for and for-in are
		// negligible, but in SpiderMonkey the former is
		// far faster
		let ks;

		if (typeof cacheKeys == "number") {
			const value = CACHE_STORE.get(src);

			if (value)
				ks = value;
			else {
				ks = keys(src);
				CACHE_STORE.set(src, ks, cacheKeys);
			}
		} else
			ks = keys(src);

		if (reverse) {
			for (let i = ks.length - 1; i >= 0; i--) {
				if (invokeCallback(callback, src, ks[i], symbols, !symbols)) {
					if (shouldContinue(options))
						continue;
					return brk(options);
				}
			}
		} else {
			for (let i = 0, l = ks.length; i < l; i++) {
				if (invokeCallback(callback, src, ks[i], symbols, !symbols)) {
					if (shouldContinue(options))
						continue;
					return brk(options);
				}
			}
		}
	}

	if (symbols && typeof Symbol != "undefined") {
		const syms = Object.getOwnPropertySymbols(src);

		for (let i = 0, l = syms.length; i < l; i++) {
			const sym = syms[i];

			if (callback(src[sym], sym, src) == JMP_T) {
				if (shouldContinue(options))
					continue;
				return brk(options);
			}
		}
	}

	JMP_OBJ.callDepth--;
	JMP_OBJ.active = false;
	JMP_OBJ.aborted = false;
	return forEach;
}

forEach._options = null;

forEach.l = lbl => {
	forEach._options = assign({}, forEach._options, {
		label: lbl
	});

	return forEach;
};

forEach.o = opt => {
	forEach._options = opt;
	return forEach;
};

forEach.done = func => {
	if (!JMP_OBJ.aborted && typeof func == "function")
		func.call(null);

	return forEach;
};

forEach.exit = function(func) {
	if (JMP_OBJ.aborted && typeof func == "function")
		func.call(null);

	return forEach;
};

forEach._JMP_TOKEN = depthOrLabel => {
	if (typeof depthOrLabel == "number") {
		JMP_OBJ.label = null;
		JMP_OBJ.depth = depthOrLabel;
	} else {
		JMP_OBJ.label = depthOrLabel;
		JMP_OBJ.depth = Infinity;
	}

	return JMP_T;
};

const JMP_T = forEach._JMP_TOKEN;

JMP_T.done = forEach.done;
JMP_T.exit = forEach.exit;

forEach._JMP_OBJ = {
	depth: Infinity,
	label: null,
	mode: null,
	active: false,
	callDepth: 0,
	aborted: true
};

const JMP_OBJ = forEach._JMP_OBJ;

Object.defineProperties(forEach, {
	BREAK: {
		get() {
			JMP_OBJ.depth = 1;
			JMP_OBJ.label = null;
			JMP_OBJ.mode = "break";
			JMP_OBJ.active = true;
			JMP_OBJ.aborted = true;
			return JMP_T;
		}
	},
	BREAK_ALL: {
		get() {
			JMP_OBJ.depth = Infinity;
			JMP_OBJ.label = null;
			JMP_OBJ.mode = "break";
			JMP_OBJ.active = true;
			JMP_OBJ.aborted = true;
			return JMP_T;
		}
	},
	CONTINUE: {
		get() {
			JMP_OBJ.depth = 1;
			JMP_OBJ.label = null;
			JMP_OBJ.mode = "continue";
			JMP_OBJ.active = true;
			JMP_OBJ.aborted = true;
			return JMP_T;
		}
	},
	CONTINUE_ALL: {
		get() {
			JMP_OBJ.depth = Infinity;
			JMP_OBJ.label = null;
			JMP_OBJ.mode = "continue";
			JMP_OBJ.active = true;
			JMP_OBJ.aborted = true;
			return JMP_T;
		}
	}
});

function invokeCallback(callback, src, k, symbols, checkExistence) {
	if (checkExistence && !hasOwn(src, k, symbols))
		return false;

	callback(src[k], k, src);
	return JMP_OBJ.active;
}

function invokeCallbackVK(callback, src, vk) {
	callback(vk[0], vk[1], src);
	return JMP_OBJ.active;
}

function invokeCallbackChar(callback, src, k, char) {
	callback(char, k, src);
	return JMP_OBJ.active;
}

function shouldContinue(options) {
	if (JMP_OBJ.mode !== "continue")
		return false;

	if (JMP_OBJ.depth == 1) {
		JMP_OBJ.active = false;
		return true;
	}

	if (JMP_OBJ.label !== null && options.label == JMP_OBJ.label) {
		JMP_OBJ.active = false;
		return true;
	}

	return false;
}

// VERY IMPORTANT:
// this function implicitly invalidates tokens by returning
// forEach instead of the token
function brk(options) {
	JMP_OBJ.callDepth--;

	if (--JMP_OBJ.depth <= 0 || !JMP_OBJ.callDepth) {
		JMP_OBJ.active = false;
		JMP_OBJ.aborted = true;
		return forEach;
	}

	if (JMP_OBJ.label !== null && options.label == JMP_OBJ.label) {
		JMP_OBJ.active = false;
		JMP_OBJ.aborted = true;
		return forEach;
	}

	return JMP_T;
}