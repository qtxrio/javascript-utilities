import {
	composeOptionsTemplates,
	createOptionsObject
} from "./internal/options";
import findIndex from "./find-index";

const ARR_INDEX_OF = Array.prototype.indexOf,
	STR_INDEX_OF = String.prototype.indexOf;

const OPTIONS_TEMPLATES = composeOptionsTemplates({
	byElements: {
		nodeMode: "element"
	},
	byNodes: {
		nodeMode: "node"
	},
	byContentNodes: {
		nodeMode: "content"
	}
});

export default function indexOf(parent, child, options) {
	if (typeof parent == "string")
		return STR_INDEX_OF.call(parent, child);

	if (Array.isArray(parent))
		return ARR_INDEX_OF.call(parent, child);

	if (parent instanceof Node && !(child instanceof Node)) {
		options = child;
		child = parent;
		parent = child.parentNode;
	}

	options = createOptionsObject(options, OPTIONS_TEMPLATES);

	if (parent instanceof Node) {
		if (!(child instanceof Node) || child.parentNode != parent)
			return -1;

		let node = child,
			idx = 0;

		switch (options.nodeMode) {
			case "content":
				while ((node = node.previousSibling)) {
					if (node.nodeType == Node.ELEMENT_NODE || node.nodeType == Node.TEXT_NODE)
						idx++;
				}
				break;

			case "node":
				while ((node = node.previousSibling))
					idx++;
				break;

			case "element":
			default:
				while ((node = node.previousElementSibling))
					idx++;
				break;
		}

		return idx;
	}

	return findIndex(parent, v => v == child);
}