const {
	abs,
	acos,
	asin,
	atan,
	atan2,
	ceil,
	cos,
	exp,
	floor,
	log,
	max,
	min,
	pow,
	random,
	sin,
	sqrt,
	tan,
	LN2,
	LOG2E,
	LOG10E
} = Math;

const m = Math;

// The following polyfills are from MDN
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math#Browser_compatibility
const acosh = m.acosh || (n => log(n + sqrt(n * n - 1)));
const asinh = m.asinh || (n => n == -Infinity ? n : log(n + sqrt(n * n + 1)));
const atanh = m.atanh || (n => log((1 + n) / (1 - n)) / 2);
const cbrt = m.cbrt || (n => n < 0 ? -pow(-n, 1 / 3) : pow(n, 1 / 3));

const clz32 = m.clz32 || (n => {
	const uint = n >>> 0;
	return uint ? 31 - (log(uint) / LN2 | 0) | 0 : 32;
});

const cosh = m.cosh || (n => {
	const ex = exp(n);
	return (ex + 1 / ex) / 2;
});

const expm1 = m.expm1 || (n => exp(n) - 1);

const fround = m.fround || (n => {
	n = +n;

	if (!n)
		return n;

	const sgn = n < 0 ? -1 : 1;
	n *= sgn;

	const exp = floor(log(n) / LN2),
		pexp = pow(2, max(-126, min(exp, 127))),
		leading = exp < -127 ? 0 : 1,
		mantissa = round((leading - n / pexp) * 0x800000);

	return mantissa <= -0x800000 ?
		sgn * Infinity :
		sgn * pexp * (leading - mantissa / 0x800000);
});

const hypot = m.hypot || ((...terms) => {
	let i = terms.length,
		tot = 0;

	while (i--) tot += terms[i] * terms[i];
	return sqrt(tot);
});

const imul = m.imul || ((n, n2) => {
	n2 |= 0;
	return (((n & 0x003fffff) * n2) | 0) + (n & 0xffc00000 ? (n & 0xffc00000) * n2 | 0 : 0);
});

const log1p = m.log1p || (n => log(n + 1));
const log2 = m.log2 || (n => log(n) * LOG2E);
const log10 = m.log10 || (n => log(n) * LOG10E);
const sign = m.sign || (n => ((n > 0) - (n < 0)) || +n);

const sinh = m.sinh || (n => {
	const ex = exp(n);
	return (ex - 1 / ex) / 2;
});

const tanh = m.tanh || (n => {
	const exa = exp(+n),
		exb = exp(-n);

	return exa == Infinity ?
		1 :
		(exb == Infinity ? -1 : (exa - exb) / (exa + exb));
});

const trunc = m.trunc || (n => n < 0 ? ceil(n) : floor(n));

export {
	abs,
	acos,
	acosh,
	asin,
	asinh,
	atan,
	atanh,
	atan2,
	ceil,
	cbrt,
	expm1,
	clz32,
	cos,
	cosh,
	exp,
	floor,
	fround,
	hypot,
	imul,
	log,
	log1p,
	log2,
	log10,
	max,
	min,
	pow,
	random,
	sign,
	sin,
	sinh,
	sqrt,
	tan,
	tanh,
	trunc
};