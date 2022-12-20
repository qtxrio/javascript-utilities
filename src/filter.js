import map from "./map";

export default function filter(obj, callback, options) {
	const mapCallback = typeof callback == "function" ?
		(v, k, o) => callback(v, k, o) ? v : map.SKIP :
		v => v;

	return map(obj, mapCallback, options);
}