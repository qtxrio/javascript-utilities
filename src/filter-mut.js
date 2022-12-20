// WARNING: this function mutates the original array
export default function filterMut(arr, filterer) {
	let overridePtr = -1;

	for (let i = 0, l = arr.length; i < l; i++) {
		const item = arr[i],
			doFilter = !filterer(item, i, arr);

		if (doFilter) {
			overridePtr = overridePtr == -1 ? i : overridePtr;
			continue;
		}

		if (overridePtr > -1) {
			arr[overridePtr] = item;
			overridePtr++;
		}
	}

	if (overridePtr > -1)
		arr.length = overridePtr;

	return arr;
}