import forEach from "./for-each";

export default function forEachDeep(obj, callback, options) {
	if (!obj || typeof callback != "function")
		return;

	const iterate = ob => {
		forEach(ob, (e, k, o) => {
			callback(e, k, o);

			if (e && typeof e == "object")
				iterate(e);
		}, options);
	};

	iterate(obj);
}