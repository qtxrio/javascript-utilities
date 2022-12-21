import {
	hasOwn,
	create,
	isObject
} from "./internal/duplicates";

class Lookup {
	constructor() {
		this.lookup = create(null);
		this.length = 0;
	}

	has(key) {
		if (typeof key != "string" && typeof key != "symbol")
			return false;

		return Boolean(this.lookup[key]);
	}

	add(key) {
		if (!this.has(key)) {
			this.lookup[key] = true;
			this.length++;
		}

		return this;
	}

	delete(key) {
		if (this.has(key)) {
			this.lookup[key] = false;
			this.length--;
			return true;
		}

		return false;
	}
}

export default function lookup(source = [], splitChar = "|", lazy = false) {
	if (lazy && source instanceof Lookup)
		return source;

	const out = new Lookup();

	if (isObject(source)) {
		for (const k in source) {
			if (hasOwn(source, k) && source[k])
				out.add(k);
		}

		return out;
	}

	if (typeof source == "string")
		source = source.split(splitChar);

	if (!Array.isArray(source))
		return out;

	for (let i = source.length - 1; i >= 0; i--)
		out.add(source[i]);

	return out;
}