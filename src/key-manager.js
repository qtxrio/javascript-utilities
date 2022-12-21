import MemoGetter from "./memo-getter";

export default class KeyManager {
	constructor(keyPrefix, keyPrefixSymbol) {
		this.noncePrefix = (typeof Symbol == "undefined" ? keyPrefix : (keyPrefixSymbol || keyPrefix)) + "_";
		this.nonceSeed = Math.floor(Math.random() * 1e15 + 1e15);
	}

	next() {
		const key = this.noncePrefix + (this.nonceSeed++).toString(36);
		return typeof Symbol == "undefined" ? key : Symbol.for(key);
	}

	get(target, key) {
		return new MemoGetter(target, key);
	}
}