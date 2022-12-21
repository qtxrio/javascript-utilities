import {
	isObject,
	isStandardPropertyDescriptor
} from "./is";
import { sym } from "./symbol";
import { mkClass } from "./class";
import hasOwn from "./has-own";
import resolveArgs from "./resolve-args";

// Standard library collecting function. Leverages the prototype chain to prevent
// needlessly having to Object.assign new clean objects every time
// an object with standard methods/fields is needed

const NAME_SYM = sym("standard library name"),
	PARAMS = [
		{ name: "name", type: "string" },
		{ name: "libs", coalesce: true }
	];

export default function mkStdLib(...args) {
	const {
		name,
		libs
	} = resolveArgs(args, PARAMS);

	// If a name is provided, create a custom named constructor
	const impl = name ?
		mkNamedStdLibImpl(name) :
		mkAnonymousStdLibImpl();

	impl.add = (key, val) => {
		if (!key || typeof key != "string")
			return console.warn(`Cannot add ${impl[NAME_SYM]} function: ${key} is not a valid key`);

		impl.prototype[key] = val;
	};

	impl.remove = key => {
		if (hasOwn(impl.prototype, key))
			return delete impl.prototype[key];

		return false;
	};

	impl.has = (instOrKey, key) => {
		if (isStdLib(instOrKey))
			return hasOwn(instOrKey, key) || hasOwn(impl.prototype, key);

		return hasOwn(impl.prototype, instOrKey);
	};

	assign(impl.prototype, libs);
	return impl;
}

function mkNamedStdLibImpl(name) {
	const impl = mkClass({
		name,
		constructor(...args) {
			assign(this, args);
		}
	});

	impl[NAME_SYM] = name;
	return impl;
}

function mkAnonymousStdLibImpl() {
	class StdLib {
		constructor(...extend) {
			assign(this, extend);
		}
	}

	StdLib[NAME_SYM] = "StdLib";
	return StdLib;
}

function assign(target, sources) {
	if (!sources)
		return;

	for (let i = 0, l = sources.length; i < l; i++) {
		const source = sources[i];

		// Unlike Object.assign, don't accept non-object lib values
		if (!isObject(source))
			continue;

		for (const k in source) {
			const descriptor = Object.getOwnPropertyDescriptor(source, k);

			if (!descriptor)
				continue;

			if (isStandardPropertyDescriptor(descriptor))
				target[k] = source[k];
			else
				Object.defineProperty(target, k, descriptor);
		}
	}
}

function isStdLib(candidate) {
	return Boolean(candidate) && hasOwn(candidate, NAME_SYM);
}