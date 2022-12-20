import forEach from "./for-each";

const ARR_FIND = Array.prototype.find;

export default function find(target, callback) {
	if (Array.isArray(target) && ARR_FIND)
		return ARR_FIND.call(target, callback);

	let pendingValue = null;

	forEach(target, (value, key) => {
		if (callback(value, key, target)) {
			pendingValue = value;
			return forEach.BREAK;
		}
	});

	return pendingValue;
}