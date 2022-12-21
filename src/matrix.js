import { padEnd } from "./string";
import { assign } from "./object";
import hasOwn from "./has-own";
import { round } from "./number";

const ROUNDERS = {
	standard: {
		identity: value => value,
		basic: value => {
			const tolerance = matrix.internal.tolerance,
				rounded = round(value, matrix.internal.precision + matrix.internal.precisionBuffer);
		
			if (rounded > -tolerance && rounded < tolerance)
				return 0;
		
			return rounded;
		},
		snap: value => {
			const rounded = (Math.round(value * matrix.internal.pow) / matrix.internal.pow) || 0,
				int = Math.round(rounded),
				diff = rounded - int;
		
			if (diff > -matrix.internal.tolerance && diff < matrix.internal.tolerance)
				return int;
		
			return rounded;
		}
	},
	fast: {
		identity: value => value,
		basic: value => {
			return (Math.round(value * matrix.internal.fPow) / matrix.internal.fPow) || 0;
		}
	}
};

const matrix = {
	config: {
		// Medium fast, good precision (infrequent rounding)
		rounding: {
			get precision() {
				return matrix.internal.precision;
			},
			set precision(value) {
				matrix.internal.precision = value;
				updateInternals();
			},
			// Buffer to add to precision to provide some
			// cross-operation precision to be preserved 
			get precisionBuffer() {
				return matrix.internal.precisionBuffer;
			},
			set precisionBuffer(value) {
				matrix.internal.precisionBuffer = value;
				updateInternals();
			},
			get rounder() {
				return matrix.internal.rounder;
			},
			set rounder(value) {
				matrix.internal.rounder = value;
				updateInternals();
			}
		},
		// Fast rounding, basic precision (frequent rounding)
		fastRounding: {
			get precision() {
				return matrix.internal.fPrecision;
			},
			set precision(value) {
				matrix.internal.fPrecision = value;
				updateInternals();
			},
			get rounder() {
				return matrix.internal.fRounder;
			},
			set rounder(value) {
				matrix.internal.fRounder = value;
				updateInternals();
			}
		}
	},
	internal: {
		// precision
		precision: 10,
		tolerance: 1e-10,
		precisionBuffer: 2,
		pow: 1e12,
		rounder: "snap",
		// fPrecision
		fPrecision: null,
		fPow: null,
		fRounder: "identity",
		// Rounders
		round: ROUNDERS.standard.snap,
		roundEach: mx => {
			if (matrix.internal.precision == null)
				return mx;

			const [m, n] = matrix.dimensions(mx),
				rd = matrix.internal.round;

			for (let i = 0; i < m; i++) {
				for (let j = 0; j < n; j++)
					mx[i][j] = rd(mx[i][j]);
			}

			return mx;
		},
		fRound: ROUNDERS.fast.identity
	}
};

matrix.codegen = {
	multiply: prepopulate([5, 5, 5, 5, 1])
};

// Matrix generators
matrix.identity = n => {
	const mx = [];

	for (let i = 0; i < n; i++) {
		const row = [];

		for (let j = 0; j < n; j++)
			row.push(Number(i == j));

		mx.push(row);
	}

	return mx;
};

matrix.fill = (m, n = m, value = 0) => {
	const mx = [];

	for (let i = 0; i < m; i++) {
		const row = [];

		for (let j = 0; j < n; j++)
			row.push(value);

		mx.push(row);
	}

	return mx;
};

matrix.null = (m, n = m) => {
	return matrix.fill(m, n, 0);
};

matrix.clone = mx => {
	const cloned = [];

	for (let i = 0, m = mx.length; i < m; i++)
		cloned.push(mx[i].slice());

	return cloned;
};

// Make new matrix from data
// Intended to be highly flexible. If provided with a shallow array,
// it will fill out the matrix with the individual elements based on the width
// specified in the options. If no width is provided, the result will be equal
// to a row vector inserted as the first row of the returned matrix.
// If an array contains both shallow values and arrays, consecutive primitives
// will be inserted into their own rows, and similarly, individual arrays will
// be inserted as their own rows.
// If either the width or height (if specified) is larger than the size of the
// normalized input data, padding will be added to fill the matrix out to the
// specified dimensions.
// Similarly, if the either the width or height is smaller than the normalized
// input data, clipping will be done on the data.
// This implementation is highly nested primarily to optimize performance
matrix.make = (data, options = {}, clone = true) => {
	if (typeof data == "number") {
		if (options.resolve == "function")
			data = [[options.resolve(data, 0, 0, data)]];
		else
			data = [[data || 0]];
	} else if (!Array.isArray(data)) {
		clone = options;
		options = data;
		data = [];
	}

	if (typeof options.clone == "boolean")
		clone = options.clone;

	const w = typeof options.width == "number" ?
			options.width || 0 :
			null,
		h = typeof options.height == "number" ?
			options.height || 0 :
			null,
		resolve = typeof options.resolve == "function" ?
			options.resolve :
			null,
		fill = hasOwn(options, "fill") ?
			options.fill :
			0,
		out = [];
	let maxWidth = -1,
		applyFill = false;

	if (matrix.isStrictMatrix(data)) {
		for (let i = 0, m = data.length; i < m; i++) {
			const item = data[i];
			let row = clone ? [] : item;

			if (Array.isArray(item)) {
				const n = w === null ?
					item.length :
					Math.min(item.length, w);

				if (clone) {
					for (let j = 0; j < n; j++) {
						if (resolve)
							row.push(resolve(item[j], i, j, data));
						else
							row.push(item[j]);
					}
				} else if (resolve) {
					for (let j = 0; j < n; j++)
						row[j] = resolve(item[j], i, j, data);
				}
			} else if (resolve)
				row = [resolve(item, i, 0, data)];
			else
				row = [item];

			if (w !== null && row.length >= w)
				row.length = w;

			const l = row.length;

			if (maxWidth == -1)
				maxWidth = l;
			else if (l != maxWidth) {
				if (l > maxWidth)
					maxWidth = l;
				applyFill = true;
			}

			out.push(row);

			if (h !== null && i == h - 1)
				break;
		}
	} else {
		let i = 0,
			j = 0,
			row = null,
			finishedRow = false;

		for (let a = 0, l = data.length; a < l; a++) {
			const item = data[a];

			if (Array.isArray(item)) {
				const n = w === null ?
					item.length :
					Math.min(item.length, w);

				if (row && row.length) {
					out.push(row);
					i++;
				}

				row = clone ? [] : item;

				if (clone) {
					for (let b = 0; b < n; b++) {
						if (resolve)
							row.push(resolve(item[b], i, b, data));
						else
							row.push(item[b]);
					}
				} else if (resolve) {
					for (let b = 0; b < n; b++)
						row[b] = resolve(item[b], i, b, data);
				}

				finishedRow = true;
			} else {
				if (j == 0)
					row = [];

				if (resolve)
					row[j] = resolve(item, i, j, data);
				else
					row[j] = item;

				j++;
			}

			if (finishedRow || (w !== null && row.length == w) || a == l - 1) {
				const l = row.length;

				if (maxWidth == -1)
					maxWidth = l;
				else if (l != maxWidth) {
					if (l > maxWidth)
						maxWidth = l;
					applyFill = true;
				}

				i++;
				j = 0;
				out.push(row);
				row = null;
				finishedRow = false;

				if (h !== null && i == h)
					break;
			}
		}
	}

	const fullWidth = w == null ?
		maxWidth :
		w;

	if (h !== null && out.length < h) {
		for (let i = out.length; i < h; i++) {
			const row = [];

			for (let j = 0; j < fullWidth; j++) {
				if (resolve)
					row.push(resolve(undefined, i, j, data));
				else {
					if (typeof fill == "number")
						row.push(fill);
					else if (fill == "identity" && i == j)
						row.push(1);
					else
						row.push(0);
				}
			}
			
			out.push(row);
		}
	}

	if (applyFill || fullWidth > maxWidth) {
		for (let i = 0, m = out.length; i < m; i++) {
			for (let j = out[i].length; j < fullWidth; j++) {
				if (resolve)
					out[i].push(resolve(undefined, i, j, data));
				else {
					if (typeof fill == "number")
						out[i].push(fill);
					else if (fill == "identity" && i == j)
						out[i].push(1);
					else
						out[i].push(0);
				}
			}
		}
	}

	return out;
};

// Matrix generators cont.: affine 2D transforms
matrix.two = {};

matrix.two.scale = (mx, xc, yc) => {
	return resolveTransform(mx, xc, yc, (x = 1, y = x) => [
		[x, 0, 0],
		[0, y, 0],
		[0, 0, 1]
	]);
};

matrix.two.scaleX = (mx, xc) => {
	return resolveTransform(mx, xc, (x = 1) => [
		[x, 0, 0],
		[0, 1, 0],
		[0, 0, 1]
	]);
};

matrix.two.scaleY = (mx, yc) => {
	return resolveTransform(mx, yc, (y = 1) => [
		[1, 0, 0],
		[0, y, 0],
		[0, 0, 1]
	]);
};

matrix.two.rotate = (mx, th) => {
	return resolveTransform(mx, th, (t = 0) => [
		[Math.cos(t), Math.sin(t), 0],
		[-Math.sin(t), Math.cos(t), 0],
		[0, 0, 1]
	]);
};

matrix.two.shear = (mx, shx, shy) => {
	return resolveTransform(mx, shx, shy, (sx = 0, sy = sx) => [
		[1, sx, 0],
		[sy, 1, 0],
		[0, 0, 1]
	]);
};

matrix.two.shearX = (mx, sh) => {
	return resolveTransform(mx, sh, (s = 0) => [
		[1, s, 0],
		[0, 1, 0],
		[0, 0, 1]
	]);
};

matrix.two.shearY = (mx, sh) => {
	return resolveTransform(mx, sh, (s = 0) => [
		[1, 0, 0],
		[s, 1, 0],
		[0, 0, 1]
	]);
};

matrix.two.translate = (mx, dx, dy) => {
	return resolveTransform(mx, dx, dy, (x = 0, y = x) => [
		[1, 0, x],
		[0, 1, y],
		[0, 0, 1]
	]);
};

matrix.two.translateX = (mx, dx) => {
	return resolveTransform(mx, dx, (x = 0) => [
		[1, 0, x],
		[0, 1, 0],
		[0, 0, 1]
	]);
};

matrix.two.translateY = (mx, dy) => {
	return resolveTransform(mx, dy, (y = 0) => [
		[1, 0, 0],
		[0, 1, y],
		[0, 0, 1]
	]);
};

// Matrix generators cont.: 3D transforms
matrix.three = {};

matrix.three.scaleX = (mx = null, c = 1) => {

};

matrix.three.scaleY = (mx = null, c = 1) => {

};

matrix.three.scaleZ = (mx = null, c = 1) => {

};

function resolveTransform(mx, ...args) {
	const builder = args.pop();

	if (typeof mx == "number") {
		for (let i = args.length - 1; i >= 0; i--)
			args[i + 1] = args[i];
		args[0] = mx;
		mx = null;
	}

	const out = builder(...args);
	if (!mx)
		return out;

	return matrix.multiply(mx, out);
}

// Elementary matrix operations
matrix.swap = (mx, m, m2) => {
	const tmpRow = mx[m];
	mx[m] = mx[m2];
	mx[m2] = tmpRow;
	return mx;
};

matrix.map = (mx, callback, clone = true) => {
	const [m, n] = matrix.dimensions(mx),
		out = clone ? [] : mx;

	for (let i = 0; i < m; i++) {
		if (clone) {
			const row = [];

			for (let j = 0; j < n; j++)
				row.push(callback(mx[i][j], i, j, mx));

			out.push(row);
		} else {
			for (let j = 0; j < n; j++)
				mx[i][j] = callback(mx[i][j], i, j, mx);
		}
	}

	return out;
};

matrix.round = (mx, precision = 2, clone = true) => {
	const pow = Math.pow(10, precision);

	return matrix.map(mx, value => {
		return Math.round(value * pow) / pow || 0;
	}, clone);
};

// Simple matrix operations
matrix.add = (mx, mx2) => {
	if (typeof mx == "number" || typeof mx2 == "number")
		return matrix.addScalar(mx, mx2);

	const [m, n] = matrix.dimensions(mx),
		[m2, n2] = matrix.dimensions(mx2);

	if (m != m2 || n != n2)
		return null;

	const out = [],
		rd = matrix.internal.round;

	for (let i = 0; i < m; i++) {
		const row = [];

		for (let j = 0; j < n; j++) {
			row.push(
				rd(mx[i][j] + mx2[i][j])
			);
		}

		out.push(row);
	}

	return out;
};

matrix.addScalar = (mx, scalar) => {
	return scalarOperation(mx, scalar, (e, s) => e + s);
};

matrix.subtract = (mx, mx2) => {
	if (typeof mx == "number" || typeof mx2 == "number")
		return matrix.subtractScalar(mx, mx2);

	const [m, n] = matrix.dimensions(mx),
		[m2, n2] = matrix.dimensions(mx2);

	if (m != m2 || n != n2)
		return null;

	const out = [],
		rd = matrix.internal.round;

	for (let i = 0; i < m; i++) {
		const row = [];

		for (let j = 0; j < n; j++) {
			row.push(
				rd(mx[i][j] - mx2[i][j])
			);
		}

		out.push(row);
	}

	return out;
};

matrix.subtractScalar = (mx, scalar) => {
	return scalarOperation(mx, scalar, (e, s) => e - s);
};

matrix.multiply = (mx, mx2) => {
	if (typeof mx == "number" || typeof mx2 == "number")
		return matrix.multiplyScalar(mx, mx2);

	const [m, n] = matrix.dimensions(mx),
		[m2, n2] = matrix.dimensions(mx2);

	if (n != m2)
		return null;

	if (m <= 5 && n <= 5 && m2 <= 5 && n2 <= 5) {
		const r = Number(matrix.internal.fPrecision != null);

		let gen = matrix.codegen.multiply[m][n][m2][n2][r];
		if (gen)
			return gen(mx, mx2);

		gen = codegenMul(m, n, m2, n2, r);
		matrix.codegen.multiply[m][n][m2][n2][r] = gen;
		return gen(mx, mx2);
	}

	const out = [],
		frd = matrix.internal.fRound;

	for (let i = 0; i < m; i++) {
		const row = [];

		for (let j2 = 0; j2 < n2; j2++) {
			let sum = 0;

			for (var j = 0; j < n; j++)
				sum += frd(mx[i][j] * mx2[j][j2]);

			row.push(sum);
		}

		out.push(row);
	}

	return out;
};

matrix.multiplyScalar = (mx, scalar) => {
	return scalarOperation(mx, scalar, (e, s) => e * s);
};

function scalarOperation(mx, scalar, callback) {
	if (typeof mx == "number" && scalar == "number")
		return matrix.internal.round(mx * scalar);

	if (typeof mx == "number") {
		const tmpScalar = mx;
		mx = scalar;
		scalar = tmpScalar;
	}

	const rd = matrix.internal.round;
	return matrix.map(mx, e => rd(callback(e, scalar)), true);
}

// Non-trivial matrix operations
matrix.ref = (mx, clone = true, detailed = false) => {
	if (clone)
		mx = matrix.clone(mx);

	const [m, n] = matrix.dimensions(mx),
		rd = matrix.internal.round;
	let pr = 0,
		pc = 0,
		detC = 1;

	while (pr < m && pc < n) {
		const pivot = matrix.pivot(mx, pr, pc);

		if (mx[pivot, pc] == 0)
			pc++;
		else {
			if (pivot != pr) {
				matrix.swap(mx, pivot, pr);
				detC *= -1;
			}

			if (mx[pr][pc] == 0) {
				pr++;
				pc++;
				detC = 0;
				continue;
			}

			for (let i = pr + 1; i < m; i++) {
				const q = mx[i][pc] / mx[pr][pc];
				mx[i][pc] = 0;

				for (let j = pc + 1; j < n; j++)
					mx[i][j] = rd(mx[i][j] - mx[pr][j] * q);
			}

			pr++;
			pc++;
		}
	}

	if (!detailed)
		return mx;

	return {
		matrix: mx,
		detC
	};
};

matrix.rref = (mx, aug, clone = true, detailed = false) => {
	if (clone)
		mx = matrix.clone(mx);
	aug = matrix.column.make(aug, clone);

	const [m, n] = matrix.dimensions(mx),
		[m2, n2] = matrix.dimensions(aug);

	if (m != n || m2 != m) {
		if (!detailed)
			return null;
		
		return {
			matrix: mx,
			augmented: null,
			invertible: false
		};
	}

	let invertible = true;

	for (let i = 0; i < m; i++) {
		if (mx[i][i] == 0) {
			let swapped = false;

			for (let i2 = i + 1; i2 < m; i2++) {
				if (mx[i2][i] == 0)
					continue;

				matrix.swap(mx, i, i2);
				matrix.swap(aug, i, i2);
				swapped = true;
				break;
			}

			if (!swapped) {
				invertible = false;
				break;
			}
		}

		const c = 1 / mx[i][i];
		for (let j = 0; j < n; j++)
			mx[i][j] *= c;
		for (let j = 0; j < n2; j++)
			aug[i][j] *= c;

		for (let i2 = 0; i2 < m; i2++) {
			if (i2 == i)
				continue;

			const d = mx[i2][i];
			for (let j = i; j < n; j++)
				mx[i2][j] -= mx[i][j] * d;
			for (let j = 0; j < n2; j++)
				aug[i2][j] -= aug[i][j] * d;
		}
	}

	if (detailed)
		matrix.internal.roundEach(mx);
	matrix.internal.roundEach(aug);

	if (!detailed)
		return invertible ? aug : null;

	return {
		matrix: mx,
		augmented: invertible ? aug : null,
		invertible
	};
};

matrix.invert = (mx, clone = true, detailed = false) => {
	if (!matrix.isSquare(mx))
		return null;

	if (clone)
		mx = matrix.clone(mx);

	return matrix.rref(
		mx,
		matrix.identity(mx.length),
		false,
		detailed
	);
};

matrix.transpose = mx => {
	const [m, n] = matrix.dimensions(mx),
		out = [];

	for (let j = 0; j < n; j++) {
		const row = [];

		for (let i = 0; i < m; i++)
			row.push(mx[i][j]);

		out.push(row);
	}

	return out;
};

// Reducing operators
matrix.isSquare = mx => {
	return Boolean(mx) && mx.length > 0 && mx.length == mx[0].length;
};

matrix.isMatrix = candidate => {
	return Array.isArray(candidate) && Array.isArray(candidate[0]);
};

matrix.equals = (mx, mx2) => {
	if (mx == mx2)
		return true;

	const [m, n] = matrix.dimensions(mx),
		[m2, n2] = matrix.dimensions(mx2);

	if (m != m2 || n != n2)
		return false;

	for (let i = 0; i < m; i++) {
		for (let j = 0; j < n; j++) {
			if (mx[i][j] != mx2[i][j])
				return false;
		}
	}

	return true;
};

matrix.isStrictMatrix = candidate => {
	if (!Array.isArray(candidate))
		return false;

	for (let i = 0, l = candidate.length; i < l; i++) {
		if (!Array.isArray(candidate[i]))
			return false;
	}

	return true;
};

matrix.dimensions = mx => {
	if (!mx || !mx.length)
		return [0, 0];

	if (!mx[0] || typeof mx[0].length != "number")
		return [1, mx.length];

	return [mx.length, mx[0].length];
};

matrix.pivot = (mx, pr, pc) => {
	const [m, n] = matrix.dimensions(mx);
	let idx = pr,
		max = Math.abs(mx[pr][pc]);

	if (pc >= n)
		return idx;

	for (let i = pr + 1; i < m; i++) {
		const c = Math.abs(mx[i][pc]);

		if (c > max) {
			idx = i;
			max = c;
		}
	}

	return idx;
};

matrix.det = mx => {
	if (!matrix.isSquare(mx))
		return 0;

	switch (mx.length) {
		case 2:
			return matrix.internal.round(mx[0][0] * mx[1][1]) - (mx[0][1] * mx[1][0]);

		case 3:
			return matrix.internal.round(
				(mx[0][0] * mx[1][1] * mx[2][2]) +
				(mx[0][1] * mx[1][2] * mx[2][0]) +
				(mx[0][2] * mx[1][0] * mx[2][1]) -
				(mx[0][2] * mx[1][1] * mx[2][0]) -
				(mx[0][1] * mx[1][0] * mx[2][2]) -
				(mx[0][0] * mx[1][2] * mx[2][1])
			);
	}

	const eliminated = matrix.ref(mx, true, true);
	if (!eliminated.detC)
		return 0;

	return matrix.internal.round(
		matrix.mulTrace(eliminated.matrix) * eliminated.detC
	);
};

matrix.trace = mx => {
	if (!matrix.isSquare(mx))
		return 0;

	let sum = 0;

	for (let i = 0, m = mx.length; i < m; i++)
		sum += mx[i][i];

	return matrix.internal.round(sum);
};

matrix.mulTrace = mx => {
	if (!matrix.isSquare(mx))
		return 0;

	let product = 1;

	for (let i = 0, m = mx.length; i < m; i++) {
		if (mx[i][i] == 0)
			return 0;

		product *= mx[i][i];
	}

	return matrix.internal.round(product);
};

// Row operations
matrix.row = {};

// Convert input into one or many rows
// If given a singular numerical value, a 1x1 matrix is returned
// If given a shallow array, it's treated as a row vector and put cloned into a singular row, with type checking
// If given a matrix array, it's returned as-is, or cloned
// Else, returns an empty matrix
matrix.row.make = (data, clone = true) => {
	if (!Array.isArray(data)) {
		if (typeof data != "number")
			return [];

		return [[data || 0]];
	}

	if (!data.length)
		return [];

	if (Array.isArray(data[0])) {
		if (clone)
			return matrix.clone(data);

		return data;
	}

	const row = [];
	for (let i = 0, m = data.length; i < m; i++) {
		if (typeof data[i] == "number")
			row.push([data[i] || 0]);
		else
			row.push([0]);
	}

	return [row];
};

matrix.row.pivot = row => {
	for (let j = 0, n = row.length; j < n; j++) {
		if (row[j] != 0)
			return j;
	}

	return 0;
};

// Column operations
matrix.column = {};

// Convert input into one or many columns
// If given a singular numerical value, a 1x1 matrix is returned
// If given a shallow array, it's treated as a column vector and split into into separate rows, with type checking
// If given a matrix array, it's returned as-is, or cloned
// Else, returns an empty matrix
matrix.column.make = (data, clone = true) => {
	if (!Array.isArray(data)) {
		if (typeof data != "number")
			return [];

		return [[data || 0]];
	}

	if (!data.length)
		return [];

	if (Array.isArray(data[0])) {
		if (clone)
			return matrix.clone(data);

		return data;
	}

	const mx = [];
	for (let i = 0, m = data.length; i < m; i++) {
		if (typeof data[i] == "number")
			mx.push([data[i] || 0]);
		else
			mx.push([0]);
	}

	return mx;
};

matrix.print = (mx, options = {}) => {
	let {
		placeholder = ".",
		pad = 1,
		resolve = null
	} = options;

	placeholder = String(placeholder);
	resolve = typeof resolve == "function" ?
		resolve :
		null;

	const opts = assign({}, options),
		maxLengths = [];

	opts.resolve = (e, i, j) => {
		if (!hasOwn(maxLengths, j))
			maxLengths[j] = 0;

		if (e === undefined && !resolve)
			e = placeholder;
		else if (resolve)
			e = String(resolve(e));
		else
			e = String(e);

		if (e.length > maxLengths[j])
			maxLengths[j] = e.length;

		return e;
	};

	const outMx = matrix.make(mx, opts);
	let out = "";

	for (let i = 0, m = outMx.length; i < m; i++) {
		const row = outMx[i];

		for (let j = 0, n = row.length; j < n; j++) {
			out += j < n - 1 ?
				padEnd(row[j], maxLengths[j] + pad) :
				row[j];
		}

		if (i < m - 1)
			out += "\n";
	}

	return out;
};

// Legacy
const printMatrix = matrix.print;

// Codegen
function prepopulate(dimensions, idx = 0) {
	if (idx == dimensions.length)
		return null;

	const node = [null],
		dimension = dimensions[idx];

	for (let i = 0; i < dimension; i++)
		node.push(prepopulate(dimensions, idx + 1));
	
	return node;
}

function codegenMul(m, n, m2, n2, performRounding = false) {
	if (n != m2)
		return _ => null;

	let code = performRounding ?
		"return function(mx, mx2) { var r = internal.fRound; return [" :
		"return [";

	const elementPrefix = performRounding ?
			"r(" :
			"",
		elementPostfix = performRounding ?
			")" :
			"";

	for (let i = 0; i < m; i++) {
		let rowCode = "[";

		for (let j2 = 0; j2 < n2; j2++) {
			let elementCode = elementPrefix;

			for (let j = 0; j < n; j++)
				elementCode += `${j ? " + " : ""}mx[${i}][${j}] * mx2[${j}][${j2}]`;

			rowCode += (j2 ? ", " : "") + elementCode + elementPostfix;
		}

		code += (i ? ", " : "") + rowCode + "]";
	}

	if (performRounding) {
		code += "]; }";
		return Function("internal", code)(matrix.internal);
	}

	code += "];";
	return Function("mx", "mx2", code);
}

// Meta / utilities
function updateInternals() {
	const precision = matrix.internal.precision,
		fPrecision = matrix.internal.fPrecision,
		buffer = matrix.internal.precisionBuffer || 0;

	if (precision == null) {
		matrix.internal.tolerance = null;
		matrix.internal.pow = null;
	} else {
		matrix.internal.tolerance = Math.pow(10, -precision);
		matrix.internal.pow = Math.pow(10, precision + buffer);
	}

	if (fPrecision == null)
		matrix.internal.fPow = null;
	else
		matrix.internal.fPow = Math.pow(10, fPrecision);

	if (precision != null && hasOwn(ROUNDERS.standard, matrix.internal.rounder))
		matrix.internal.round = ROUNDERS.standard[matrix.internal.rounder];
	else {
		if (precision != null)
			matrix.internal.rounder = "identity";
		matrix.internal.round = ROUNDERS.standard.identity;
	}

	if (fPrecision != null && hasOwn(ROUNDERS.fast, matrix.internal.fRounder))
		matrix.internal.fRound = ROUNDERS.fast[matrix.internal.fRounder];
	else {
		if (fPrecision != null)
			matrix.internal.fRounder = "identity";
		matrix.internal.fRound = ROUNDERS.fast.identity;
	}
}

export {
	matrix,
	printMatrix
};