const DEFAULT_COMPARE_KEY = "value";

// Up-heap
function upHeap(heap, node, compareKey, min) {
	let swaps = 0;

	while (node.index) {
		const parentIndex = (node.index - 1) >> 1,
			parentNode = heap[parentIndex];

		if (isValid(parentNode[compareKey], node[compareKey], min))
			break;

		heap[parentIndex] = node;
		heap[node.index] = parentNode;

		parentNode.index = node.index;
		node.index = parentIndex;
		swaps++;
	}

	return swaps;
}

function upHeapMin(heap, node = heap[heap.length - 1], compareKey = DEFAULT_COMPARE_KEY) {
	return upHeap(heap, node, compareKey, true);
}

function upHeapMax(heap, node = heap[heap.length - 1], compareKey = DEFAULT_COMPARE_KEY) {
	return upHeap(heap, node, compareKey, false);
}

// Down-heap
function downHeap(heap, node, compareKey, min) {
	let swaps = 0;

	while (true) {
		const parentIndex = node.index,
			childNodeL = heap[parentIndex * 2 + 1],
			childNodeR = heap[parentIndex * 2 + 2];
		let extreme = node;

		if (childNodeL && isValid(childNodeL[compareKey], extreme[compareKey], min))
			extreme = childNodeL;

		if (childNodeR && isValid(childNodeR[compareKey], extreme[compareKey], min))
			extreme = childNodeR;

		if (extreme == node)
			break;

		heap[parentIndex] = extreme;
		heap[extreme.index] = node;

		node.index = extreme.index;
		extreme.index = parentIndex;
		swaps++;
	}

	return swaps;
}

function downHeapMin(heap, node = heap[0], compareKey = DEFAULT_COMPARE_KEY) {
	return downHeap(heap, node, compareKey, false);
}

function downHeapMax(heap, node = heap[0], compareKey = DEFAULT_COMPARE_KEY) {
	return downHeap(heap, node, compareKey, false);
}

// Up/down-heap
function bubbleHeap(heap, node, compareKey, min) {
	const swaps = upHeap(heap, node, compareKey || DEFAULT_COMPARE_KEY, min);

	if (swaps)
		return swaps;

	return -downHeap(heap, node, compareKey || DEFAULT_COMPARE_KEY, min) || 0;
}

function bubbleHeapMin(heap, node, compareKey = DEFAULT_COMPARE_KEY) {
	return bubbleHeap(heap, node, compareKey, true);
}

function bubbleHeapMax(heap, node, compareKey = DEFAULT_COMPARE_KEY) {
	return bubbleHeap(heap, node, compareKey, false);
}

// Creation/insertion
function mkHeapNode(keyOrValue, value) {
	return (compareKey, compareValue) => {
		let key = keyOrValue,
			val = value;

		if (val === undefined) {
			val = key;
			key = null;
		}

		const node = {
			key,
			value: val,
			index: 0
		};

		if (compareKey)
			node[compareKey] = compareValue;

		return node;
	};
}

function addHeapNode(heap, keyOrValue, value) {
	const maker = mkHeapNode(keyOrValue, value);

	return (compareKey, compareValue) => {
		const node = maker(compareKey, compareValue);

		node.index = heap.length;
		heap.push(node);

		return node;
	};
}

function insertHeapNodeMin(heap, keyOrValue, value) {
	const adder = addHeapNode(heap, keyOrValue, value);

	return (compareKey, compareValue) => {
		const node = adder(compareKey, compareValue);
		upHeap(heap, node, compareKey || DEFAULT_COMPARE_KEY, true);
		return node;
	};
}

function insertHeapNodeMax(heap, keyOrValue, value) {
	const adder = addHeapNode(heap, keyOrValue, value);

	return (compareKey, compareValue) => {
		const node = adder(compareKey, compareValue);
		upHeap(heap, node, compareKey || DEFAULT_COMPARE_KEY, false);
		return node;
	};
}

// Updating
function updateHeapNode(heap, node, compareKeyOrValue, value, min) {
	let compareKey = compareKeyOrValue;

	if (value === undefined) {
		compareKey = DEFAULT_COMPARE_KEY;
		value = compareKeyOrValue;
	}

	if (value !== undefined)
		node[compareKey] = value;

	return bubbleHeap(heap, node, compareKey, min);
}

function updateHeapNodeMin(heap, node, compareKeyOrValue, value) {
	return updateHeapNode(heap, node, compareKeyOrValue, value, true);
}

function updateHeapNodeMax(heap, node, compareKeyOrValue, value) {
	return updateHeapNode(heap, node, compareKeyOrValue, value, false);
}

// Extraction
function extractHeapNode(heap, compareKey, min) {
	if (!heap.length)
		return null;
	if (heap.length == 1)
		return heap.pop();

	const root = heap[0],
		leaf = heap.pop();

	heap[0] = leaf;
	leaf.index = 0;

	downHeap(heap, heap[0], compareKey, min);

	return root;
}

function extractHeapNodeMin(heap, compareKey = DEFAULT_COMPARE_KEY) {
	return extractHeapNode(heap, compareKey, true);
}

function extractHeapNodeMax(heap, compareKey = DEFAULT_COMPARE_KEY) {
	return extractHeapNode(heap, compareKey, false);
}

// Checking
function isValidHeap(heap, compareKey, min) {
	for (let i = 1, l = heap.length; i < l; i++) {
		const node = heap[i],
			parentNode = heap[(i - 1) >> 1];

		if (isValid(node[compareKey], parentNode[compareKey], min))
			return false;
	}

	return true;
}

function isValidHeapMin(heap, compareKey = DEFAULT_COMPARE_KEY) {
	return isValidHeap(heap, compareKey, true);
}

function isValidHeapMax(heap, compareKey = DEFAULT_COMPARE_KEY) {
	return isValidHeap(heap, compareKey, false);
}

function isValid(a, b, min) {
	if (a == b)
		return true;

	return (a < b) == min;
}

export {
	upHeapMin,
	upHeapMax,
	downHeapMin,
	downHeapMax,
	bubbleHeapMin,
	bubbleHeapMax,
	mkHeapNode,
	addHeapNode,
	insertHeapNodeMin,
	insertHeapNodeMax,
	updateHeapNodeMin,
	updateHeapNodeMax,
	extractHeapNodeMin,
	extractHeapNodeMax,
	isValidHeapMin,
	isValidHeapMax
};