import forEach from "./for-each";

const ARR_FIND_INDEX = Array.prototype.findIndex;

export default function find(target, callback) {
	if (Array.isArray(target) && ARR_FIND_INDEX)
		return ARR_FIND_INDEX.call(target, callback);

	let pendingIdx = -1,
		found = false;

	forEach(target, (value, key) => {
		pendingIdx++;

		if (callback(value, key, target)) {
			found = true;
			return forEach.BREAK;
		}
	});

	return found ? pendingIdx : -1;
}