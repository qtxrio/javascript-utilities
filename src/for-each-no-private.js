import forEach from "./for-each";

// Private members are keys that begin with _
export default function forEachNoPrivate(obj, callback, options) {
	forEach(obj, (v, k, o) => {
		if (typeof k != "string" || k[0] != "_")
			callback(v, k, o);
	}, options);
}