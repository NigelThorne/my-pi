import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseColor, truncateToWidth } from "@earendil-works/pi-tui";

import { installColorExtension } from "./logic.mjs";

export default function colorExtension(pi: ExtensionAPI) {
  installColorExtension(pi, {
    toColor: parseColor,
    fit: truncateToWidth,
  });
}
