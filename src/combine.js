import forEach from "./for-each";

export default function combine(arrObj) {
	const out = [],
		precursor = [],
		constr = arrObj.constructor;
	let outLen = 0;

	forEach(arrObj, (arr, key) => {
		arr = Array.isArray(arr) ? arr : [arr];

		outLen = outLen || 1;

		precursor.push({
			arr,
			key,
			len: arr.length,
			period: outLen
		});

		outLen *= arr.length;
	});

	const pLen = precursor.length;

	for (let i = 0; i < outLen; i++) {
		const item = constr();
		out.push(item);

		for (let j = 0; j < pLen; j++) {
			const p = precursor[j];

			item[p.key] = p.arr[Math.floor(i / p.period) % p.len];
		}
	}

	return out;
}