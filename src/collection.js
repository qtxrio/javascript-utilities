import {
	isObj,
	isArrayLike
} from "./is";
import {
	isMapLike,
	isSetLike
} from "./lazy/is";
import { del } from "./object";

// Utilities pertinent to collection data types,
// e.g. Object, Array, Map, Set, HTML collections, etc
function setEntry(target, ...kv) {
	if (typeof target == "string")
		return fastSplice(target, ...kv);

	return mkEntrySetter(target)(...kv);
}

function deleteEntry(target, ...kv) {
	if (typeof target == "string") {
		const [key, originalValue] = kv;
		return fastSplice(target, key, "", originalValue);
	}

	return mkEntryDeleter(target)(...kv);
}

// If only one action is being performed on a string (as in setEntry or deleteEntry),
// run fast, un-boxed, version of the string splicer algorithm
function fastSplice(str, key, value, originalValue) {
	const idx = Number(key),
		ovLen = typeof originalValue == "string" ?
			originalValue.length :
			1;

	if (isNaN(idx) || !isFinite(idx) || idx < 0 || idx > str.length + 2)
		return str;

	return str.slice(0, idx) + String(value) + str.slice(idx + ovLen);
}

function mkSplicer(str) {
	const boxed = {
		shiftMap: [],
		value: str
	};
	
	return (key, value, originalValue) => {
		const idx = Number(key),
			ovLen = typeof originalValue == "string" ?
				originalValue.length :
				1;

		if (isNaN(idx) || !isFinite(idx) || idx < 0 || idx > str.length + 2)
			return boxed.value;

		value = String(value);
		boxed.value = boxed.value.slice(0, idx + (boxed.shiftMap[idx] || 0)) +
			value +
			boxed.value.slice(idx + (boxed.shiftMap[idx] || 0) + ovLen);

		const delta = value.length - ovLen;
		if (!delta)
			return boxed.value;

		if (!boxed.shiftMap.length) {
			for (let i = 0, l = str.length + 1; i < l; i++)
				boxed.shiftMap.push(0);
		}

		for (let i = idx, l = boxed.shiftMap.length; i < l; i++)
			boxed.shiftMap[i] += delta;

		return boxed.value;
	};
}

function mkEntrySetter(target, favorPush = false, preserveKv = false) {
	if (!target)
		return _ => null;

	if (typeof target == "string")
		return mkSplicer(target);

	if (Array.isArray(target)) {
		if (favorPush) {
			return (...kv) => {
				if (kv.length <= 1)
					target.push(kv[0]);
				else if (preserveKv)
					target.push([kv[0], kv[1]]);
				else
					target.push(kv[1]);
	
				return target;
			};
		}

		return (...kv) => {
			if (kv.length > 1)
				target[kv[0]] = kv[1];
			else
				target.push(kv[0]);

			return target;
		};
	}

	if (isMapLike(target) && typeof target.set == "function") {
		return (key, value) => {
			target.set(key, value);
			return target;
		};
	}

	if (isSetLike(target) && typeof target.add == "function") {
		return (...kv) => {
			if (kv.length > 1)
				target.add(kv[1]);
			else
				target.add(kv[0]);

			return target;
		};
	}

	if (isObj(target) || isArrayLike(target)) {
		return (key, value) => {
			target[key] = value;
			return target;
		};
	}

	return _ => null;
}

function mkEntryDeleter(target) {
	if (!target)
		return _ => false;

	if (typeof target == "string") {
		const splicer = mkSplicer(target);
		return (key, originalValue) => splicer(key, "", originalValue);
	}

	if (isMapLike(target) && typeof target.delete == "function")
		return key => target.delete(key);

	if (isSetLike(target) && typeof target.delete == "function") {
		return (...kv) => {
			if (kv.length > 1)
				return target.delete(kv[1]);
			
			return target.delete(kv[0]);
		};
	}

	if (isObj(target) || isArrayLike(target))
		return key => del(target, key);

	return _ => false;
}

function isCollection(candidate) {
	return isObj(candidate) || isArrayLike(candidate) || isMapLike(candidate) || isSetLike(candidate);
}

export {
	setEntry,
	deleteEntry,
	mkEntrySetter,
	mkEntryDeleter,
	isCollection
};