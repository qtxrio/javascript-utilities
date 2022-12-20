import {
	insertHeapNodeMin,
	updateHeapNodeMin,
	extractHeapNodeMin
} from "./binary-heap";
import {
	isObject,
	isArrayLike
} from "./is";
import {
	atomizeStr,
	codePointAt
} from "./string";
import { log2 } from "./math";
import { assign } from "./object";
import hasOwn from "./has-own";

// ====== Coders ======
const huffman = {};

huffman.encode = (str, encoding = "ascii") => {
	const charHeap = [],
		nodeMap = {},
		nodes = [],
		encoder = mkEncoder(encoding);

	if (!str) {
		return {
			code: encoder.extract(),
			key: ""
		};
	}

	for (let i = 0, l = str.length; i < l; i++) {
		const codePoint = codePointAt(str, i);

		if (hasOwn(nodeMap, codePoint)) {
			const node = nodeMap[codePoint];
			updateHeapNodeMin(charHeap, node, node.value + 1);
			nodes.push(node);
		} else {
			const node = insertHeapNodeMin(charHeap, 1)();
			node.char = codePoint >= 0xffff ?
				str[i] + str[i + 1] :
				str[i];
			node.code = [];
			node.children = [];
			nodeMap[codePoint] = node;
			nodes.push(node);
		}

		if (codePoint >= 0xffff)
			i++;
	}

	const uniques = charHeap.length;

	while (charHeap.length > 1) {
		const l = extractHeapNodeMin(charHeap),
			r = extractHeapNodeMin(charHeap);

		const node = insertHeapNodeMin(charHeap, l.value + r.value)();
		node.children = [l, r];
	}

	let key = "";

	const extract = (node, code) => {
		if (!node.children.length) {
			node.code = code;

			if (uniques <= 2)
				key += node.char;
			else if (node.char == "\\")
				key += "\\\\";
			else if (node.char == "*")
				key += "\\*";
			else
				key += node.char;
		} else {
			if (uniques > 2 && code.length)
				key += "*";

			for (let i = 0; i < 2; i++) {
				const newCode = code.slice();
				newCode.push(i);
				extract(node.children[i], newCode);
			}
		}
	};

	extract(charHeap[0], []);

	for (let i = 0, l = nodes.length; i < l; i++)
		encoder.put(nodes[i].code);

	return {
		code: encoder.extract(),
		key
	};
};

huffman.encodeCompact = (str, encoding = "ascii") => {
	const encoded = huffman.encode(str, encoding);
	return `${encoded.key}::${encoded.code}`;
};

huffman.decode = (codeOrData, key, encoding) => {
	let code = codeOrData;

	if (isObject(codeOrData)) {
		encoding = key;
		code = codeOrData.code;
		key = codeOrData.key;
	}

	if (!encoding)
		encoding = "ascii";

	const map = huffman.parseKey(key),
		decoder = mkDecoder(encoding);
	let out = "",
		mapLoc = map;

	decoder.extractBitstream(code, bit => {
		mapLoc = mapLoc[bit];

		if (typeof mapLoc == "string") {
			out += mapLoc;
			mapLoc = map;
		}
	});

	return out;
};

huffman.decodeCompact = (encoded, encoding = "ascii") => {
	let key = "",
		colonRun = 0,
		code = "";

	for (let i = 0, l = encoded.length; i < l; i++) {
		const char = encoded[i];

		if (char == ":") {
			colonRun++;
		} else if (colonRun) {
			if (colonRun >= 2) {
				if (colonRun > 2)
					key += ":";

				code = encoded.substring(i);
				break;
			}

			key += (":" + char);
			colonRun = 0;
		} else
			key += char;
	}

	return huffman.decode(code, key, encoding);
};

huffman.parseKey = key => {
	const chars = atomizeStr(key);

	if (chars.length <= 2)
		return chars;

	const struct = [],
		stack = [struct];
	let target = struct;

	for (let i = 0, l = chars.length; i < l; i++) {
		const char = chars[i];

		if (char == "*") {
			const newTarget = [];
			target.push(newTarget);
			stack.push(newTarget);
			target = newTarget;
		} else {
			if (char == "\\") {
				target.push(chars[i + 1]);
				i++;
			} else
				target.push(char);

			while (target.length == 2 && target != struct) {
				stack.pop();
				target = stack[stack.length - 1] || struct;
			}
		}
	}

	return struct;
};

// ====== Encoders ======
//
// Encoder definitions:
// init (optional)
// Initializes the encoder on creation. The encoder object is passed, which it can
// modify directly, or return an object containing data to add to the encoder object
//
// put (required)
// Put data into the buffer. Data may be on any form and it is the responsibility of the
// putter method to adequately fill the buffer
//
// extract (optional)
// Extracts the data and optionally applies processing before returning the finished data
// If no extractor is supplied, the encoder object itself is returned
const ENCODERS = {
	ascii: {
		init: encoder => {
			encoder.buffer = "";
			encoder.byte = 0;
			encoder.padding = 7;
		},
		put: (encoder, data) => {
			forEachBit(data, bit => {
				encoder.padding--;

				if (bit)
					encoder.byte += POWERS[encoder.padding];

				if (!encoder.padding) {
					encoder.buffer += String.fromCharCode(encoder.byte);
					encoder.byte = 0;
					encoder.padding = 7;
				}
			});
		},
		extract: encoder => {
			if (encoder.padding != 7)
				encoder.buffer += String.fromCharCode(encoder.byte);

			return encoder.buffer + encoder.padding;
		}
	}
};

// ====== Decoders ======
//
// Meta properties:
// byteSize
// Fixed size of blocks (defaults to 8), used in extractWords
//
// blockEndianness
// Relative position of blocks not equal to byteSize in size
// "little" to align blocks with the least significant bits (big endian integers)
// "big" to align blocks with the most significant bits (big endian integers)
//
// Extractor definitions:
// extractBits (required, unless extractBitstream is defined)
// Provided data and a callback, the callback is called with each bit in the data,
// with each piece of data treated as a fixed size word, usually one octet, read in series
// To keep track of each word, a second argument must be passed representing the index
// of the current word, incrementing from 0
// If no extractor is provided by the decoder object, extractBitstream is leveraged
// to provide the required functionality
//
// extractBitstream (required, unless extractBits is defined)
// Provided data and a callback, the callback is called with each bit in the data
// Unlike extractBits, it is not certain that bits are evenly divided into bytes
// These groups of bits are called chunks. To keep track of each chunk, a second argument
// must be passed representing the index of the current chunk, incrementing from 0
// If no extractor is provided by the decoder object, extractBits is leveraged to provide
// the required functionality
//
// extractWords (optional)
// Provided data, a word size, and a callback, the callback is called
// with each extracted word, including incomplete terminator words, in the data
// All bits in the word are extracted, including leading zeroes of any word
// To keep track of each word, a second argument is passed representing the index of the current word
// If no extractor is provided by the decoder object, either extractBits or extractBitstream is leveraged
// The internal byteSize value (defaults to 8) ensures that data is properly extracted, should blocks
// of the wrong length be found
//
// extractBytes (optional)
// Provided data and a callback, the callback is called with each byte,
// including incomplete teminator bytes, in the data. All bits in the word are extracted
// To keep track of each byte, a second argument is passed representing the index of the current byte
// If no extractor is provided by the decoder object, extractWords is leveraged,
// with the wordSize set to 8. The bytes extracted with this extractor are always octets
const DECODERS = {
	ascii: {
		byteSize: 8,
		blockEndianness: "little",
		extractBitstream: (decoder, data, callback) => {
			const padding = Number(data[data.length - 1]);

			for (let i = 0, l = data.length - 1; i < l; i++) {
				if (i == l - 1 && padding != 7) {
					if (data[i] == "\0") {
						for (let j = 7 - padding - 1; j >= 0; j--)
							callback(0, j);
					} else {
						forEachBit(data[i], (bit, position) => {
							if (position >= padding)
								callback(bit, i);
						}, 7);
					}
				} else
					forEachBit(data[i], bit => callback(bit, i), 7);
			}
		}
	}
};

// ====== Utils ======
const LOW_BITS = Math.pow(2, 31),
	HIGH_BITS = Math.pow(2, 62);

const POWERS = Array(64)
	.fill(0)
	.map((_, i) => Math.pow(2, i));

function forEachBit(data, callback, wordSize = null) {
	forEachBitHelper(data, callback, wordSize, 0);
}

function forEachBitHelper(data, callback, wordSize, idx) {
	if (typeof data == "number")
		forEachBitNum(data, callback, wordSize, idx, 0);
	else if (typeof data == "string") {
		for (let i = 0, l = data.length; i < l; i++) {
			const codePoint = codePointAt(data, i);
			forEachBitNum(codePoint, callback, wordSize, idx + i, 0);

			if (codePoint >= 0xffff)
				i++;
		}
	} else if (isArrayLike(data)) {
		for (let i = 0, l = data.length; i < l; i++)
			forEachBitHelper(data[i], callback, wordSize, idx + 1);
	}
}

function forEachBitNum(num, callback, wordSize, idx, offset) {
	if (num >= LOW_BITS && !wordSize || wordSize > 31) {
		if (num >= HIGH_BITS && !wordSize || wordSize > 62) {
			const highest = ~~(num / HIGH_BITS);
			num %= HIGH_BITS;
	
			if (wordSize)
				forEachBitNum(highest, callback, wordSize - 62, idx, 62);
			else
				forEachBitNum(highest, callback, null, idx, 62);
		}

		const high = ~~(num / LOW_BITS);

		if (wordSize)
			forEachBitNum(high, callback, wordSize - 31, idx, 31);
		else
			forEachBitNum(high, callback, null, idx, 31);
	}

	if (wordSize) {
		for (let i = Math.min(wordSize - 1, 30); i >= 0; i--) {
			if (num & POWERS[i])
				callback(1, offset + i, idx);
			else
				callback(0, offset + i, idx);
		}
	} else {
		for (let i = ~~Math.min(log2(num), 30); i >= 0; i--) {
			if (num & POWERS[i])
				callback(1, offset + i, idx);
			else
				callback(0, offset + i, idx);
		}
	}
}

function mkEncoder(nameOrConfig, ...initArgs) {
	let config;

	if (typeof nameOrConfig == "string") {
		if (!hasOwn(ENCODERS, nameOrConfig))
			throw new Error(`Cannot make encoder: no encoder known by name '${nameOrConfig}'`);

		config = ENCODERS[nameOrConfig];
	} else if (typeof nameOrConfig == "function")
		config = { put: nameOrConfig };
	else if (isObject(nameOrConfig))
		config = nameOrConfig;
	else
		throw new Error(`Cannot make encoder: input must be a encoder name, putter, or config`);

	if (typeof config.put != "function")
		throw new Error(`Cannot make encoder: no put method provided`);

	const encoder = {
		put: data => {
			config.put(encoder, data);
			return encoder;
		},
		extract: typeof config.extract == "function" ?
			_ => config.extract(encoder) :
			_ => encoder
	};

	if (typeof config.init == "function") {
		const data = config.init(encoder, ...initArgs);

		if (isObject(data))
			assign(encoder, data);
	}

	return encoder;
}

function mkDecoder(nameOrConfig, ...initArgs) {
	let config;

	if (typeof nameOrConfig == "string") {
		if (!hasOwn(DECODERS, nameOrConfig))
			throw new Error(`Cannot make decoder: no decoder known by name '${nameOrConfig}'`);

		config = DECODERS[nameOrConfig];
	} else if (typeof nameOrConfig == "function")
		config = { extract: nameOrConfig };
	else if (isObject(nameOrConfig))
		config = nameOrConfig;
	else
		throw new Error(`Cannot make decoder: input must be a decoder name, putter, or config`);

	if (typeof config.extractBits != "function" && typeof config.extractBitstream != "function")
		throw new Error(`Cannot make decoder: no extractBits or extractBitstream method provided`);

	const extractBits = mkBitsExtractor(config),
		extractBitstream = mkBitstreamExtractor(config),
		extractWords = typeof config.extractWords == "function" ?
			config.extractWords :
			mkWordExtractor(config),
		extractBytes = typeof config.extractBytes == "function" ?
			config.extractBytes :
			(dsrz, data, callback) => extractWords(dsrz, data, 8, callback);

	const decoder = {
		extractBits: (data, callback) => extractBits(decoder, data, callback),
		extractBitstream: (data, callback) => extractBitstream(decoder, data, callback),
		extractWords: (data, wordSize, callback) => extractWords(decoder, data, wordSize, callback),
		extractBytes: (data, callback) => extractBytes(decoder, data, callback)
	};

	if (typeof config.init == "function") {
		const data = config.init(decoder, ...initArgs);

		if (isObject(data))
			assign(decoder, data);
	}

	return decoder;
}

function mkBitsExtractor(config) {
	if (config.extractBits)
		return config.extractBits;

	const extractBitstream = config.extractBitstream,
		byteSize = config.byteSize || 8,
		buffer = [];

	const emptyBuffer = (callback, index) => {
		if (!buffer.length)
			return;

		if (config.blockEndianness != "big") {
			for (let i = buffer.length; i < byteSize; i++)
				callback(0, index);
		}

		for (let i = 0, l = buffer.length; i < l; i++)
			callback(buffer[i], index);

		if (config.blockEndianness == "big") {
			for (let i = buffer.length; i < byteSize; i++)
				callback(0, index);
		}

		buffer.length = 0;
	};

	return (dsrz, data, callback) => {
		let index = 0;

		buffer.length = 0;

		extractBitstream(dsrz, data, (bit, idx) => {
			if (idx != index) {
				emptyBuffer(callback, index);
				index = idx;
			}

			buffer.push(bit);
		});

		emptyBuffer(callback, index);
	};
}

function mkBitstreamExtractor(config) {
	if (config.extractBitstream)
		return config.extractBitstream;

	const extractBits = config.extractBits;

	return (dsrz, data, callback) => {
		let initialized = false,
			ran = false,
			index = 0;

		extractBits(dsrz, data, (bit, idx) => {
			if (idx != index) {
				if (!initialized)
					callback(0, index);

				initialized = false;
				index = idx;
			}

			if (initialized)
				callback(bit, idx);
			else if (bit) {
				callback(bit, idx);
				initialized = true;
			}

			ran = true;
		});

		if (!initialized && ran)
			callback(0, index);
	};
}

function mkWordExtractor(config) {
	if (typeof config.extractBits == "function")
		return mkBitwiseWordExtractor(config);
	
	return mkBitstreamWordExtractor(config);
}

function mkBitwiseWordExtractor(config) {
	const extractBits = config.extractBits;

	return (dsrz, data, wordSize, callback) => {
		let word = 0,
			count = 0,
			position = wordSize;

		extractBits(dsrz, data, bit => {
			position--;

			if (bit)
				word += POWERS[position];

			if (position < 0) {
				callback(word, count);
				word = 0;
				count++;
				position = wordSize;
			}
		});

		if (position != wordSize) {
			if (config.blockEndianness == "big")
				callback(word, count);
			else if (word > LOW_BITS)
				callback(word >> position, count);
			else
				callback(word / POWERS[position]);
		}
	};
}

function mkBitstreamWordExtractor(config) {
	const extractBitstream = config.extractBitstream,
		byteSize = config.byteSize || 8;

	return (dsrz, data, wordSize, callback) => {
		let word = 0,
			count = 0,
			consumed = 0,
			index = 0,
			position = wordSize;

		extractBitstream(dsrz, data, (bit, idx) => {
			if (idx != index) {
				if (consumed < byteSize) {
					const shift = config.blockEndianness == "big" ?
						0 :
						byteSize - consumed;

					if (word < LOW_BITS)
						word >>= shift;
					else
						word /= POWERS[shift];

					callback(word, count);
					word = 0;
					count++;
					position = wordSize;
				}

				consumed = 0;
				index = idx;
			}

			position--;
			consumed++;

			if (bit)
				word += POWERS[position];

			if (position < 0) {
				callback(word, count);
				word = 0;
				count++;
				position = wordSize;
			}
		});

		if (consumed < byteSize) {
			if (config.blockEndianness == "big")
				callback(word, count);
			else if (word > LOW_BITS)
				callback(word >> (byteSize - consumed), count);
			else
				callback(word / POWERS[byteSize - consumed], count);
		}
	};
}

export {
	huffman,
	forEachBit,
	mkEncoder,
	mkDecoder
};