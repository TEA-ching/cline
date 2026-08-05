# Cline web visual foundation

The shared visual contract now lives in the internal
[`@sctg/cline-ui`](../../../../../sdk/packages/ui/README.md) workspace package
instead of beside the desktop app.

The desktop imports the complete `@sctg/cline-ui/theme/index.css` entry point. Other
Cline surfaces can import `@sctg/cline-ui/theme/tokens.css` without React or
Tailwind, or compose the Tailwind adapter and optional base styles in order.
Consuming apps still own their font files and shell-specific layout.
