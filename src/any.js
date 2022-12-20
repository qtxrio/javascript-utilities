import { resolveKeyCore } from "./object";

const ANY_RT = {
	mode: "key",
	sourceMode: "key",
	keys: null,
	type: null
};

const HANDLERS = {
	// Preparatory handlers
	key(...source) {
		init(source);
		ANY_RT.mode = "key";
		return HANDLERS;
	},
	value(...source) {
		init(source);
		ANY_RT.mode = "value";
		return HANDLERS;
	},
	entry(...source) {
		init(source);
		ANY_RT.mode = "entry";
		return HANDLERS;
	},
	// Intermediate handlers
	as(type) {
		ANY_RT.type = type;
		return HANDLERS;
	},
	type(type) {
		ANY_RT.type = type;
		return HANDLERS;
	},
	// Terminating handlers
	of(source, type = null) {
		switch (ANY_RT.mode) {
			case "key":
				return resolveKeyCore(source, type || ANY_RT.type, ANY_RT.source);

			case "value": {
				const key = resolveKeyCore(source, type || ANY_RT.type, ANY_RT.source);
				if (key == null)
					return null;

				return source[key];
			}
		}

		const key = resolveKeyCore(source, type || ANY_RT.type, ANY_RT.source);
		if (key == null)
			return null;

		return source[key];
	},
	in(source, type = null) {
		return resolveKeyCore(source, type || ANY_RT.type, ANY_RT.source);
	}
};

function init(source) {
	ANY_RT.mode = "value";
	ANY_RT.source = source;
	ANY_RT.type = null;
}

export default function any(...source) {
	init(source);
	return HANDLERS;
}

Object.defineProperties(any, {
	/*key: {
		get() {
			init(null);
		}
	}*/
});

any.key = HANDLERS.key;
any.value = HANDLERS.value;
any.entry = HANDLERS.entry;