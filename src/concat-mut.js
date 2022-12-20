// WARNING: this function mutates the original array
export default function concatMut(target, ...arrays) {
	for (let i = 0, l = arrays.length; i < l; i++) {
		const arr = arrays[i];

		if (!Array.isArray(arr))
			target.push(arr);

		for (let j = 0, l2 = arr.length; j < l2; j++)
			target.push(arr[j]);
	}

	return target;
}