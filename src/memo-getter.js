export default class MemoGetter {
	constructor(target = null, key = null) {
		this.resolve(target, key);
	}

	resolve(target, key) {
		this.target = target;
		this.key = key;
		this.item = target && target[key];
		return this;
	}

	memoize(memoizer, force) {
		if (this.item !== undefined && force !== true)
			return this.item;

		if (!this.target)
			return console.error("Cannot memoize: target doesn't exist.");

		const memoized = typeof memoizer == "function" ?
			memoizer(this.target, this.key) :
			memoizer;

		this.target[this.key] = memoized;
		return memoized;
	}
}