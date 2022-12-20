import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import hasOwn from "./has-own";

// Returns an index around which the comparator proximity is minimal
function binarySearch(arr, comparator, reverse = false) {
	const direction = reverse === true ? -1 : 1;
	let start = 0,
		end = arr.length - 1;

	if (typeof comparator != "function")
		comparator = mkStandardBinaryComparator(comparator);

	while (true) {
		if (start >= end) {
			const si = end >= 0 ?
				comparator(arr[start], start, arr) :
				direction;

			return si > 0 ? start - direction : start;
		}

		const pivot = Math.floor((start + end) / 2),
			proximity = comparator(arr[pivot], pivot, arr);

		if (proximity == 0)
			return pivot;
		else if (proximity * direction < 0)
			start = pivot + 1;
		else
			end = pivot - 1;
	}
}

// Finds the index where the comparator proximity is 0
// or returns -1
function binaryIndexOf(arr, comparator, reverse) {
	if (typeof comparator != "function")
		comparator = mkStandardBinaryComparator(comparator);

	const idx = binarySearch(arr, comparator, reverse),
		item = arr[idx];

	if (idx < 0 || comparator(item, idx, arr) != 0)
		return -1;

	return idx;
}

function binaryHas(arr, comparator) {
	return binaryIndexOf(arr, comparator) > -1;
}

function binaryFind(arr, comparator) {
	const idx = binaryIndexOf(arr, comparator);

	if (idx == -1)
		return null;

	return arr[idx];
}

function mkStandardBinaryComparator(val) {
	switch (typeof val) {
		case "number":
			return v => v - val;

		default:
			return v => {
				if (v == val)
					return 0;

				if (v < val)
					return -1;

				return 1;
			};
	}
}

// Finds the closest match (proximity) given bound parameters
//
// Compararator:
// A function that tekes an array item and returns a number; 0 if the result is the same,
// and negative or positive depending on proximity.

// Config:
// lower:		find closest value that's smaller than or equal to the target value
//				and return error object if the requested comparator value is lower than
//				the lowest compared value in the array
// upper:		find closest value that's larger than or equal to the target value
//				and return error object if the requested comparator value is greater than
//				the greatest compared value in the array
// both:		apply the above rules simultanously
// neither:		apply none of the above rules and return the highest/lowest match
// hintIndex:	index to compare first in the array. The index must be in the array
//				or this value will be ignored. If this index doesn't match exactly,
//				with proximity 0, the index will be used as the first search pivot
const FIND_CLOSEST_OPTIONS_TEMPLATES = composeOptionsTemplates({
	upper: true,
	lower: true,
	bounded: {
		upper: true,
		lower: true
	},
	reverse: true,
	upperReverse: {
		upper: true,
		reverse: true
	},
	lowerReverse: {
		lower: true,
		reverse: true
	},
	boundedReverse: {
		upper: true,
		lower: true,
		reverse: true
	}
});

function findClosest(arr, comparator, options) {
	options = createOptionsObject(options, FIND_CLOSEST_OPTIONS_TEMPLATES);

	let steps = 0;

	if (typeof comparator != "function")
		comparator = mkStandardBinaryComparator(comparator);

	const dispatch = (index, proximity) => {
		return {
			found: index != -1,
			item: arr && arr[index],
			index,
			proximity,
			exact: !proximity,
			steps
		};
	};

	if (!Array.isArray(arr) || !arr.length)
		return dispatch(-1, 0);

	let start = 0,
		end = arr.length - 1,
		pivot = Math.floor((start + end) / 2);

	if (typeof options.hintIndex == "number" && hasOwn(arr, options.hintIndex)) {
		if (comparator(arr[options.hintIndex]) == 0)
			return dispatch(options.hintIndex, 0);

		pivot = options.hintIndex;
	}

	const direction = options.reverse === true ? -1 : 1;

	while (++steps) {
		if (end - start <= 0) {
			const refProx = comparator(arr[start]);

			if (refProx == 0)
				return dispatch(start, refProx);

			let stepPoint = start + (direction * refProx > 0 ? -1 : 1);

			// If a step can be made in the array to acquire a closer/more
			// appropriate candidate, do another comparison one step left/right
			// of the found element.
			const underflow = options.reverse ?
					stepPoint >= arr.length :
					stepPoint < 0,
				overflow = options.reverse ?
					stepPoint < 0 :
					stepPoint >= arr.length,
				outOfBounds = underflow || overflow;

			if ((options.upper && overflow) || (options.lower && underflow))
				return dispatch(-1, 0);

			if (!outOfBounds) {
				const stepProx = comparator(arr[stepPoint]),
					ra = Math.abs(refProx),
					sa = Math.abs(stepProx);

				if (refProx * stepProx < 0) {
					if (!(options.lower ^ options.upper)) {
						if (sa == ra && stepProx > 0 || sa < ra)
							return dispatch(stepPoint, stepProx);
					} else if (options.lower && stepProx < 0)
						return dispatch(stepPoint, stepProx);
					else if (options.upper && stepProx > 0)
						return dispatch(stepPoint, stepProx);
				} else if (!(options.lower ^ options.upper) && sa <= ra)
					return dispatch(stepPoint, stepProx);
			}

			return dispatch(start, refProx);
		}

		const proximity = comparator(arr[pivot]);

		if (proximity == 0)
			return dispatch(pivot, proximity);
		else if (proximity * direction > 0)
			end = pivot - 1;
		else
			start = pivot + 1;

		pivot = Math.floor((start + end) / 2);
	}
}

export {
	binarySearch,
	binaryIndexOf,
	binaryHas,
	binaryFind,
	mkStandardBinaryComparator,
	findClosest
};